/** IPv4 / MAC helpers. Addresses are handled as unsigned 32-bit integers. */

export const BROADCAST_MAC = 'FF:FF:FF:FF:FF:FF';
export const ZERO_MAC = '00:00:00:00:00:00';

export function isValidIp(s: string): boolean {
  const parts = s.split('.');
  return parts.length === 4 && parts.every((o) => /^\d{1,3}$/.test(o) && Number(o) <= 255);
}

export function ipToInt(ip: string): number {
  return ip.split('.').reduce((acc, o) => acc * 256 + Number(o), 0) >>> 0;
}

export function intToIp(n: number): string {
  return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}

export function prefixToMaskInt(prefix: number): number {
  return prefix <= 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
}

export function prefixToMask(prefix: number): string {
  return intToIp(prefixToMaskInt(prefix));
}

export function networkOf(ip: string, prefix: number): string {
  return intToIp((ipToInt(ip) & prefixToMaskInt(prefix)) >>> 0);
}

export function inSubnet(ip: string, netIp: string, prefix: number): boolean {
  if (!isValidIp(ip) || !isValidIp(netIp)) return false;
  const mask = prefixToMaskInt(prefix);
  return (ipToInt(ip) & mask) >>> 0 === (ipToInt(netIp) & mask) >>> 0;
}

/** Parses `a.b.c.d` or `a.b.c.d/len`. A bare address is treated as a /32. */
export function parseCidr(s: string): { ip: string; prefix: number } | null {
  const [ip, len, ...rest] = s.trim().split('/');
  if (rest.length || !isValidIp(ip)) return null;
  if (len === undefined) return { ip, prefix: 32 };
  if (!/^\d{1,2}$/.test(len) || Number(len) > 32) return null;
  return { ip, prefix: Number(len) };
}

export function isValidMac(s: string): boolean {
  return /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/.test(s);
}

/** ACL address match: `ANY`, a single IP or a CIDR block. */
export function matchAddr(rule: string, ip: string): boolean {
  const r = rule.trim().toUpperCase();
  if (r === 'ANY' || r === '' || r === '*') return true;
  const cidr = parseCidr(rule);
  return !!cidr && inSubnet(ip, cidr.ip, cidr.prefix);
}

export function isValidAddrPattern(s: string): boolean {
  const r = s.trim().toUpperCase();
  return r === 'ANY' || r === '*' || parseCidr(s) !== null;
}

export function isValidPortPattern(s: string): boolean {
  const r = s.trim().toUpperCase();
  return r === 'ANY' || r === '*' || (/^\d{1,5}$/.test(r) && Number(r) >= 1 && Number(r) <= 65535);
}
