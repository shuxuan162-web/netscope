import type {
  ACLRule,
  CapturedPacket,
  Effect,
  Flow,
  FlowFailure,
  FlowKind,
  Link,
  LogEntry,
  LogLevel,
  NatEntry,
  NetInterface,
  NetworkNode,
  NodeKind,
  NodeStatus,
  OSIFrame,
  Packet,
  RoutingEntry,
  ServicePort,
  SoundName,
  TcpFlag,
} from '../types/network';
import { appExchange, cloneFrame, describeFrame, fiveTuple, formatRule, icmpName } from './describe';
import { BROADCAST_MAC, ZERO_MAC, inSubnet, isValidIp, matchAddr, networkOf, parseCidr } from './ip';

// All durations are in simulated milliseconds.
export const LINK_MS = 600;
export const PROC_MS = 90;
const ARP_TIMEOUT_MS = 4000;
const ARP_TRIES = 2;
const FLOW_IDLE_MS = 8000;
const MAX_CAPTURES = 500;
const MAX_LOGS = 800;
const MAX_FLOWS = 200;
const MAX_PACKETS = 500;
const MAX_HOPS = 40;

/** Small deterministic PRNG so a given seed always produces the same loss pattern. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Timer {
  at: number;
  seq: number;
  fn: () => void;
}

interface PendingArp {
  nodeId: string;
  ifaceId: string;
  ip: string;
  tries: number;
  queue: OSIFrame[];
}

export interface RouteResult {
  iface: NetInterface;
  nextHop: string;
  prefix: number;
  desc: string;
}

export interface NodeOptions {
  hostname?: string;
  /** `a.b.c.d/len` for hosts and servers. */
  ip?: string;
  gateway?: string;
  services?: ServicePort[];
  routes?: Omit<RoutingEntry, 'id'>[];
  acl?: Omit<ACLRule, 'id' | 'enabled'>[];
}

export interface FlowRequest {
  srcNodeId: string;
  dstIp: string;
  kind: FlowKind;
  port?: number;
  ttl?: number;
}

export type TopologyBuilder = (engine: NetworkEngine) => void;

const NAME_PREFIX: Record<NodeKind, string> = { host: 'PC', switch: 'SW', router: 'R', firewall: 'FW', server: 'SRV' };

export const DEFAULT_SERVICES: ServicePort[] = [
  { port: 80, protocol: 'TCP', name: 'HTTP' },
  { port: 22, protocol: 'TCP', name: 'SSH' },
  { port: 443, protocol: 'TCP', name: 'HTTPS' },
  { port: 53, protocol: 'UDP', name: 'DNS' },
];

/**
 * Deterministic, event-driven network simulator.
 *
 * The engine owns all mutable state and has no DOM dependencies. Time only
 * advances through `tick` / `step` / `advance`, and events are always processed
 * in timestamp order, so the outcome never depends on the rendering frame rate.
 */
export class NetworkEngine {
  nodes: NetworkNode[] = [];
  links: Link[] = [];
  packets: Packet[] = [];
  captures: CapturedPacket[] = [];
  logs: LogEntry[] = [];
  flows: Flow[] = [];
  effects: Effect[] = [];

  time = 0;
  running = true;
  speed = 1;
  /** Probability (0-0.5) that a frame is lost on any single link traversal. */
  lossRate = 0;
  scenarioName = '';
  onSound: ((sound: SoundName) => void) | null = null;

  private version = 0;
  private listeners = new Set<() => void>();
  private batching = false;
  private dirty = false;
  private loading = false;
  private timers: Timer[] = [];
  private pending = new Map<string, PendingArp>();
  private rng = mulberry32(1337);
  private cur: CapturedPacket | null = null;
  private builder: TopologyBuilder | null = null;
  private seq = { node: 0, link: 0, iface: 0, mac: 0, pkt: 0, cap: 0, log: 0, flow: 0, timer: 0, ip: 0, rule: 0 };

  // ── subscription (useSyncExternalStore compatible) ─────────────────────────

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getVersion = (): number => this.version;

  private emit(): void {
    if (this.batching) {
      this.dirty = true;
      return;
    }
    this.version++;
    this.listeners.forEach((fn) => fn());
  }

  private batch(fn: () => void): void {
    if (this.batching) return fn();
    this.batching = true;
    try {
      fn();
    } finally {
      this.batching = false;
      if (this.dirty) {
        this.dirty = false;
        this.emit();
      }
    }
  }

  private sound(name: SoundName): void {
    if (!this.loading) this.onSound?.(name);
  }

  // ── lookup helpers ─────────────────────────────────────────────────────────

  node(id: string): NetworkNode | undefined {
    return this.nodes.find((n) => n.id === id);
  }

  byName(hostname: string): NetworkNode | undefined {
    const h = hostname.toLowerCase();
    return this.nodes.find((n) => n.hostname.toLowerCase() === h);
  }

  link(id: string | null): Link | undefined {
    return id ? this.links.find((l) => l.id === id) : undefined;
  }

  /** Every configured IP in the topology, for destination pickers. */
  addressBook(): { ip: string; hostname: string; nodeId: string }[] {
    return this.nodes.flatMap((n) =>
      n.interfaces.filter((i) => i.ip).map((i) => ({ ip: i.ip, hostname: n.hostname, nodeId: n.id })),
    );
  }

  statusOf(node: NetworkNode, inbound: number): NodeStatus {
    if (this.time - node.lastDrop < 800) return 'dropping';
    if (inbound >= 6) return 'saturated';
    if (this.time - node.lastActivity < 380) return 'inspecting';
    return 'online';
  }

  // ── topology editing ───────────────────────────────────────────────────────

  /** Replaces the whole topology by running a builder; `reset()` re-runs it. */
  load(builder: TopologyBuilder, name: string): void {
    this.builder = builder;
    this.scenarioName = name;
    this.nodes = [];
    this.links = [];
    this.seq = { node: 0, link: 0, iface: 0, mac: 0, pkt: 0, cap: 0, log: 0, flow: 0, timer: 0, ip: 0, rule: 0 };
    this.clearRuntime();
    this.loading = true;
    try {
      builder(this);
    } finally {
      this.loading = false;
    }
    this.log('SYSTEM', 'sys', `Topology "${name}" loaded — ${this.nodes.length} nodes, ${this.links.length} links. Simulation clock reset.`);
    this.emit();
  }

