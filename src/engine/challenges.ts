import type { Flow, FlowKind } from '../types/network';

export interface ChallengeTest {
  label: string;
  /** Hostname of the node that originates the test traffic. */
  from: string;
  dstIp: string;
  kind: FlowKind;
  port?: number;
  expect: 'success' | 'acl-drop';
}

export interface Challenge {
  id: string;
  scenarioId: string;
  title: string;
  difficulty: 'Easy' | 'Medium';
  brief: string;
  objectives: string[];
  hints: string[];
  /** Traffic launched by "Verify fix"; every test must meet its expectation. */
  tests: ChallengeTest[];
}

export const CHALLENGES: Challenge[] = [
  {
    id: 'subnet-mismatch',
    scenarioId: 'mission-subnet',
    title: 'Subnet Mismatch',
    difficulty: 'Easy',
    brief:
      'HOST-A (192.168.1.10) and HOST-B (192.168.1.200) hang off the same switch, yet pings from A never get an answer. ARP resolves and the echo request arrives — so why is there no reply?',
    objectives: ['HOST-A receives an ICMP echo reply from 192.168.1.200.'],
    hints: [
      'Run the ping and read HOST-B\'s lines in the Terminal: it reports "Network unreachable" when it tries to answer.',
      'A host only talks directly to addresses inside its own subnet. Compare the prefix length on both hosts.',
      'Click HOST-B, open Node Config and change its subnet mask from /28 to /24.',
    ],
    tests: [{ label: 'HOST-A pings 192.168.1.200', from: 'HOST-A', dstIp: '192.168.1.200', kind: 'ping', expect: 'success' }],
  },
  {
    id: 'block-intruder',
    scenarioId: 'mission-intruder',
    title: 'Block the Intruder',
    difficulty: 'Medium',
    brief:
      'Threat intel flagged 203.0.113.66 (ROGUE) hammering the internal database DB-01 on MySQL port 3306. Stop it at FW1 — without breaking public HTTPS on 443 or the trusted PARTNER\'s database access.',
    objectives: [
      'ROGUE → 10.0.0.5:3306 is dropped by an ACL rule on FW1.',
      'ROGUE → 10.0.0.5:443 still completes.',
      'PARTNER → 10.0.0.5:3306 still completes.',
    ],
    hints: [
      'The firewall evaluates rules top-down and the first match wins. Anything unmatched is implicitly allowed.',
      'A rule that denies port 3306 for everyone would lock out PARTNER too — match on the source address.',
      'On FW1 add: DENY · TCP · source 203.0.113.66 · source port ANY · destination 10.0.0.5 · destination port 3306.',
    ],
    tests: [
      { label: 'ROGUE → DB-01:3306 is blocked', from: 'ROGUE', dstIp: '10.0.0.5', kind: 'tcp', port: 3306, expect: 'acl-drop' },
      { label: 'ROGUE → DB-01:443 stays open', from: 'ROGUE', dstIp: '10.0.0.5', kind: 'tcp', port: 443, expect: 'success' },
      { label: 'PARTNER → DB-01:3306 stays open', from: 'PARTNER', dstIp: '10.0.0.5', kind: 'tcp', port: 3306, expect: 'success' },
    ],
  },
  {
    id: 'broken-gateway',
    scenarioId: 'mission-gateway',
    title: 'Broken Gateway',
    difficulty: 'Medium',
    brief:
      'Users behind ROUTER-1 lost name resolution. Queries to public DNS 8.8.8.8 leave PC-A, reach ROUTER-1 … and die there. The ISP side (203.0.113.1) is healthy.',
    objectives: ['A DNS query from PC-A to 8.8.8.8 is answered.'],
    hints: [
      'Launch the DNS query and read ROUTER-1\'s [ROUTE] line: it only knows its two connected networks.',
      'Anything not in the routing table needs a default route — destination 0.0.0.0/0.',
      'Click ROUTER-1, open Node Config → Static routes, and add 0.0.0.0/0 via next hop 203.0.113.1 (the ISP-WAN side of the WAN link).',
    ],
    tests: [{ label: 'PC-A resolves via 8.8.8.8', from: 'PC-A', dstIp: '8.8.8.8', kind: 'dns', expect: 'success' }],
  },
];

export function testPassed(test: ChallengeTest, flow: Flow | undefined): boolean {
  if (!flow) return false;
  return test.expect === 'success' ? flow.state === 'success' : flow.state === 'failed' && flow.reason === 'acl-drop';
}

export function describeOutcome(flow: Flow | undefined): string {
  if (!flow) return 'could not start';
  if (flow.state === 'success') return 'completed';
  if (flow.state !== 'failed') return 'in progress';
  const reasons: Record<string, string> = {
    'acl-drop': 'dropped by firewall ACL',
    'no-route': 'no route to destination',
    'arp-timeout': 'host unreachable (ARP timeout)',
    ttl: 'TTL expired',
    refused: 'connection refused',
    unreachable: 'destination unreachable',
    loss: 'packet lost',
    timeout: 'timed out',
    cancelled: 'cancelled',
  };
  return reasons[flow.reason ?? ''] ?? 'failed';
}
