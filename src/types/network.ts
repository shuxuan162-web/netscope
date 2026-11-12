/** Core data model shared by the simulation engine and the UI. */

export type NodeKind = 'host' | 'switch' | 'router' | 'firewall' | 'server';
export type NodeStatus = 'online' | 'inspecting' | 'dropping' | 'saturated';

/** A NIC on a host, a routed interface on a router/firewall, or a switch port. */
export interface NetInterface {
  id: string;
  name: string;
  /** Dotted IPv4 address, or '' when unconfigured (always '' on switch ports). */
  ip: string;
  /** CIDR prefix length, 0-32. */
  prefix: number;
  mac: string;
  linkId: string | null;
}

export interface RoutingEntry {
  id: string;
  /** Destination network in CIDR form, e.g. `0.0.0.0/0`. */
  destination: string;
  nextHop: string;
}

export interface ARPEntry {
  ip: string;
  mac: string;
  learnedAt: number;
}

export interface MacTableEntry {
  mac: string;
  portId: string;
  learnedAt: number;
}

export type AclProtocol = 'ANY' | 'TCP' | 'UDP' | 'ICMP';

/** Stateless, first-match-wins filter rule. `ANY` is a wildcard in every field. */
export interface ACLRule {
  id: string;
  action: 'ALLOW' | 'DENY';
  protocol: AclProtocol;
  /** `ANY`, a single IP, or a CIDR block. */
  src: string;
  srcPort: string;
  dst: string;
  dstPort: string;
  enabled: boolean;
}

export interface NatConfig {
  enabled: boolean;
  /** Interface facing the public network; traffic leaving through it is source-NATed. */
  outsideIfaceId: string | null;
}

export interface NatEntry {
  protocol: 'TCP' | 'UDP' | 'ICMP';
  insideIp: string;
  insidePort: number;
  publicIp: string;
  publicPort: number;
}

export interface ServicePort {
  port: number;
  protocol: 'TCP' | 'UDP';
  name: string;
}

export interface NetworkNode {
  id: string;
  kind: NodeKind;
  hostname: string;
  x: number;
  y: number;
  interfaces: NetInterface[];
  /** Default gateway (hosts and servers only). */
  gateway: string;
  /** Static routes (routers and firewalls). Connected routes are derived from interfaces. */
  routes: RoutingEntry[];
  acl: ACLRule[];
  nat: NatConfig;
  services: ServicePort[];

  // ── runtime state ────────────────────────────────────────────────────────
  arpTable: ARPEntry[];
  macTable: MacTableEntry[];
  natTable: NatEntry[];
  /** Simulation timestamps (ms) used to derive the status indicator. */
  lastActivity: number;
  lastDrop: number;
}

export interface LinkEnd {
  nodeId: string;
  ifaceId: string;
}

export interface Link {
  id: string;
  a: LinkEnd;
  b: LinkEnd;
}

export type TcpFlag = 'SYN' | 'ACK' | 'PSH' | 'FIN' | 'RST';

/** A full frame as it appears on the wire, one optional header per OSI layer. */
export interface OSIFrame {
  eth: { src: string; dst: string; etherType: 'IPv4' | 'ARP' };
  arp?: {
    op: 'request' | 'reply';
    senderMac: string;
    senderIp: string;
    targetMac: string;
    targetIp: string;
  };
  ip?: { src: string; dst: string; ttl: number; protocol: 'ICMP' | 'TCP' | 'UDP'; id: number };
  icmp?: { type: number; code: number; id: number; seq: number };
  tcp?: { srcPort: number; dstPort: number; flags: TcpFlag[]; seq: number; ack: number; window: number };
  udp?: { srcPort: number; dstPort: number };
  /** Layer-7 payload as text. */
  payload?: string;
  /** Layer-7 protocol label (HTTP, SSH, DNS …). */
  app?: string;

  // ── simulator metadata (not on the wire) ─────────────────────────────────
  flowId?: string;
  /** Passed a firewall ACL, or is a success response. Rendered green. */
  verified?: boolean;
  hops?: number;
}

export type PacketTone = 'std' | 'ok' | 'arp';

/** A frame in transit on a link. Position is derived from simulation time. */
export interface Packet {
  id: number;
  frame: OSIFrame;
  linkId: string;
  fromNodeId: string;
  toNodeId: string;
  toIfaceId: string;
  /** Simulation time at which the frame leaves the sender. */
  start: number;
  /** Simulation time at which it arrives, or is lost mid-wire. */
  end: number;
  /** Full traversal time of the link. */
  duration: number;
  lost: boolean;
  captureNo: number;
  tone: PacketTone;
  label: string;
}

export type CaptureStatus = 'transit' | 'delivered' | 'dropped' | 'ignored';

/** One row of the packet inspector: a frame observed on one link. */
export interface CapturedPacket {
  no: number;
  time: number;
  fromHost: string;
  toHost: string;
  frame: OSIFrame;
  protocol: string;
  source: string;
  destination: string;
  info: string;
  status: CaptureStatus;
  dropReason?: string;
}

export type LogLevel = 'info' | 'ok' | 'drop' | 'arp' | 'route' | 'nat' | 'warn' | 'cmd' | 'sys';

export interface LogEntry {
  id: number;
  time: number;
  node: string;
  level: LogLevel;
  msg: string;
}

export type FlowKind = 'ping' | 'http' | 'ssh' | 'dns' | 'tcp';
export type FlowState = 'pending' | 'established' | 'success' | 'failed';
export type FlowFailure =
  | 'acl-drop'
  | 'no-route'
  | 'arp-timeout'
  | 'ttl'
  | 'refused'
  | 'unreachable'
  | 'loss'
  | 'timeout'
  | 'cancelled';

/** An end-to-end exchange started by the user (a ping, an HTTP GET …). */
export interface Flow {
  id: string;
  kind: FlowKind;
  label: string;
  srcNodeId: string;
  srcIp: string;
  srcPort: number;
  dstIp: string;
  dstPort: number;
  state: FlowState;
  reason?: FlowFailure;
  startedAt: number;
  finishedAt?: number;
  lastProgress: number;
}

/** Transient visual effect consumed by the canvas renderer. */
export interface Effect {
  type: 'burst' | 'ring';
  t: number;
  nodeId?: string;
  linkId?: string;
  fromNodeId?: string;
  frac?: number;
}

export type SoundName = 'click' | 'chirp' | 'buzz' | 'success';