  reset(): void {
    if (this.builder) this.load(this.builder, this.scenarioName);
  }

  private clearRuntime(): void {
    this.packets = [];
    this.captures = [];
    this.logs = [];
    this.flows = [];
    this.effects = [];
    this.timers = [];
    this.pending.clear();
    this.time = 0;
    this.rng = mulberry32(1337);
    this.flushTables(false);
  }

  /** Drops every in-flight frame and cancels unfinished flows. */
  clearTraffic(): void {
    this.packets = [];
    this.timers = [];
    this.pending.clear();
    for (const f of this.flows) {
      if (f.state === 'pending' || f.state === 'established') {
        f.state = 'failed';
        f.reason = 'cancelled';
        f.finishedAt = this.time;
      }
    }
    this.emit();
  }

  clearCaptures(): void {
    this.captures = [];
    this.emit();
  }

  clearLogs(): void {
    this.logs = [];
    this.emit();
  }

  /** Empties every ARP cache, MAC table and NAT translation table. */
  flushTables(announce = true): void {
    for (const n of this.nodes) {
      n.arpTable = [];
      n.macTable = [];
      n.natTable = [];
    }
    if (announce) {
      this.log('SYSTEM', 'sys', 'Configuration changed — ARP caches, MAC tables and NAT translations flushed.');
      this.emit();
    }
  }

  private nextMac(): string {
    const n = ++this.seq.mac;
    const h = (v: number) => (v & 255).toString(16).padStart(2, '0').toUpperCase();
    return `02:00:5E:${h(n >> 16)}:${h(n >> 8)}:${h(n)}`;
  }

  private usedIps(): Set<string> {
    return new Set(this.nodes.flatMap((n) => n.interfaces.map((i) => i.ip)).filter(Boolean));
  }

  addNode(kind: NodeKind, x: number, y: number, o: NodeOptions = {}): NetworkNode {
    const count = this.nodes.filter((n) => n.kind === kind).length + 1;
    const node: NetworkNode = {
      id: `n${++this.seq.node}`,
      kind,
      hostname: o.hostname ?? `${NAME_PREFIX[kind]}-${count}`,
      x,
      y,
      interfaces: [],
      gateway: o.gateway ?? '',
      routes: (o.routes ?? []).map((r) => ({ ...r, id: `rt${++this.seq.rule}` })),
      acl: (o.acl ?? []).map((r) => ({ ...r, enabled: true, id: `acl${++this.seq.rule}` })),
      nat: { enabled: false, outsideIfaceId: null },
      services: o.services ?? (kind === 'server' ? DEFAULT_SERVICES.map((s) => ({ ...s })) : []),
      arpTable: [],
      macTable: [],
      natTable: [],
      lastActivity: -1e9,
      lastDrop: -1e9,
    };
    if (kind === 'host' || kind === 'server') {
      let ip = '';
      let prefix = 24;
      const cidr = o.ip ? parseCidr(o.ip) : null;
      if (cidr) {
        ip = cidr.ip;
        prefix = cidr.prefix;
      } else if (!this.loading) {
        // Sensible defaults for nodes dropped onto the canvas by hand.
        const used = this.usedIps();
        for (let h = kind === 'host' ? 10 : 50; h < 255; h++) {
          if (!used.has(`192.168.1.${h}`)) {
            ip = `192.168.1.${h}`;
            break;
          }
        }
        if (!o.gateway) node.gateway = '192.168.1.1';
      }
      node.interfaces.push({ id: `if${++this.seq.iface}`, name: 'eth0', ip, prefix, mac: this.nextMac(), linkId: null });
    }
    this.nodes.push(node);
    if (!this.loading) this.log('SYSTEM', 'sys', `Added ${kind} ${node.hostname}.`);
    this.emit();
    return node;
  }

  private freeIndex(node: NetworkNode, re: RegExp, from: number): number {
    const taken = new Set(node.interfaces.map((i) => Number(re.exec(i.name)?.[1] ?? -1)));
    let n = from;
    while (taken.has(n)) n++;
    return n;
  }

  private allocIface(node: NetworkNode, cidr?: string): NetInterface {
    if (node.kind === 'host' || node.kind === 'server') {
      const iface = node.interfaces[0];
      const c = cidr ? parseCidr(cidr) : null;
      if (c) {
        iface.ip = c.ip;
        iface.prefix = c.prefix;
      }
      return iface;
    }
    let iface: NetInterface;
    if (node.kind === 'switch') {
      const n = this.freeIndex(node, /^fa0\/(\d+)$/, 1);
      iface = { id: `if${++this.seq.iface}`, name: `fa0/${n}`, ip: '', prefix: 0, mac: this.nextMac(), linkId: null };
    } else {
      const n = this.freeIndex(node, /^eth(\d+)$/, 0);
      let ip = '';
      let prefix = 24;
      const c = cidr ? parseCidr(cidr) : null;
      if (c) {
        ip = c.ip;
        prefix = c.prefix;
      } else if (!this.loading) {
        const used = this.usedIps();
        for (let k = 1; k < 255; k++) {
          if (!used.has(`192.168.${k}.1`)) {
            ip = `192.168.${k}.1`;
            break;
          }
        }
      }
      iface = { id: `if${++this.seq.iface}`, name: `eth${n}`, ip, prefix, mac: this.nextMac(), linkId: null };
    }
    node.interfaces.push(iface);
    return iface;
  }

  /** Connects two nodes. Returns the new link, or a human-readable error. */
  addLink(aId: string, bId: string, o: { aIp?: string; bIp?: string } = {}): Link | string {
    const a = this.node(aId);
    const b = this.node(bId);
    if (!a || !b) return 'Unknown node.';
    if (a === b) return 'A node cannot be linked to itself.';
    const exists = this.links.some(
      (l) => (l.a.nodeId === aId && l.b.nodeId === bId) || (l.a.nodeId === bId && l.b.nodeId === aId),
    );
    if (exists) return `${a.hostname} and ${b.hostname} are already connected.`;
    for (const n of [a, b]) {
      if ((n.kind === 'host' || n.kind === 'server') && n.interfaces[0].linkId) {
        return `${n.hostname} has a single NIC that is already connected — use a switch to fan out.`;
      }
    }
    const ia = this.allocIface(a, o.aIp);
    const ib = this.allocIface(b, o.bIp);
    const link: Link = {
      id: `l${++this.seq.link}`,
      a: { nodeId: a.id, ifaceId: ia.id },
      b: { nodeId: b.id, ifaceId: ib.id },
    };
    ia.linkId = link.id;
    ib.linkId = link.id;
    this.links.push(link);
    if (!this.loading) {
      this.log('SYSTEM', 'sys', `Link up: ${a.hostname} ${ia.name} ⇄ ${b.hostname} ${ib.name}.`);
      this.sound('click');
    }
    this.emit();
    return link;
  }

