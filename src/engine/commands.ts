import type { FlowKind } from '../types/network';
import { formatRule } from './describe';
import { networkOf } from './ip';
import type { NetworkEngine } from './networkEngine';

const HELP = [
  'Commands:',
  '  ping|http|ssh|dns <source-host> <dest-ip>     launch traffic, e.g.  ping PC-A 10.0.0.5',
  '  tcp <source-host> <dest-ip> <port>            open a TCP connection to any port',
  '  show arp|mac|route|nat|acl|ip <node>          dump a table, e.g.  show route R1',
  '  flush                                         clear all ARP / MAC / NAT tables',
  '  nodes                                         list every node and its addresses',
  '  clear                                         clear this console',
];

/** Executes one line typed into the terminal console; output goes to the engine log. */
export function runCommand(engine: NetworkEngine, line: string): void {
  const raw = line.trim();
  if (!raw) return;
  const [cmd, ...args] = raw.split(/\s+/);
  const out = (msg: string, level: 'info' | 'warn' = 'info') => engine.log('CLI', level, msg);
  const verb = cmd.toLowerCase();

  if (verb === 'clear') return engine.clearLogs();
  engine.log('CLI', 'cmd', `> ${raw}`);

  if (verb === 'help' || verb === '?') return HELP.forEach((l) => out(l));

  if (verb === 'flush') return engine.flushTables();

  if (verb === 'nodes') {
    for (const n of engine.nodes) {
      const addrs = n.interfaces.filter((i) => i.ip).map((i) => `${i.name} ${i.ip}/${i.prefix}`);
      out(`${n.hostname.padEnd(12)} ${n.kind.padEnd(9)} ${addrs.join(', ') || '—'}`);
    }
    return;
  }

  if (['ping', 'http', 'ssh', 'dns', 'tcp'].includes(verb)) {
    const [src, dst, port] = args;
    const node = src ? engine.byName(src) : undefined;
    if (!node || !dst) return out(`Usage: ${verb} <source-host> <dest-ip>${verb === 'tcp' ? ' <port>' : ''}   (hosts: ${engine.nodes.filter((n) => n.kind !== 'switch').map((n) => n.hostname).join(', ')})`, 'warn');
    if (verb === 'tcp' && !/^\d+$/.test(port ?? '')) return out('Usage: tcp <source-host> <dest-ip> <port>', 'warn');
    // Accept a hostname as destination for convenience.
    const target = engine.byName(dst)?.interfaces.find((i) => i.ip)?.ip ?? dst;
    const result = engine.startFlow({ srcNodeId: node.id, dstIp: target, kind: verb as FlowKind, port: port ? Number(port) : undefined });
    if (typeof result === 'string') out(result, 'warn');
    return;
  }

  if (verb === 'show') {
    const [what, name] = args;
    const node = name ? engine.byName(name) : undefined;
    if (!what || !node) return out('Usage: show arp|mac|route|nat|acl|ip <node>', 'warn');
    switch (what.toLowerCase()) {
      case 'arp':
        out(`ARP cache of ${node.hostname} (${node.arpTable.length} entries)`);
        node.arpTable.forEach((a) => out(`  ${a.ip.padEnd(16)} ${a.mac}`));
        return;
      case 'mac':
        out(`MAC address table of ${node.hostname} (${node.macTable.length} entries)`);
        node.macTable.forEach((m) => out(`  ${m.mac}  →  ${node.interfaces.find((i) => i.id === m.portId)?.name ?? '?'}`));
        return;
      case 'route':
        out(`Routing table of ${node.hostname}`);
        node.interfaces.filter((i) => i.ip).forEach((i) => out(`  C  ${`${networkOf(i.ip, i.prefix)}/${i.prefix}`.padEnd(20)} directly connected, ${i.name}`));
        node.routes.forEach((r) => out(`  S  ${r.destination.padEnd(20)} via ${r.nextHop}`));
        if (node.gateway) out(`  S* ${'0.0.0.0/0'.padEnd(20)} via ${node.gateway} (default gateway)`);
        return;
      case 'nat':
        out(`NAT translations on ${node.hostname} (${node.natTable.length})`);
        node.natTable.forEach((e) => out(`  ${e.protocol.padEnd(5)} ${`${e.insideIp}:${e.insidePort}`.padEnd(22)} ⇄ ${e.publicIp}:${e.publicPort}`));
        return;
      case 'acl':
        out(`ACL on ${node.hostname} (${node.acl.length} rules, first match wins)`);
        node.acl.forEach((r, i) => out(`  #${i + 1} ${formatRule(r)}${r.enabled ? '' : '  [disabled]'}`));
        out(`  #${node.acl.length + 1} ALLOW ANY ANY:ANY -> ANY:ANY  [implicit]`);
        return;
      case 'ip':
        node.interfaces.forEach((i) => out(`  ${i.name.padEnd(7)} ${(i.ip ? `${i.ip}/${i.prefix}` : 'unassigned').padEnd(20)} ${i.mac}  ${i.linkId ? 'up' : 'down'}`));
        return;
    }
    return out(`Unknown table "${what}". Try: show arp|mac|route|nat|acl|ip <node>`, 'warn');
  }

  out(`Unknown command "${cmd}". Type "help".`, 'warn');
}
