import type { ACLRule, FlowKind, Link, ServicePort } from '../types/network';
import type { NetworkEngine } from './networkEngine';

export interface QuickAction {
  label: string;
  /** Hostname of the originating node. */
  from: string;
  dstIp: string;
  kind: FlowKind;
  port?: number;
  /** What the visitor should expect to see. */
  expect: string;
}

export interface Scenario {
  id: string;
  name: string;
  group: 'preset' | 'mission' | 'sandbox';
  description: string;
  build: (e: NetworkEngine) => void;
  quickActions: QuickAction[];
}

type Rule = Omit<ACLRule, 'id' | 'enabled'>;
const rule = (action: Rule['action'], protocol: Rule['protocol'], src: string, srcPort: string, dst: string, dstPort: string): Rule => ({
  action,
  protocol,
  src,
  srcPort,
  dst,
  dstPort,
});

const svc = (port: number, name: string, protocol: 'TCP' | 'UDP' = 'TCP'): ServicePort => ({ port, protocol, name });

/** Links two nodes while building a scenario; a failure here is a programming error. */
function wire(e: NetworkEngine, a: string, b: string, aIp?: string, bIp?: string): Link {
  const r = e.addLink(a, b, { aIp, bIp });
  if (typeof r === 'string') throw new Error(r);
  return r;
}

// ── presets ──────────────────────────────────────────────────────────────────

function basicLan(e: NetworkEngine): void {
  const pcA = e.addNode('host', 110, 150, { hostname: 'PC-A', ip: '192.168.1.10/24', gateway: '192.168.1.1' });
  const pcB = e.addNode('host', 110, 350, { hostname: 'PC-B', ip: '192.168.1.11/24', gateway: '192.168.1.1' });
  const sw1 = e.addNode('switch', 330, 250, { hostname: 'SW1' });
  const r1 = e.addNode('router', 560, 250, { hostname: 'R1' });
  const sw2 = e.addNode('switch', 790, 250, { hostname: 'SW2' });
  const web = e.addNode('server', 1010, 150, {
    hostname: 'WEB-01',
    ip: '10.0.0.5/24',
    gateway: '10.0.0.1',
    services: [svc(80, 'HTTP'), svc(22, 'SSH'), svc(443, 'HTTPS')],
  });
  const dns = e.addNode('server', 1010, 350, { hostname: 'DNS-01', ip: '10.0.0.53/24', gateway: '10.0.0.1', services: [svc(53, 'DNS', 'UDP')] });
  wire(e, pcA.id, sw1.id);
  wire(e, pcB.id, sw1.id);
  wire(e, sw1.id, r1.id, undefined, '192.168.1.1/24');
  wire(e, r1.id, sw2.id, '10.0.0.1/24');
  wire(e, sw2.id, web.id);
  wire(e, sw2.id, dns.id);
}

function natDmz(e: NetworkEngine): void {
  const pc1 = e.addNode('host', 100, 140, { hostname: 'PC-1', ip: '192.168.1.10/24', gateway: '192.168.1.1' });
  const pc2 = e.addNode('host', 100, 330, { hostname: 'PC-2', ip: '192.168.1.11/24', gateway: '192.168.1.1' });
  const sw = e.addNode('switch', 300, 235, { hostname: 'SW-LAN' });
  const fw = e.addNode('firewall', 520, 235, {
    hostname: 'FW-EDGE',
    routes: [{ destination: '0.0.0.0/0', nextHop: '203.0.113.1' }],
    acl: [
      rule('ALLOW', 'TCP', '172.16.0.0/24', '80', '192.168.1.0/24', 'ANY'),
      rule('DENY', 'TCP', '172.16.0.0/24', 'ANY', '192.168.1.0/24', 'ANY'),
    ],
  });
  const dmz = e.addNode('server', 520, 450, { hostname: 'DMZ-WEB', ip: '172.16.0.10/24', gateway: '172.16.0.1', services: [svc(80, 'HTTP'), svc(443, 'HTTPS')] });
  const isp = e.addNode('router', 760, 235, { hostname: 'ISP-GW' });
  const pub = e.addNode('server', 1000, 235, { hostname: 'PUBLIC-WEB', ip: '93.184.216.34/24', gateway: '93.184.216.1', services: [svc(80, 'HTTP'), svc(443, 'HTTPS'), svc(53, 'DNS', 'UDP')] });
  wire(e, pc1.id, sw.id);
  wire(e, pc2.id, sw.id);
  wire(e, sw.id, fw.id, undefined, '192.168.1.1/24');
  wire(e, fw.id, dmz.id, '172.16.0.1/24');
  const wan = wire(e, fw.id, isp.id, '203.0.113.2/30', '203.0.113.1/30');
  wire(e, isp.id, pub.id, '93.184.216.1/24');
  // The ISP has no route back to RFC 1918 space — only NAT makes replies possible.
  fw.nat = { enabled: true, outsideIfaceId: wan.a.ifaceId };
}