  removeLink(id: string): void {
    const link = this.link(id);
    if (!link) return;
    for (const end of [link.a, link.b]) {
      const node = this.node(end.nodeId);
      if (!node) continue;
      if (node.kind === 'host' || node.kind === 'server') {
        node.interfaces[0].linkId = null;
      } else {
        node.interfaces = node.interfaces.filter((i) => i.id !== end.ifaceId);
        node.macTable = node.macTable.filter((m) => m.portId !== end.ifaceId);
        if (node.nat.outsideIfaceId === end.ifaceId) node.nat.outsideIfaceId = null;
      }
    }
    this.links = this.links.filter((l) => l.id !== id);
    this.packets = this.packets.filter((p) => p.linkId !== id);
    this.log('SYSTEM', 'sys', 'Link removed.');
    this.emit();
  }

  removeNode(id: string): void {
    const node = this.node(id);
    if (!node) return;
    this.batch(() => {
      for (const l of this.links.filter((l) => l.a.nodeId === id || l.b.nodeId === id)) this.removeLink(l.id);
      this.nodes = this.nodes.filter((n) => n.id !== id);
      this.log('SYSTEM', 'sys', `Removed ${node.hostname}.`);
      this.emit();
    });
  }

  moveNode(id: string, x: number, y: number): void {
    const node = this.node(id);
    if (!node) return;
    node.x = x;
    node.y = y;
    this.emit();
  }

  /**
   * Applies a configuration edit made by the UI. Addressing changes invalidate
   * learned state, so caches are flushed unless `flush` is false.
   */
  mutate(fn: () => void, flush = true): void {
    fn();
    if (flush) this.flushTables(false);
    this.emit();
  }

  newRuleId(): string {
    return `r${++this.seq.rule}`;
  }

  // ── logging ────────────────────────────────────────────────────────────────

  log(node: string, level: LogLevel, msg: string): void {
    this.logs.push({ id: ++this.seq.log, time: this.time, node, level, msg });
    if (this.logs.length > MAX_LOGS) this.logs.splice(0, this.logs.length - MAX_LOGS);
    this.emit();
  }

  // ── clock ──────────────────────────────────────────────────────────────────

  /** Updates the transport controls (play state, speed multiplier, loss rate). */
  configure(patch: Partial<Pick<NetworkEngine, 'running' | 'speed' | 'lossRate'>>): void {
    if (patch.running !== undefined) this.running = patch.running;
    if (patch.speed !== undefined) this.speed = Math.max(0.25, Math.min(4, patch.speed));
    if (patch.lossRate !== undefined) this.lossRate = Math.max(0, Math.min(0.5, patch.lossRate));
    this.emit();
  }

  /** Advances the simulation by `realMs` of wall-clock time, scaled by `speed`. */
  tick(realMs: number): void {
    if (!this.running) return;
    this.advance(Math.min(realMs, 100) * this.speed);
  }

  private nextEventTime(): number | null {
    let next: number | null = null;
    for (const p of this.packets) if (next === null || p.end < next) next = p.end;
    for (const t of this.timers) if (next === null || t.at < next) next = t.at;
    return next;
  }

  /** Advances simulated time by `ms`, processing events in timestamp order. */
  advance(ms: number): void {
    this.batch(() => {
      const target = this.time + ms;
      for (let guard = 0; guard < 20000; guard++) {
        const next = this.nextEventTime();
        if (next === null || next > target) break;
        this.time = Math.max(this.time, next);
        this.processDue();
      }
      this.time = target;
      if (this.effects.length > 80) this.effects.splice(0, this.effects.length - 80);
    });
  }

  /** Jumps straight to the next frame arrival (used by the Step button). */
  step(): boolean {
    let next: number | null = null;
    for (const p of this.packets) if (next === null || p.end < next) next = p.end;
    if (next === null) return false;
    this.advance(Math.max(0, next - this.time));
    this.emit();
    return true;
  }

  /** Runs until all traffic has settled. Intended for tests and scripted checks. */
  runUntilIdle(maxMs = 180000): void {
    const deadline = this.time + maxMs;
    while (this.time < deadline) {
      const busy = this.packets.length > 0 || this.flows.some((f) => f.state === 'pending' || f.state === 'established');
      if (!busy) return;
      this.advance(50);
    }
  }

  private after(ms: number, fn: () => void): void {
    this.timers.push({ at: this.time + ms, seq: ++this.seq.timer, fn });
  }

  private processDue(): void {
    const duePackets = this.packets.filter((p) => p.end <= this.time).sort((a, b) => a.end - b.end || a.id - b.id);
    if (duePackets.length) {
      this.packets = this.packets.filter((p) => p.end > this.time);
      for (const p of duePackets) this.arrive(p);
    }
    const dueTimers = this.timers.filter((t) => t.at <= this.time).sort((a, b) => a.at - b.at || a.seq - b.seq);
    if (dueTimers.length) {
      this.timers = this.timers.filter((t) => t.at > this.time);
      for (const t of dueTimers) t.fn();
    }
  }

  // ── flows ──────────────────────────────────────────────────────────────────

