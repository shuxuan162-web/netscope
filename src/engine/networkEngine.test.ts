import { describe, expect, it } from 'vitest';
import type { Flow } from '../types/network';
import { checksum, encodeFrame } from '../utils/bytes';
import { CHALLENGES, testPassed } from './challenges';
import { NetworkEngine, type FlowRequest } from './networkEngine';
import { scenarioById } from './scenarios';

function boot(id: string): NetworkEngine {
  const e = new NetworkEngine();
  const s = scenarioById(id);
  e.load(s.build, s.name);
  return e;
}

function run(e: NetworkEngine, from: string, req: Omit<FlowRequest, 'srcNodeId'>): Flow {
  const flow = e.startFlow({ srcNodeId: e.byName(from)!.id, ...req });
  if (typeof flow === 'string') throw new Error(flow);
  e.runUntilIdle();
  return flow;
}

const logText = (e: NetworkEngine) => e.logs.map((l) => `[${l.node}] ${l.msg}`).join('\n');

describe('basic LAN', () => {
  it('resolves ARP, routes a ping across the router and decrements TTL', () => {
    const e = boot('basic-lan');
    const flow = run(e, 'PC-A', { dstIp: '10.0.0.5', kind: 'ping' });
    expect(flow.state).toBe('success');
    expect(e.byName('PC-A')!.arpTable.map((a) => a.ip)).toEqual(['192.168.1.1']);
    expect(e.byName('SW1')!.macTable.length).toBe(2);
    const atServer = e.captures.find((c) => c.toHost === 'WEB-01' && c.frame.icmp?.type === 8)!;
    expect(atServer.frame.ip!.ttl).toBe(63);
    expect(e.captures[0].protocol).toBe('ARP');
    expect(e.captures[0].frame.eth.dst).toBe('FF:FF:FF:FF:FF:FF');
  });

  it('completes a TCP handshake and HTTP exchange', () => {
    const e = boot('basic-lan');
    const flow = run(e, 'PC-A', { dstIp: '10.0.0.5', kind: 'http' });
    expect(flow.state).toBe('success');
    const flags = e.captures.filter((c) => c.frame.tcp && c.toHost === 'R1').map((c) => c.frame.tcp!.flags.join('+'));
    expect(flags).toEqual(['SYN', 'SYN+ACK', 'ACK', 'PSH+ACK', 'PSH+ACK', 'ACK']);
    expect(e.captures.some((c) => c.frame.payload?.startsWith('HTTP/1.1 200 OK'))).toBe(true);
  });

  it('answers DNS over UDP and refuses closed TCP ports', () => {
    const e = boot('basic-lan');
    expect(run(e, 'PC-B', { dstIp: '10.0.0.53', kind: 'dns' }).state).toBe('success');
    const refused = run(e, 'PC-B', { dstIp: '10.0.0.53', kind: 'ssh' });
    expect(refused.reason).toBe('refused');
  });

  it('drops a packet whose TTL expires at the router', () => {
    const e = boot('basic-lan');
    const flow = run(e, 'PC-A', { dstIp: '10.0.0.5', kind: 'ping', ttl: 1 });
    expect(flow.reason).toBe('ttl');
    expect(e.captures.some((c) => c.frame.icmp?.type === 11 && c.toHost === 'PC-A')).toBe(true);
  });

  it('times out ARP for a host that does not exist', () => {
    const e = boot('basic-lan');
    expect(run(e, 'PC-A', { dstIp: '192.168.1.99', kind: 'ping' }).reason).toBe('arp-timeout');
  });

  it('is deterministic for a given loss rate', () => {
    const outcome = () => {
      const e = boot('basic-lan');
      e.lossRate = 0.3;
      const flows = [1, 2, 3, 4].map(() => run(e, 'PC-A', { dstIp: '10.0.0.5', kind: 'http' }));
      return flows.map((f) => `${f.state}:${f.reason ?? ''}`).join('|') + `@${e.captures.length}`;
    };
    expect(outcome()).toBe(outcome());
  });
});