function aclBlock(e: NetworkEngine): void {
  const pcA = e.addNode('host', 110, 150, { hostname: 'PC-A', ip: '192.168.1.10/24', gateway: '192.168.1.1' });
  const pcB = e.addNode('host', 110, 350, { hostname: 'PC-B', ip: '192.168.1.11/24', gateway: '192.168.1.1' });
  const sw = e.addNode('switch', 340, 250, { hostname: 'SW1' });
  const fw = e.addNode('firewall', 590, 250, {
    hostname: 'FW1',
    acl: [rule('ALLOW', 'TCP', 'ANY', 'ANY', '10.0.0.5', '80'), rule('DENY', 'ANY', 'ANY', 'ANY', 'ANY', '22')],
  });
  const srv = e.addNode('server', 850, 250, { hostname: 'APP-SRV', ip: '10.0.0.5/24', gateway: '10.0.0.1', services: [svc(80, 'HTTP'), svc(22, 'SSH')] });
  wire(e, pcA.id, sw.id);
  wire(e, pcB.id, sw.id);
  wire(e, sw.id, fw.id, undefined, '192.168.1.1/24');
  wire(e, fw.id, srv.id, '10.0.0.1/24');
}

function arpCollision(e: NetworkEngine): void {
  const sw = e.addNode('switch', 520, 260, { hostname: 'SW1' });
  const a = e.addNode('host', 200, 130, { hostname: 'PC-A', ip: '192.168.1.10/24' });
  const b = e.addNode('host', 840, 130, { hostname: 'PC-B', ip: '192.168.1.20/24' });
  const c = e.addNode('host', 840, 400, { hostname: 'PC-C-CLONE', ip: '192.168.1.20/24' });
  const d = e.addNode('host', 200, 400, { hostname: 'PC-D', ip: '192.168.1.30/24' });
  for (const n of [a, b, c, d]) wire(e, n.id, sw.id);
}

// ── mission topologies (deliberately misconfigured) ──────────────────────────

function missionSubnet(e: NetworkEngine): void {
  const a = e.addNode('host', 200, 240, { hostname: 'HOST-A', ip: '192.168.1.10/24' });
  const sw = e.addNode('switch', 520, 240, { hostname: 'SW1' });
  const b = e.addNode('host', 840, 240, { hostname: 'HOST-B', ip: '192.168.1.200/28' });
  wire(e, a.id, sw.id);
  wire(e, sw.id, b.id);
}