  /** Starts an end-to-end exchange. Returns the flow, or an error string. */
  startFlow(req: FlowRequest): Flow | string {
    const node = this.node(req.srcNodeId);
    if (!node) return 'Unknown source node.';
    if (node.kind === 'switch') return 'A layer-2 switch has no IP stack and cannot originate traffic.';
    if (!isValidIp(req.dstIp)) return `"${req.dstIp}" is not a valid IPv4 address.`;
    if (node.interfaces.some((i) => i.ip === req.dstIp)) return 'Destination is the source node itself.';
    const firstIface = node.interfaces.find((i) => i.ip);
    if (!firstIface) return `${node.hostname} has no IP address configured.`;

    const kind = req.kind;
    const dstPort = kind === 'ping' ? 0 : kind === 'http' ? 80 : kind === 'ssh' ? 22 : kind === 'dns' ? 53 : (req.port ?? 80);
    const n = ++this.seq.flow;
    const srcPort = kind === 'ping' ? 0 : 49152 + ((n * 7919) % 16000);
    const route = this.route(node, req.dstIp);
    const srcIp = route?.iface.ip || firstIface.ip;
    const verb = kind === 'ping' ? 'ping' : kind === 'dns' ? 'dig @' : kind === 'tcp' ? `tcp:${dstPort}` : kind;
    const flow: Flow = {
      id: `f${n}`,
      kind,
      label: `${verb.toUpperCase()} ${node.hostname} → ${req.dstIp}${kind === 'tcp' ? ':' + dstPort : ''}`,
      srcNodeId: node.id,
      srcIp,
      srcPort,
      dstIp: req.dstIp,
      dstPort,
      state: 'pending',
      startedAt: this.time,
      lastProgress: this.time,
    };
    this.flows.push(flow);
    if (this.flows.length > MAX_FLOWS) this.flows.splice(0, this.flows.length - MAX_FLOWS);

    const ttl = Math.max(1, Math.min(255, req.ttl ?? 64));
    const frame = this.ipFrame(srcIp, req.dstIp, kind === 'ping' ? 'ICMP' : kind === 'dns' ? 'UDP' : 'TCP', ttl);
    frame.flowId = flow.id;
    if (kind === 'ping') {
      frame.icmp = { type: 8, code: 0, id: n & 0xffff, seq: 1 };
      frame.payload = 'abcdefghijklmnopqrstuvwabcdefghi';
      this.log(node.hostname, 'cmd', `$ ping -c 1 -t ${ttl} ${req.dstIp}`);
    } else if (kind === 'dns') {
      const ex = appExchange(53, 'UDP', '', req.dstIp);
      frame.udp = { srcPort, dstPort };
      frame.payload = ex.request;
      frame.app = ex.app;
      this.log(node.hostname, 'cmd', `$ dig @${req.dstIp} example.com A`);
    } else {
      frame.tcp = { srcPort, dstPort, flags: ['SYN'], seq: (n * 2654435761) >>> 0, ack: 0, window: 64240 };
      const cmd = kind === 'http' ? `curl http://${req.dstIp}/` : kind === 'ssh' ? `ssh admin@${req.dstIp}` : `nc ${req.dstIp} ${dstPort}`;
      this.log(node.hostname, 'cmd', `$ ${cmd}`);
      this.log(node.hostname, 'info', `TCP ${srcIp}:${srcPort} → ${req.dstIp}:${dstPort} — sending SYN (3-way handshake 1/3)`);
    }

    this.batch(() => {
      this.ipOutput(node, frame);
      this.emit();
    });

    const watchdog = () => {
      if (flow.state !== 'pending' && flow.state !== 'established') return;
      const idle = this.time - flow.lastProgress;
      if (idle >= FLOW_IDLE_MS) {
        this.log(node.hostname, 'drop', `Request timed out — no response from ${flow.dstIp} (${flow.label}).`);
        this.failFlow(flow.id, 'timeout');
      } else {
        this.after(FLOW_IDLE_MS - idle + 1, watchdog);
      }
    };
    this.after(FLOW_IDLE_MS, watchdog);
    return flow;
  }

  private flow(id?: string): Flow | undefined {
    return id ? this.flows.find((f) => f.id === id) : undefined;
  }

  private failFlow(id: string | undefined, reason: FlowFailure): void {
    const f = this.flow(id);
    if (!f || f.state === 'success' || f.state === 'failed') return;
    f.state = 'failed';
    f.reason = reason;
    f.finishedAt = this.time;
    this.emit();
  }

  private succeedFlow(f: Flow, node: NetworkNode): void {
    if (f.state === 'success' || f.state === 'failed') return;
    f.state = 'success';
    f.finishedAt = this.time;
    this.effects.push({ type: 'ring', t: this.time, nodeId: node.id });
    this.log(node.hostname, 'ok', `✔ ${f.label} completed in ${Math.round(this.time - f.startedAt)} ms (simulated).`);
    this.sound('success');
  }

  // ── transmission ───────────────────────────────────────────────────────────

  private ipFrame(src: string, dst: string, protocol: 'ICMP' | 'TCP' | 'UDP', ttl = 64): OSIFrame {
    this.seq.ip = (this.seq.ip + 1) & 0xffff;
    return { eth: { src: '', dst: '', etherType: 'IPv4' }, ip: { src, dst, ttl, protocol, id: this.seq.ip } };
  }

  /** Puts a frame on the wire attached to `iface`. */
  private transmit(node: NetworkNode, iface: NetInterface, frame: OSIFrame): void {
    const link = this.link(iface.linkId);
    if (!link) return;
    const far = link.a.nodeId === node.id && link.a.ifaceId === iface.id ? link.b : link.a;
    const peer = this.node(far.nodeId);
    if (!peer) return;

    frame.hops = (frame.hops ?? 0) + 1;
    if (frame.hops > MAX_HOPS) {
      this.log(node.hostname, 'drop', '[STORM] Frame exceeded the hop limit — probable switching loop. Frame discarded.');
      node.lastDrop = this.time;
      return;
    }
    if (this.packets.length >= MAX_PACKETS) {
      this.log(node.hostname, 'drop', '[SATURATED] Simulation packet budget exhausted — frame discarded.');
      node.lastDrop = this.time;
      this.failFlow(frame.flowId, 'loss');
      return;
    }

    const touched = this.flow(frame.flowId);
    if (touched) touched.lastProgress = this.time;

    const lost = this.lossRate > 0 && this.rng() < this.lossRate;
    const start = this.time + PROC_MS;
    const frac = lost ? 0.25 + this.rng() * 0.5 : 1;
    const d = describeFrame(frame);
    const cap: CapturedPacket = {
      no: ++this.seq.cap,
      time: start,
      fromHost: node.hostname,
      toHost: peer.hostname,
      frame: cloneFrame(frame),
      protocol: d.protocol,
      source: d.source,
      destination: d.destination,
      info: d.info,
      status: 'transit',
    };
    this.captures.push(cap);
    if (this.captures.length > MAX_CAPTURES) this.captures.splice(0, this.captures.length - MAX_CAPTURES);

    this.packets.push({
      id: ++this.seq.pkt,
      frame,
      linkId: link.id,
      fromNodeId: node.id,
      toNodeId: peer.id,
      toIfaceId: far.ifaceId,
      start,
      end: start + LINK_MS * frac,
      duration: LINK_MS,
      lost,
      captureNo: cap.no,
      tone: d.tone,
      label: d.label,
    });
    this.emit();
  }