describe('firewall ACL', () => {
  it('permits HTTP and rejects SSH with the matching rule number', () => {
    const e = boot('acl-block');
    expect(run(e, 'PC-A', { dstIp: '10.0.0.5', kind: 'http' }).state).toBe('success');
    const ssh = run(e, 'PC-A', { dstIp: '10.0.0.5', kind: 'ssh' });
    expect(ssh.reason).toBe('acl-drop');
    expect(logText(e)).toMatch(/\[ACL DROP\] Packet TCP 192\.168\.1\.10:\d+ -> 10\.0\.0\.5:22 rejected by Rule #2/);
    expect(run(e, 'PC-B', { dstIp: '10.0.0.5', kind: 'ping' }).state).toBe('success');
  });
});

describe('NAT gateway & DMZ', () => {
  it('source-NATs outbound traffic and restores the reply', () => {
    const e = boot('nat-dmz');
    const flow = run(e, 'PC-1', { dstIp: '93.184.216.34', kind: 'http' });
    expect(flow.state).toBe('success');
    const fw = e.byName('FW-EDGE')!;
    expect(fw.natTable).toHaveLength(1);
    const onWan = e.captures.find((c) => c.fromHost === 'FW-EDGE' && c.toHost === 'ISP-GW' && c.frame.tcp)!;
    expect(onWan.frame.ip!.src).toBe('203.0.113.2');
    expect(onWan.frame.tcp!.srcPort).toBe(fw.natTable[0].publicPort);
    expect(run(e, 'PC-2', { dstIp: '93.184.216.34', kind: 'ping' }).state).toBe('success');
  });

  it('fails without NAT because the ISP cannot route private addresses', () => {
    const e = boot('nat-dmz');
    e.byName('FW-EDGE')!.nat.enabled = false;
    expect(run(e, 'PC-1', { dstIp: '93.184.216.34', kind: 'http' }).reason).toBe('no-route');
  });

  it('lets the LAN reach the DMZ but not the reverse', () => {
    const e = boot('nat-dmz');
    expect(run(e, 'PC-1', { dstIp: '172.16.0.10', kind: 'http' }).state).toBe('success');
    expect(run(e, 'DMZ-WEB', { dstIp: '192.168.1.10', kind: 'ssh' }).reason).toBe('acl-drop');
  });
});

describe('ARP collision', () => {
  it('flags a duplicate IP when two stations answer', () => {
    const e = boot('arp-collision');
    run(e, 'PC-A', { dstIp: '192.168.1.20', kind: 'ping' });
    expect(logText(e)).toContain('[ARP CONFLICT]');
    expect(e.captures.filter((c) => c.frame.arp?.op === 'reply' && c.toHost === 'PC-A')).toHaveLength(2);
  });
});

describe('challenge missions', () => {
  const verify = (e: NetworkEngine, id: string) => {
    const ch = CHALLENGES.find((c) => c.id === id)!;
    const flows = ch.tests.map((t) => e.startFlow({ srcNodeId: e.byName(t.from)!.id, dstIp: t.dstIp, kind: t.kind, port: t.port }) as Flow);
    e.runUntilIdle();
    return ch.tests.every((t, i) => testPassed(t, flows[i]));
  };

  it('subnet mismatch is broken until HOST-B uses /24', () => {
    const e = boot('mission-subnet');
    expect(verify(e, 'subnet-mismatch')).toBe(false);
    expect(logText(e)).toContain('Network unreachable');
    e.mutate(() => (e.byName('HOST-B')!.interfaces[0].prefix = 24));
    expect(verify(e, 'subnet-mismatch')).toBe(true);
  });

  it('intruder is only blocked by a source-specific deny rule', () => {
    const e = boot('mission-intruder');
    expect(verify(e, 'block-intruder')).toBe(false);
    const fw = e.byName('FW1')!;
    const deny = { id: 'x', action: 'DENY' as const, protocol: 'TCP' as const, srcPort: 'ANY', dst: '10.0.0.5', dstPort: '3306', enabled: true };
    e.mutate(() => fw.acl.push({ ...deny, src: 'ANY' }));
    expect(verify(e, 'block-intruder')).toBe(false); // locks the partner out too
    e.mutate(() => (fw.acl[fw.acl.length - 1].src = '203.0.113.66'));
    expect(verify(e, 'block-intruder')).toBe(true);
  });

  it('broken gateway is fixed by a default route via the ISP', () => {
    const e = boot('mission-gateway');
    expect(verify(e, 'broken-gateway')).toBe(false);
    expect(logText(e)).toContain('No route to 8.8.8.8');
    e.mutate(() => e.byName('ROUTER-1')!.routes.push({ id: 'd', destination: '0.0.0.0/0', nextHop: '203.0.113.1' }));
    expect(verify(e, 'broken-gateway')).toBe(true);
  });
});

describe('frame encoder', () => {
  it('emits valid IPv4 and TCP checksums', () => {
    const e = boot('basic-lan');
    run(e, 'PC-A', { dstIp: '10.0.0.5', kind: 'http' });
    const cap = e.captures.find((c) => c.frame.tcp && c.frame.payload)!;
    const { bytes, layers } = encodeFrame(cap.frame);
    const ipHeader = Array.from(bytes.slice(14, 34));
    expect(checksum(ipHeader)).toBe(0);
    const seg = Array.from(bytes.slice(34));
    const pseudo = [...ipHeader.slice(12, 20), 0, 6, seg.length >> 8, seg.length & 255];
    expect(checksum([...pseudo, ...seg])).toBe(0);
    expect(layers.map((l) => l.layer)).toEqual([2, 3, 4, 7]);
    expect(layers[layers.length - 1].end).toBe(bytes.length);
  });

  it('encodes a 42-byte ARP request', () => {
    const e = boot('arp-collision');
    run(e, 'PC-A', { dstIp: '192.168.1.30', kind: 'ping' });
    expect(encodeFrame(e.captures[0].frame).bytes.length).toBe(42);
  });
});
