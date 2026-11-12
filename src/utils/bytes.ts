import { icmpName } from '../engine/describe';
import { ipToInt } from '../engine/ip';
import type { OSIFrame } from '../types/network';

/** A decoded header field and the byte range [start, end) it occupies. */
export interface FieldSpan {
  label: string;
  value: string;
  start: number;
  end: number;
}

export interface LayerSpan {
  layer: 2 | 3 | 4 | 7;
  title: string;
  summary: string;
  start: number;
  end: number;
  fields: FieldSpan[];
}

export interface EncodedFrame {
  bytes: Uint8Array;
  layers: LayerSpan[];
}

const hex = (n: number, width = 2) => '0x' + n.toString(16).padStart(width, '0');
const macBytes = (mac: string) => mac.split(':').map((h) => parseInt(h, 16) || 0);
const ipBytes = (ip: string) => {
  const n = ip ? ipToInt(ip) : 0;
  return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
};
const u16 = (n: number) => [(n >>> 8) & 255, n & 255];
const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0) & 255);

/** RFC 1071 Internet checksum. */
export function checksum(data: number[]): number {
  let sum = 0;
  for (let i = 0; i < data.length; i += 2) sum += (data[i] << 8) | (data[i + 1] ?? 0);
  while (sum >> 16) sum = (sum & 0xffff) + (sum >> 16);
  return ~sum & 0xffff;
}

const TCP_FLAG_BITS: Record<string, number> = { FIN: 0x01, SYN: 0x02, RST: 0x04, PSH: 0x08, ACK: 0x10 };

/**
 * Serialises a simulated frame into real wire bytes (Ethernet II, ARP, IPv4,
 * ICMP, TCP, UDP) with valid checksums, and records where each field lives so
 * the inspector can cross-highlight the header tree and the hex dump.
 */