  private arrive(p: Packet): void {
    const cap = this.captures.find((c) => c.no === p.captureNo) ?? null;
    const node = this.node(p.toNodeId);
    const from = this.node(p.fromNodeId);
    this.emit();

    if (p.lost) {
      if (cap) {
        cap.status = 'dropped';
        cap.dropReason = 'Lost in transit (simulated packet loss)';
      }
      this.effects.push({ type: 'burst', t: this.time, linkId: p.linkId, fromNodeId: p.fromNodeId, frac: (p.end - p.start) / p.duration });
      this.log(from?.hostname ?? 'LINK', 'drop', `[LOSS] ${describeFrame(p.frame).protocol} frame to ${node?.hostname ?? '?'} lost on the wire (loss rate ${Math.round(this.lossRate * 100)}%).`);
      this.sound('buzz');
      if (!p.frame.arp) this.failFlow(p.frame.flowId, 'loss');
      return;
    }

    const iface = node?.interfaces.find((i) => i.id === p.toIfaceId);
    if (!node || !iface) return;
    if (cap) cap.status = 'delivered';
    node.lastActivity = this.time;
    this.cur = cap;
    try {
      if (node.kind === 'switch') this.switchReceive(node, iface, p.frame);
      else this.l3Receive(node, iface, p.frame);
    } finally {
      this.cur = null;
    }
  }

  /** Marks the frame currently being processed as dropped at `node`. */
  private drop(node: NetworkNode, frame: OSIFrame, reason: string, msg: string, failure?: FlowFailure): void {
    if (this.cur) {
      this.cur.status = 'dropped';
      this.cur.dropReason = reason;
    }
    node.lastDrop = this.time;
    this.effects.push({ type: 'burst', t: this.time, nodeId: node.id });
    this.log(node.hostname, 'drop', msg);
    this.sound('buzz');
    if (failure) this.failFlow(frame.flowId, failure);
  }

  private ignore(): void {
    if (this.cur) this.cur.status = 'ignored';
  }

  // ── layer 2: switching ─────────────────────────────────────────────────────

  private switchReceive(sw: NetworkNode, port: NetInterface, frame: OSIFrame): void {
    const src = frame.eth.src;
    const known = sw.macTable.find((m) => m.mac === src);
    if (!known) {
      sw.macTable.push({ mac: src, portId: port.id, learnedAt: this.time });
      this.log(sw.hostname, 'info', `[MAC LEARN] ${src} is reachable via port ${port.name} — added to MAC address table.`);
    } else if (known.portId !== port.id) {
      const old = sw.interfaces.find((i) => i.id === known.portId)?.name ?? '?';
      known.portId = port.id;
      known.learnedAt = this.time;
      this.log(sw.hostname, 'warn', `[MAC MOVE] ${src} moved from port ${old} to ${port.name}.`);
    }

    const dst = frame.eth.dst;
    const entry = dst === BROADCAST_MAC ? undefined : sw.macTable.find((m) => m.mac === dst);
    if (!entry) {
      const out = sw.interfaces.filter((i) => i.id !== port.id && i.linkId);
      const why = dst === BROADCAST_MAC ? 'broadcast frame' : `unknown unicast ${dst}`;
      this.log(sw.hostname, dst === BROADCAST_MAC ? 'arp' : 'info', `[FLOOD] ${why} from ${port.name} → flooding out ${out.length ? out.map((i) => i.name).join(', ') : 'no other ports'}.`);
      for (const o of out) this.transmit(sw, o, cloneFrame(frame));
      return;
    }
    if (entry.portId === port.id) {
      this.ignore();
      this.log(sw.hostname, 'info', `[FILTER] ${dst} lives on the ingress port ${port.name} — frame not forwarded.`);
      return;
    }
    const out = sw.interfaces.find((i) => i.id === entry.portId);
    if (!out) return;
    this.log(sw.hostname, 'info', `[FORWARD] ${src} → ${dst}: MAC table hit, switching out port ${out.name}.`);
    this.transmit(sw, out, cloneFrame(frame));
  }

  // ── ARP ────────────────────────────────────────────────────────────────────

  private learnArp(node: NetworkNode, ip: string, mac: string): void {
    const entry = node.arpTable.find((a) => a.ip === ip);
    if (!entry) {
      node.arpTable.push({ ip, mac, learnedAt: this.time });
      this.log(node.hostname, 'arp', `[ARP CACHE] learned ${ip} → ${mac}.`);
    } else if (entry.mac !== mac) {
      this.log(node.hostname, 'warn', `[ARP CONFLICT] ${ip} changed from ${entry.mac} to ${mac} — two stations are answering for the same IP (duplicate address).`);
      entry.mac = mac;
      entry.learnedAt = this.time;
      node.lastDrop = this.time;
      this.sound('buzz');
    }
    const key = `${node.id}|${ip}`;
    const pend = this.pending.get(key);
    if (pend) {
      this.pending.delete(key);
      const iface = node.interfaces.find((i) => i.id === pend.ifaceId);
      if (iface) {
        if (pend.queue.length) this.log(node.hostname, 'arp', `ARP resolved — releasing ${pend.queue.length} queued packet(s) for ${ip}.`);
        for (const f of pend.queue) {
          f.eth = { src: iface.mac, dst: mac, etherType: 'IPv4' };
          this.transmit(node, iface, f);
        }
      }
    }
  }