function missionIntruder(e: NetworkEngine): void {
  const rogue = e.addNode('host', 110, 130, { hostname: 'ROGUE', ip: '203.0.113.66/24', gateway: '203.0.113.1' });
  const partner = e.addNode('host', 110, 370, { hostname: 'PARTNER', ip: '203.0.113.20/24', gateway: '203.0.113.1' });
  const swWan = e.addNode('switch', 330, 250, { hostname: 'SW-WAN' });
  const fw = e.addNode('firewall', 560, 250, { hostname: 'FW1', acl: [rule('ALLOW', 'TCP', 'ANY', 'ANY', '10.0.0.5', '443')] });
  const swLan = e.addNode('switch', 780, 250, { hostname: 'SW-LAN' });
  const db = e.addNode('server', 1000, 150, { hostname: 'DB-01', ip: '10.0.0.5/24', gateway: '10.0.0.1', services: [svc(3306, 'MySQL'), svc(443, 'HTTPS')] });
  const app = e.addNode('host', 1000, 350, { hostname: 'APP-01', ip: '10.0.0.10/24', gateway: '10.0.0.1' });
  wire(e, rogue.id, swWan.id);
  wire(e, partner.id, swWan.id);
  wire(e, swWan.id, fw.id, undefined, '203.0.113.1/24');
  wire(e, fw.id, swLan.id, '10.0.0.1/24');
  wire(e, swLan.id, db.id);
  wire(e, swLan.id, app.id);
}

function missionGateway(e: NetworkEngine): void {
  const pc = e.addNode('host', 110, 250, { hostname: 'PC-A', ip: '192.168.1.10/24', gateway: '192.168.1.1' });
  const sw = e.addNode('switch', 320, 250, { hostname: 'SW1' });
  const r1 = e.addNode('router', 540, 250, { hostname: 'ROUTER-1' }); // no default route — that is the fault
  const isp = e.addNode('router', 780, 250, { hostname: 'ISP-WAN', routes: [{ destination: '192.168.1.0/24', nextHop: '203.0.113.2' }] });
  const dns = e.addNode('server', 1010, 250, { hostname: 'PUBLIC-DNS', ip: '8.8.8.8/24', gateway: '8.8.8.1', services: [svc(53, 'DNS', 'UDP')] });
  wire(e, pc.id, sw.id);
  wire(e, sw.id, r1.id, undefined, '192.168.1.1/24');
  wire(e, r1.id, isp.id, '203.0.113.2/30', '203.0.113.1/30');
  wire(e, isp.id, dns.id, '8.8.8.1/24');
}