export function encodeFrame(f: OSIFrame): EncodedFrame {
  const out: number[] = [];
  const layers: LayerSpan[] = [];

  const begin = (layer: LayerSpan['layer'], title: string, summary: string): LayerSpan => {
    const l: LayerSpan = { layer, title, summary, start: out.length, end: out.length, fields: [] };
    layers.push(l);
    return l;
  };
  const put = (l: LayerSpan, label: string, value: string, data: number[]) => {
    l.fields.push({ label, value, start: out.length, end: out.length + data.length });
    out.push(...data);
    l.end = out.length;
  };

  // ── Layer 2 ────────────────────────────────────────────────────────────────
  const eth = begin(2, 'Ethernet II', `${f.eth.src} → ${f.eth.dst}`);
  put(eth, 'Destination MAC', f.eth.dst + (f.eth.dst === 'FF:FF:FF:FF:FF:FF' ? ' (broadcast)' : ''), macBytes(f.eth.dst));
  put(eth, 'Source MAC', f.eth.src, macBytes(f.eth.src));
  put(eth, 'EtherType', f.arp ? 'ARP (0x0806)' : 'IPv4 (0x0800)', u16(f.arp ? 0x0806 : 0x0800));

  if (f.arp) {
    const a = f.arp;
    const arp = begin(3, 'Address Resolution Protocol', a.op === 'request' ? `Who has ${a.targetIp}?` : `${a.senderIp} is at ${a.senderMac}`);
    put(arp, 'Hardware type', 'Ethernet (1)', u16(1));
    put(arp, 'Protocol type', 'IPv4 (0x0800)', u16(0x0800));
    put(arp, 'Hardware size', '6', [6]);
    put(arp, 'Protocol size', '4', [4]);
    put(arp, 'Opcode', a.op === 'request' ? 'request (1)' : 'reply (2)', u16(a.op === 'request' ? 1 : 2));
    put(arp, 'Sender MAC', a.senderMac, macBytes(a.senderMac));
    put(arp, 'Sender IP', a.senderIp, ipBytes(a.senderIp));
    put(arp, 'Target MAC', a.targetMac, macBytes(a.targetMac));
    put(arp, 'Target IP', a.targetIp, ipBytes(a.targetIp));
    return { bytes: Uint8Array.from(out), layers };
  }

  const ip = f.ip;
  if (!ip) return { bytes: Uint8Array.from(out), layers };
  const payload = ascii(f.payload ?? '');
  const src = ipBytes(ip.src);
  const dst = ipBytes(ip.dst);
  const protoNum = ip.protocol === 'ICMP' ? 1 : ip.protocol === 'TCP' ? 6 : 17;

  // ── Layer 4 segment is built first: IPv4 needs its length ─────────────────
  let segment: number[] = [];
  let l4Fields: [string, string, number][] = []; // label, value, byte length
  let l4Title = '';
  let l4Summary = '';
  let headerLen = 0;

  if (f.icmp) {
    const c = f.icmp;
    const head = [c.type, c.code, 0, 0, ...u16(c.id), ...u16(c.seq)];
    const sum = checksum([...head, ...payload]);
    segment = [c.type, c.code, ...u16(sum), ...u16(c.id), ...u16(c.seq), ...payload];
    headerLen = 8;
    l4Title = 'Internet Control Message Protocol';
    l4Summary = icmpName(c.type, c.code);
    l4Fields = [
      ['Type', `${c.type} (${icmpName(c.type, c.code)})`, 1],
      ['Code', String(c.code), 1],
      ['Checksum', `${hex(sum, 4)} [correct]`, 2],
      ['Identifier', `${c.id} (${hex(c.id, 4)})`, 2],
      ['Sequence number', String(c.seq), 2],
    ];
  } else if (f.tcp) {
    const t = f.tcp;
    const flagBits = t.flags.reduce((acc, fl) => acc | TCP_FLAG_BITS[fl], 0);
    const head = (sum: number) => [...u16(t.srcPort), ...u16(t.dstPort), ...u32(t.seq), ...u32(t.ack), 0x50, flagBits, ...u16(t.window), ...u16(sum), 0, 0];
    const pseudo = [...src, ...dst, 0, 6, ...u16(20 + payload.length)];
    const sum = checksum([...pseudo, ...head(0), ...payload]);
    segment = [...head(sum), ...payload];
    headerLen = 20;
    l4Title = 'Transmission Control Protocol';
    l4Summary = `${t.srcPort} → ${t.dstPort} [${t.flags.join(', ')}]`;
    l4Fields = [
      ['Source port', String(t.srcPort), 2],
      ['Destination port', String(t.dstPort), 2],
      ['Sequence number', String(t.seq), 4],
      ['Acknowledgment number', String(t.ack), 4],
      ['Header length', '20 bytes (5)', 1],
      ['Flags', `${hex(flagBits)} (${t.flags.join(', ')})`, 1],
      ['Window', String(t.window), 2],
      ['Checksum', `${hex(sum, 4)} [correct]`, 2],
      ['Urgent pointer', '0', 2],
    ];
  } else if (f.udp) {
    const u = f.udp;
    const len = 8 + payload.length;
    const pseudo = [...src, ...dst, 0, 17, ...u16(len)];
    const sum = checksum([...pseudo, ...u16(u.srcPort), ...u16(u.dstPort), ...u16(len), 0, 0, ...payload]) || 0xffff;
    segment = [...u16(u.srcPort), ...u16(u.dstPort), ...u16(len), ...u16(sum), ...payload];
    headerLen = 8;
    l4Title = 'User Datagram Protocol';
    l4Summary = `${u.srcPort} → ${u.dstPort}`;
    l4Fields = [
      ['Source port', String(u.srcPort), 2],
      ['Destination port', String(u.dstPort), 2],
      ['Length', String(len), 2],
      ['Checksum', `${hex(sum, 4)} [correct]`, 2],
    ];
  }

  // ── Layer 3 ────────────────────────────────────────────────────────────────
  const total = 20 + segment.length;
  const ipHead = (sum: number) => [0x45, 0, ...u16(total), ...u16(ip.id), 0x40, 0, ip.ttl, protoNum, ...u16(sum), ...src, ...dst];
  const ipSum = checksum(ipHead(0));
  const l3 = begin(3, 'Internet Protocol Version 4', `${ip.src} → ${ip.dst}, TTL ${ip.ttl}`);
  put(l3, 'Version / IHL', '4 / 20 bytes', [0x45]);
  put(l3, 'DSCP / ECN', '0x00', [0]);
  put(l3, 'Total length', String(total), u16(total));
  put(l3, 'Identification', `${hex(ip.id, 4)} (${ip.id})`, u16(ip.id));
  put(l3, 'Flags / Fragment offset', "0x4000 (Don't Fragment)", [0x40, 0]);
  put(l3, 'Time to live', String(ip.ttl), [ip.ttl]);
  put(l3, 'Protocol', `${ip.protocol} (${protoNum})`, [protoNum]);
  put(l3, 'Header checksum', `${hex(ipSum, 4)} [correct]`, u16(ipSum));
  put(l3, 'Source address', ip.src, src);
  put(l3, 'Destination address', ip.dst, dst);

  // ── Layer 4 ────────────────────────────────────────────────────────────────
  if (segment.length) {
    const l4 = begin(4, l4Title, l4Summary);
    let off = 0;
    for (const [label, value, len] of l4Fields) {
      put(l4, label, value, segment.slice(off, off + len));
      off += len;
    }
    // ── Layer 7 ──────────────────────────────────────────────────────────────
    if (payload.length) {
      const isEcho = !!f.icmp;
      const l7 = begin(7, isEcho ? 'Data (ICMP echo payload)' : `${f.app ?? 'Application'} payload`, `${payload.length} bytes`);
      put(l7, isEcho ? 'Data' : 'Payload', JSON.stringify(f.payload).slice(1, -1), segment.slice(headerLen));
    }
  }

  return { bytes: Uint8Array.from(out), layers };
}