  private sendArpRequest(node: NetworkNode, iface: NetInterface, pend: PendingArp): void {
    pend.tries++;
    this.log(node.hostname, 'arp', `[ARP] No cache entry for ${pend.ip} — broadcasting "Who has ${pend.ip}? Tell ${iface.ip}" (attempt ${pend.tries}/${ARP_TRIES}).`);
    for (const f of pend.queue) {
      const fl = this.flow(f.flowId);
      if (fl) fl.lastProgress = this.time;
    }
    this.transmit(node, iface, {
      eth: { src: iface.mac, dst: BROADCAST_MAC, etherType: 'ARP' },
      arp: { op: 'request', senderMac: iface.mac, senderIp: iface.ip, targetMac: ZERO_MAC, targetIp: pend.ip },
    });
    const key = `${node.id}|${pend.ip}`;
    this.after(ARP_TIMEOUT_MS, () => {
      if (this.pending.get(key) !== pend) return;
      const n = this.node(node.id);
      const i = n?.interfaces.find((x) => x.id === iface.id);
      if (n && i && pend.tries < ARP_TRIES) {
        this.sendArpRequest(n, i, pend);
        return;
      }
      this.pending.delete(key);
      node.lastDrop = this.time;
      this.effects.push({ type: 'burst', t: this.time, nodeId: node.id });
      this.log(node.hostname, 'drop', `[ARP TIMEOUT] ${pend.ip} did not answer — destination host unreachable, ${pend.queue.length} packet(s) discarded.`);
      this.sound('buzz');
      for (const f of pend.queue) this.failFlow(f.flowId, 'arp-timeout');
    });
  }

  private handleArp(node: NetworkNode, iface: NetInterface, frame: OSIFrame): void {
    const a = frame.arp!;
    if (a.op === 'request') {
      if (!iface.ip || a.targetIp !== iface.ip) {
        this.ignore();
        return;
      }
      this.learnArp(node, a.senderIp, a.senderMac);
      this.log(node.hostname, 'arp', `[ARP] Request is for me — replying "${iface.ip} is at ${iface.mac}" (unicast to ${a.senderMac}).`);
      this.transmit(node, iface, {
        eth: { src: iface.mac, dst: a.senderMac, etherType: 'ARP' },
        arp: { op: 'reply', senderMac: iface.mac, senderIp: iface.ip, targetMac: a.senderMac, targetIp: a.senderIp },
      });
    } else {
      this.learnArp(node, a.senderIp, a.senderMac);
    }
  }

  // ── layer 3: routing ───────────────────────────────────────────────────────

  /** Longest-prefix-match lookup over connected, static and default-gateway routes. */
  route(node: NetworkNode, dst: string): RouteResult | null {
    let best: RouteResult | null = null;
    const consider = (r: RouteResult) => {
      if (!best || r.prefix > best.prefix) best = r;
    };
    const connected = (ip: string) => node.interfaces.find((i) => i.ip && i.linkId && inSubnet(ip, i.ip, i.prefix));

    for (const i of node.interfaces) {
      if (i.ip && i.linkId && inSubnet(dst, i.ip, i.prefix)) {
        consider({ iface: i, nextHop: dst, prefix: i.prefix, desc: `${networkOf(i.ip, i.prefix)}/${i.prefix} is directly connected, ${i.name}` });
      }
    }
    if (node.kind === 'router' || node.kind === 'firewall') {
      for (const r of node.routes) {
        const c = parseCidr(r.destination);
        if (!c || !isValidIp(r.nextHop) || !inSubnet(dst, c.ip, c.prefix)) continue;
        const via = connected(r.nextHop);
        if (via) consider({ iface: via, nextHop: r.nextHop, prefix: c.prefix, desc: `${networkOf(c.ip, c.prefix)}/${c.prefix} via ${r.nextHop}, ${via.name}${c.prefix === 0 ? ' (default route)' : ''}` });
      }
    } else if (node.gateway && isValidIp(node.gateway)) {
      const via = connected(node.gateway);
      if (via && !best) best = { iface: via, nextHop: node.gateway, prefix: 0, desc: `default gateway ${node.gateway}, ${via.name}` };
    }
    return best;
  }

  /** Sends a locally originated IP packet. */
  private ipOutput(node: NetworkNode, frame: OSIFrame): void {
    const ip = frame.ip!;
    const r = this.route(node, ip.dst);
    if (!r) {
      const i = node.interfaces.find((x) => x.ip);
      const where = i ? `${ip.dst} is outside ${networkOf(i.ip, i.prefix)}/${i.prefix}` : 'no interface is configured';
      const hint = node.kind === 'host' || node.kind === 'server' ? (node.gateway ? `default gateway ${node.gateway} is not on a connected subnet` : 'no default gateway is set') : 'no matching route';
      node.lastDrop = this.time;
      this.effects.push({ type: 'burst', t: this.time, nodeId: node.id });
      this.log(node.hostname, 'drop', `[NO ROUTE] Network unreachable: ${where} and ${hint}. Packet not sent.`);
      this.sound('buzz');
      this.failFlow(frame.flowId, 'no-route');
      return;
    }
    if (!ip.src) ip.src = r.iface.ip;
    if (node.kind === 'host' || node.kind === 'server') {
      this.log(node.hostname, 'route', `[ROUTE] ${ip.dst} → ${r.desc}${r.nextHop !== ip.dst ? ' (off-link, using gateway)' : ' (on-link)'}.`);
    }
    this.l3Send(node, r.iface, r.nextHop, frame);
  }

  /** Resolves the next hop's MAC (queuing behind ARP if needed) and transmits. */
  private l3Send(node: NetworkNode, iface: NetInterface, nextHop: string, frame: OSIFrame): void {
    const hit = node.arpTable.find((a) => a.ip === nextHop);
    if (hit) {
      frame.eth = { src: iface.mac, dst: hit.mac, etherType: 'IPv4' };
      this.transmit(node, iface, frame);
      return;
    }
    const key = `${node.id}|${nextHop}`;
    let pend = this.pending.get(key);
    if (pend) {
      pend.queue.push(frame);
      return;
    }
    pend = { nodeId: node.id, ifaceId: iface.id, ip: nextHop, tries: 0, queue: [frame] };
    this.pending.set(key, pend);
    this.sendArpRequest(node, iface, pend);
  }