export const SCENARIOS: Scenario[] = [
  {
    id: 'basic-lan',
    name: 'Basic LAN to Web Server',
    group: 'preset',
    description: 'Two PCs behind a switch reach a server farm through a router. Watch ARP, MAC learning and TTL decrement.',
    build: basicLan,
    quickActions: [
      { label: 'PC-A pings WEB-01', from: 'PC-A', dstIp: '10.0.0.5', kind: 'ping', expect: 'ARP for the gateway first, then ICMP crosses R1 (TTL 64→63).' },
      { label: 'PC-A HTTP GET WEB-01', from: 'PC-A', dstIp: '10.0.0.5', kind: 'http', expect: 'SYN → SYN-ACK → ACK, then GET / and 200 OK.' },
      { label: 'PC-B SSH to WEB-01', from: 'PC-B', dstIp: '10.0.0.5', kind: 'ssh', expect: 'Handshake on port 22 and banner exchange.' },
      { label: 'PC-B DNS query', from: 'PC-B', dstIp: '10.0.0.53', kind: 'dns', expect: 'Single UDP datagram each way.' },
    ],
  },
  {
    id: 'nat-dmz',
    name: 'NAT Gateway & DMZ',
    group: 'preset',
    description: 'A three-legged firewall: private LAN, DMZ and WAN. Outbound traffic is source-NATed to 203.0.113.2.',
    build: natDmz,
    quickActions: [
      { label: 'PC-1 HTTP to Internet', from: 'PC-1', dstIp: '93.184.216.34', kind: 'http', expect: 'Source rewritten to 203.0.113.2:4000x on egress, restored on the reply.' },
      { label: 'PC-2 pings Internet', from: 'PC-2', dstIp: '93.184.216.34', kind: 'ping', expect: 'ICMP id is used as the NAT "port".' },
      { label: 'PC-1 HTTP to DMZ', from: 'PC-1', dstIp: '172.16.0.10', kind: 'http', expect: 'Routed LAN→DMZ; replies allowed by ACL rule #1.' },
      { label: 'DMZ-WEB probes LAN :22', from: 'DMZ-WEB', dstIp: '192.168.1.10', kind: 'ssh', expect: 'Blocked — the DMZ may not open connections into the LAN.' },
    ],
  },
  {
    id: 'acl-block',
    name: 'Firewall ACL Block (Port 22/80)',
    group: 'preset',
    description: 'A stateless ACL permits HTTP to the app server and denies SSH everywhere.',
    build: aclBlock,
    quickActions: [
      { label: 'PC-A HTTP :80', from: 'PC-A', dstIp: '10.0.0.5', kind: 'http', expect: 'Permitted by rule #1 — packets turn green after inspection.' },
      { label: 'PC-A SSH :22', from: 'PC-A', dstIp: '10.0.0.5', kind: 'ssh', expect: 'SYN bursts red at FW1: rejected by rule #2.' },
      { label: 'PC-B ping', from: 'PC-B', dstIp: '10.0.0.5', kind: 'ping', expect: 'No rule matches ICMP — implicit allow.' },
    ],
  },
  {
    id: 'arp-collision',
    name: 'ARP Resolution & Collision',
    group: 'preset',
    description: 'A flat LAN where two stations claim 192.168.1.20. See broadcasts flood and the ARP cache get overwritten.',
    build: arpCollision,
    quickActions: [
      { label: 'PC-A pings PC-D', from: 'PC-A', dstIp: '192.168.1.30', kind: 'ping', expect: 'Clean resolution: broadcast request, unicast reply.' },
      { label: 'PC-A pings .20 (duplicate)', from: 'PC-A', dstIp: '192.168.1.20', kind: 'ping', expect: 'Two ARP replies race — the terminal flags an ARP conflict.' },
      { label: 'PC-D pings PC-A', from: 'PC-D', dstIp: '192.168.1.10', kind: 'ping', expect: 'Already learned: no ARP needed, switch forwards on one port.' },
    ],
  },
  {
    id: 'mission-subnet',
    name: 'Mission 1 · Subnet Mismatch',
    group: 'mission',
    description: 'HOST-A cannot ping HOST-B even though they share a switch.',
    build: missionSubnet,
    quickActions: [{ label: 'HOST-A pings HOST-B', from: 'HOST-A', dstIp: '192.168.1.200', kind: 'ping', expect: 'The request arrives, but watch what HOST-B does with the reply.' }],
  },
  {
    id: 'mission-intruder',
    name: 'Mission 2 · Block the Intruder',
    group: 'mission',
    description: 'A rogue external host is reaching the internal database on port 3306.',
    build: missionIntruder,
    quickActions: [
      { label: 'ROGUE → DB-01 :3306', from: 'ROGUE', dstIp: '10.0.0.5', kind: 'tcp', port: 3306, expect: 'Currently succeeds — it must be dropped.' },
      { label: 'ROGUE → DB-01 :443', from: 'ROGUE', dstIp: '10.0.0.5', kind: 'tcp', port: 443, expect: 'Public HTTPS must stay reachable.' },
      { label: 'PARTNER → DB-01 :3306', from: 'PARTNER', dstIp: '10.0.0.5', kind: 'tcp', port: 3306, expect: 'The trusted partner must keep database access.' },
    ],
  },
  {
    id: 'mission-gateway',
    name: 'Mission 3 · Broken Gateway',
    group: 'mission',
    description: 'PC-A cannot resolve names through public DNS 8.8.8.8.',
    build: missionGateway,
    quickActions: [{ label: 'PC-A DNS query 8.8.8.8', from: 'PC-A', dstIp: '8.8.8.8', kind: 'dns', expect: 'ROUTER-1 has no route for it.' }],
  },
  {
    id: 'sandbox',
    name: 'Empty Sandbox',
    group: 'sandbox',
    description: 'A blank canvas. Place nodes from the palette, connect them and launch traffic.',
    build: () => {},
    quickActions: [],
  },
];

export const scenarioById = (id: string): Scenario => SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0];
