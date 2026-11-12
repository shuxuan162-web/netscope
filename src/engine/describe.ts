import type { ACLRule, OSIFrame, PacketTone } from '../types/network';

const hex4 = (n: number) => '0x' + n.toString(16).padStart(4, '0');

export function icmpName(type: number, code = 0): string {
  if (type === 8) return 'Echo (ping) request';
  if (type === 0) return 'Echo (ping) reply';
  if (type === 11) return 'Time-to-live exceeded';
  if (type === 3) return code === 3 ? 'Destination unreachable (port unreachable)' : 'Destination unreachable (network unreachable)';
  return `ICMP type ${type}`;
}

export interface FrameSummary {
  protocol: string;
  source: string;
  destination: string;
  info: string;
  /** Short tag drawn next to the packet on the canvas. */
  label: string;
  tone: PacketTone;
}

/** Wireshark-style one-line summary of a frame. */
export function describeFrame(f: OSIFrame): FrameSummary {
  if (f.arp) {
    const a = f.arp;
    return {
      protocol: 'ARP',
      source: f.eth.src,
      destination: f.eth.dst === 'FF:FF:FF:FF:FF:FF' ? 'Broadcast' : f.eth.dst,
      info: a.op === 'request' ? `Who has ${a.targetIp}? Tell ${a.senderIp}` : `${a.senderIp} is at ${a.senderMac}`,
      label: a.op === 'request' ? 'ARP?' : 'ARP',
      tone: 'arp',
    };
  }
  const ip = f.ip!;
  const tone: PacketTone = f.verified ? 'ok' : 'std';
  if (f.icmp) {
    const c = f.icmp;
    const echo = c.type === 8 || c.type === 0;
    return {
      protocol: 'ICMP',
      source: ip.src,
      destination: ip.dst,
      info: `${icmpName(c.type, c.code)}${echo ? `  id=${hex4(c.id)}, seq=${c.seq}` : ''}, ttl=${ip.ttl}`,
      label: c.type === 8 ? 'ICMP' : c.type === 0 ? 'REPLY' : 'ICMP!',
      tone,
    };
  }
  if (f.tcp) {
    const t = f.tcp;
    const len = f.payload?.length ?? 0;
    const flags = t.flags.join(', ');
    const firstLine = f.payload?.split('\r\n')[0];
    return {
      protocol: len && f.app ? f.app : 'TCP',
      source: ip.src,
      destination: ip.dst,
      info: len
        ? `${firstLine}  (${t.srcPort} → ${t.dstPort} [${flags}] Len=${len})`
        : `${t.srcPort} → ${t.dstPort} [${flags}] Seq=${t.seq} Ack=${t.ack} Win=${t.window} Len=0`,
      label: len && f.app ? f.app : t.flags.join('·'),
      tone,
    };
  }
  if (f.udp) {
    const u = f.udp;
    return {
      protocol: f.app ?? 'UDP',
      source: ip.src,
      destination: ip.dst,
      info: `${f.payload ?? ''}  (${u.srcPort} → ${u.dstPort} Len=${f.payload?.length ?? 0})`,
      label: f.app ?? 'UDP',
      tone,
    };
  }
  return { protocol: 'IPv4', source: ip.src, destination: ip.dst, info: 'IPv4 datagram', label: 'IP', tone };
}

/** `TCP 192.168.1.10:54321 -> 10.0.0.5:22` — the form used in ACL log lines. */
export function fiveTuple(f: OSIFrame): string {
  const ip = f.ip!;
  const l4 = f.tcp ?? f.udp;
  return l4
    ? `${ip.protocol} ${ip.src}:${l4.srcPort} -> ${ip.dst}:${l4.dstPort}`
    : `${ip.protocol} ${ip.src} -> ${ip.dst}`;
}

export function formatRule(r: ACLRule): string {
  return `${r.action} ${r.protocol} ${r.src}:${r.srcPort} -> ${r.dst}:${r.dstPort}`;
}

export function cloneFrame(f: OSIFrame): OSIFrame {
  return {
    ...f,
    eth: { ...f.eth },
    arp: f.arp && { ...f.arp },
    ip: f.ip && { ...f.ip },
    icmp: f.icmp && { ...f.icmp },
    tcp: f.tcp && { ...f.tcp, flags: [...f.tcp.flags] },
    udp: f.udp && { ...f.udp },
  };
}

/** Synthetic application-layer request/response for a well-known port. */
export function appExchange(port: number, protocol: 'TCP' | 'UDP', serverName: string, dstIp: string) {
  if (protocol === 'UDP' || port === 53) {
    return {
      app: 'DNS',
      request: 'Standard query 0x1a2b A example.com',
      response: 'Standard query response 0x1a2b A example.com → 93.184.216.34',
    };
  }
  switch (port) {
    case 80:
    case 8080: {
      const body = `<html><body><h1>Hello from ${serverName}</h1></body></html>`;
      return {
        app: 'HTTP',
        request: `GET / HTTP/1.1\r\nHost: ${dstIp}\r\nUser-Agent: NetScope/1.0\r\nAccept: */*\r\n\r\n`,
        response: `HTTP/1.1 200 OK\r\nServer: ${serverName}\r\nContent-Type: text/html\r\nContent-Length: ${body.length}\r\n\r\n${body}`,
      };
    }
    case 22:
      return { app: 'SSH', request: 'SSH-2.0-OpenSSH_9.6 NetScope-client\r\n', response: `SSH-2.0-OpenSSH_9.6 ${serverName}\r\n` };
    case 443:
      return {
        app: 'TLS',
        request: `TLSv1.3 Client Hello (SNI=${dstIp})`,
        response: 'TLSv1.3 Server Hello, Certificate, Finished',
      };
    case 3306:
      return { app: 'MySQL', request: 'Login Request user=app db=production', response: `Server Greeting proto=10 version=8.0.36 (${serverName}) OK` };
    default:
      return { app: 'DATA', request: `HELLO ${dstIp}:${port}`, response: `OK ${serverName}:${port}` };
  }
}

export function serviceName(port: number, protocol: 'TCP' | 'UDP'): string {
  if (port === 53) return 'DNS';
  if (protocol === 'UDP') return 'UDP';
  return ({ 22: 'SSH', 80: 'HTTP', 443: 'HTTPS', 3306: 'MySQL', 8080: 'HTTP-ALT' } as Record<number, string>)[port] ?? 'TCP';
}