  private l3Receive(node: NetworkNode, iface: NetInterface, frame: OSIFrame): void {
    if (frame.eth.dst !== BROADCAST_MAC && frame.eth.dst !== iface.mac) {
      this.ignore(); // flooded frame for someone else — the NIC discards it silently
      return;
    }
    if (frame.arp) return this.handleArp(node, iface, frame);
    const ip = frame.ip;
    if (!ip) return;

    // Return traffic for a NAT translation is addressed to the public IP: restore it first.
    if (node.kind === 'firewall' && node.nat.enabled && iface.id === node.nat.outsideIfaceId && ip.dst === iface.ip) {
      this.natRestore(node, frame);
    }

    if (node.interfaces.some((i) => i.ip && i.ip === ip.dst)) return this.localDeliver(node, frame);
    if (node.kind === 'router' || node.kind === 'firewall') return this.forward(node, iface, frame);
    this.ignore();
    this.log(node.hostname, 'info', `Packet for ${ip.dst} is not mine and IP forwarding is disabled — discarded.`);
  }

  private evalAcl(node: NetworkNode, frame: OSIFrame): { rule: ACLRule; index: number } | null {
    const ip = frame.ip!;
    const l4 = frame.tcp ?? frame.udp;
    const portOk = (pattern: string, port?: number) => {
      const p = pattern.trim().toUpperCase();
      return p === 'ANY' || p === '' || p === '*' || (port !== undefined && String(port) === p);
    };
    for (let i = 0; i < node.acl.length; i++) {
      const r = node.acl[i];
      if (!r.enabled) continue;
      if (r.protocol !== 'ANY' && r.protocol !== ip.protocol) continue;
      if (!matchAddr(r.src, ip.src) || !matchAddr(r.dst, ip.dst)) continue;
      if (!portOk(r.srcPort, l4?.srcPort) || !portOk(r.dstPort, l4?.dstPort)) continue;
      return { rule: r, index: i + 1 };
    }
    return null;
  }

  private natPort(frame: OSIFrame, side: 'src' | 'dst'): number {
    const l4 = frame.tcp ?? frame.udp;
    if (l4) return side === 'src' ? l4.srcPort : l4.dstPort;
    return frame.icmp?.id ?? 0;
  }

  private natApply(node: NetworkNode, outside: NetInterface, frame: OSIFrame): void {
    const ip = frame.ip!;
    const insidePort = this.natPort(frame, 'src');
    let e = node.natTable.find((n) => n.protocol === ip.protocol && n.insideIp === ip.src && n.insidePort === insidePort);
    if (!e) {
      e = { protocol: ip.protocol, insideIp: ip.src, insidePort, publicIp: outside.ip, publicPort: 40000 + node.natTable.length + 1 };
      node.natTable.push(e);
    }
    this.log(node.hostname, 'nat', `[NAT] SNAT ${ip.protocol} ${e.insideIp}:${e.insidePort} → ${e.publicIp}:${e.publicPort} (egress ${outside.name}).`);
    ip.src = e.publicIp;
    if (frame.tcp) frame.tcp.srcPort = e.publicPort;
    else if (frame.udp) frame.udp.srcPort = e.publicPort;
    else if (frame.icmp) frame.icmp.id = e.publicPort;
  }

  private natRestore(node: NetworkNode, frame: OSIFrame): NatEntry | undefined {
    const ip = frame.ip!;
    const publicPort = this.natPort(frame, 'dst');
    const e = node.natTable.find((n) => n.protocol === ip.protocol && n.publicPort === publicPort);
    if (!e) return undefined;
    this.log(node.hostname, 'nat', `[NAT] translation hit ${ip.dst}:${publicPort} → ${e.insideIp}:${e.insidePort} (restoring inside address).`);
    ip.dst = e.insideIp;
    if (frame.tcp) frame.tcp.dstPort = e.insidePort;
    else if (frame.udp) frame.udp.dstPort = e.insidePort;
    else if (frame.icmp) frame.icmp.id = e.insidePort;
    return e;
  }

  private icmpError(node: NetworkNode, inIface: NetInterface, original: OSIFrame, type: number, code: number): void {
    if (original.icmp && original.icmp.type !== 8 && original.icmp.type !== 0) return; // never answer an error with an error
    const reply = this.ipFrame(inIface.ip, original.ip!.src, 'ICMP');
    reply.icmp = { type, code, id: 0, seq: 0 };
    reply.flowId = original.flowId;
    this.ipOutput(node, reply);
  }

  private forward(node: NetworkNode, inIface: NetInterface, frame: OSIFrame): void {
    const ip = frame.ip!;

    if (node.kind === 'firewall') {
      const hit = this.evalAcl(node, frame);
      if (hit && hit.rule.action === 'DENY') {
        this.drop(node, frame, `Denied by ACL rule #${hit.index}`, `[ACL DROP] Packet ${fiveTuple(frame)} rejected by Rule #${hit.index} (${formatRule(hit.rule)}).`, 'acl-drop');
        return;
      }
      this.log(node.hostname, 'ok', `[ACL PASS] ${fiveTuple(frame)} permitted by ${hit ? `Rule #${hit.index} (${formatRule(hit.rule)})` : 'implicit allow (no rule matched)'}.`);
      frame.verified = true;
    }

    if (ip.ttl <= 1) {
      this.drop(node, frame, 'TTL expired in transit', `[TTL] Packet ${ip.src} → ${ip.dst} arrived with TTL=${ip.ttl}; decrement reaches 0 — dropped, sending ICMP Time Exceeded to ${ip.src}.`, 'ttl');
      this.icmpError(node, inIface, frame, 11, 0);
      return;
    }
    ip.ttl -= 1;

    const r = this.route(node, ip.dst);
    if (!r) {
      this.drop(node, frame, 'No route to destination', `[ROUTE] No route to ${ip.dst} in routing table (no default route) — dropped, sending ICMP Destination Unreachable to ${ip.src}.`, 'no-route');
      this.icmpError(node, inIface, frame, 3, 0);
      return;
    }
    this.log(node.hostname, 'route', `[ROUTE] ${ip.src} → ${ip.dst}: matched ${r.desc}; TTL ${ip.ttl + 1}→${ip.ttl}, forwarding ${inIface.name} → ${r.iface.name}.`);

    if (node.kind === 'firewall' && node.nat.enabled && r.iface.id === node.nat.outsideIfaceId && inIface.id !== r.iface.id) {
      this.natApply(node, r.iface, frame);
    }
    this.l3Send(node, r.iface, r.nextHop, frame);
  }

  // ── layer 4-7: local delivery ──────────────────────────────────────────────

  private listening(node: NetworkNode, port: number, protocol: 'TCP' | 'UDP'): boolean {
    return node.services.some((s) => s.port === port && s.protocol === protocol);
  }

  private localDeliver(node: NetworkNode, frame: OSIFrame): void {
    const ip = frame.ip!;
    const flow = this.flow(frame.flowId);
    const isClient = !!flow && flow.srcNodeId === node.id;
    this.sound('chirp');

    if (frame.icmp) {
      const c = frame.icmp;
      if (c.type === 8) {
        this.log(node.hostname, 'info', `ICMP echo request from ${ip.src} (ttl=${ip.ttl}) — sending echo reply.`);
        const reply = this.ipFrame(ip.dst, ip.src, 'ICMP');
        reply.icmp = { type: 0, code: 0, id: c.id, seq: c.seq };
        reply.payload = frame.payload;
        reply.flowId = frame.flowId;
        reply.verified = true;
        this.ipOutput(node, reply);
      } else if (c.type === 0) {
        this.log(node.hostname, 'ok', `${(frame.payload?.length ?? 0) + 8} bytes from ${ip.src}: icmp_seq=${c.seq} ttl=${ip.ttl}`);
        if (flow && isClient) this.succeedFlow(flow, node);
      } else {
        this.log(node.hostname, 'drop', `From ${ip.src}: ICMP ${icmpName(c.type, c.code)}.`);
        node.lastDrop = this.time;
        this.failFlow(frame.flowId, c.type === 11 ? 'ttl' : 'unreachable');
      }
      return;
    }

    if (frame.tcp) {
      const t = frame.tcp;
      const has = (f: TcpFlag) => t.flags.includes(f);
      const respond = (flags: TcpFlag[], seq: number, ack: number, payload?: string, app?: string, verified = false) => {
        const out = this.ipFrame(ip.dst, ip.src, 'TCP');
        out.tcp = { srcPort: t.dstPort, dstPort: t.srcPort, flags, seq: seq >>> 0, ack: ack >>> 0, window: 64240 };
        out.flowId = frame.flowId;
        if (payload) {
          out.payload = payload;
          out.app = app;
        }
        if (verified) out.verified = true;
        this.ipOutput(node, out);
      };
      const peer = `${ip.src}:${t.srcPort}`;

      if (has('RST')) {
        this.log(node.hostname, 'drop', `Connection refused by ${peer} (RST received).`);
        node.lastDrop = this.time;
        this.failFlow(frame.flowId, 'refused');
      } else if (has('SYN') && !has('ACK')) {
        if (this.listening(node, t.dstPort, 'TCP')) {
          this.log(node.hostname, 'info', `TCP SYN from ${peer} on listening port ${t.dstPort} — replying SYN-ACK (handshake 2/3).`);
          respond(['SYN', 'ACK'], (t.seq ^ 0x5a5a5a5a) >>> 0, t.seq + 1);
        } else {
          this.log(node.hostname, 'drop', `TCP SYN from ${peer} to closed port ${t.dstPort} — nothing is listening, replying RST.`);
          respond(['RST', 'ACK'], 0, t.seq + 1);
        }
      } else if (has('SYN') && has('ACK')) {
        if (!isClient || !flow) return;
        flow.state = 'established';
        this.log(node.hostname, 'ok', `TCP SYN-ACK from ${peer} — sending ACK (handshake 3/3). Connection ESTABLISHED.`);
        respond(['ACK'], t.ack, t.seq + 1);
        const ex = appExchange(flow.dstPort, 'TCP', '', flow.dstIp);
        this.log(node.hostname, 'info', `${ex.app} → ${ex.request.split('\r\n')[0]}`);
        respond(['PSH', 'ACK'], t.ack, t.seq + 1, ex.request, ex.app);
      } else if (has('PSH') && frame.payload) {
        if (isClient && flow) {
          this.log(node.hostname, 'ok', `${frame.app ?? 'DATA'} ← ${frame.payload.split('\r\n')[0]}`);
          respond(['ACK'], t.ack, t.seq + frame.payload.length);
          this.succeedFlow(flow, node);
        } else if (this.listening(node, t.dstPort, 'TCP')) {
          const ex = appExchange(t.dstPort, 'TCP', node.hostname, ip.dst);
          this.log(node.hostname, 'info', `${ex.app} request from ${peer}: "${frame.payload.split('\r\n')[0]}" — sending response.`);
          respond(['PSH', 'ACK'], t.ack, t.seq + frame.payload.length, ex.response, ex.app, true);
        }
      } else if (has('ACK') && !isClient && this.listening(node, t.dstPort, 'TCP')) {
        this.log(node.hostname, 'ok', `TCP session with ${peer} on port ${t.dstPort} ESTABLISHED.`);
      }
      return;
    }

    if (frame.udp) {
      const u = frame.udp;
      if (isClient && flow && u.dstPort === flow.srcPort) {
        this.log(node.hostname, 'ok', `${frame.app ?? 'UDP'} ← ${frame.payload ?? ''}`);
        this.succeedFlow(flow, node);
      } else if (this.listening(node, u.dstPort, 'UDP')) {
        const ex = appExchange(u.dstPort, 'UDP', node.hostname, ip.dst);
        this.log(node.hostname, 'info', `${ex.app} query from ${ip.src}:${u.srcPort} — answering.`);
        const out = this.ipFrame(ip.dst, ip.src, 'UDP');
        out.udp = { srcPort: u.dstPort, dstPort: u.srcPort };
        out.payload = ex.response;
        out.app = ex.app;
        out.flowId = frame.flowId;
        out.verified = true;
        this.ipOutput(node, out);
      } else {
        this.log(node.hostname, 'drop', `UDP datagram from ${ip.src} to closed port ${u.dstPort} — replying ICMP Port Unreachable.`);
        const out = this.ipFrame(ip.dst, ip.src, 'ICMP');
        out.icmp = { type: 3, code: 3, id: 0, seq: 0 };
        out.flowId = frame.flowId;
        this.ipOutput(node, out);
      }
    }
  }
}
