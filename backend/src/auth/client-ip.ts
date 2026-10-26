import { isIP } from 'node:net';
import type { Request } from 'express';
import { fail } from '../common/http.js';

interface AddressRange {
  family: 4 | 6;
  first: bigint;
  last: bigint;
}

function addressNumber(address: string, family: 4 | 6): bigint {
  if (family === 4)
    return address
      .split('.')
      .reduce((value, part) => (value << 8n) + BigInt(part), 0n);
  // URL canonicalizes embedded IPv4 forms before expansion into eight hextets.
  const canonical = new URL(`http://[${address}]/`).hostname.slice(1, -1);
  const halves = canonical.split('::');
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves[1] ? halves[1].split(':') : [];
  const words =
    halves.length === 2
      ? [
          ...left,
          ...Array<string>(8 - left.length - right.length).fill('0'),
          ...right,
        ]
      : left;
  if (words.length !== 8) throw new Error('Invalid AUTH_TRUSTED_PROXY_CIDRS');
  return words.reduce(
    (value, word) => (value << 16n) + BigInt(`0x${word}`),
    0n,
  );
}

function range(entry: string): AddressRange {
  const parts = entry.split('/');
  const family = isIP(parts[0]);
  if (
    (family !== 4 && family !== 6) ||
    parts[0].includes('%') ||
    parts.length > 2
  )
    throw new Error('Invalid AUTH_TRUSTED_PROXY_CIDRS');
  const width = family === 4 ? 32 : 128;
  const prefix = parts.length === 1 ? width : Number(parts[1]);
  if (parts.length === 2 && !/^(0|[1-9][0-9]*)$/.test(parts[1]))
    throw new Error('Invalid AUTH_TRUSTED_PROXY_CIDRS');
  if (!Number.isSafeInteger(prefix) || prefix < 1 || prefix > width)
    throw new Error('Invalid AUTH_TRUSTED_PROXY_CIDRS');
  const size = 1n << BigInt(width - prefix);
  const first = (addressNumber(parts[0], family) / size) * size;
  return { family, first, last: first + size - 1n };
}

function covers(ranges: AddressRange[], first: bigint, last: bigint): boolean {
  let next = first;
  for (const item of [...ranges].sort((a, b) =>
    a.first < b.first ? -1 : a.first > b.first ? 1 : 0,
  )) {
    if (item.last < next) continue;
    if (item.first > next) return false;
    next = item.last + 1n;
    if (next > last) return true;
  }
  return false;
}

function sameAddress(first: string, second: string): boolean {
  const mappedStart = 0xffffn << 32n;
  const normalized = (address: string) => {
    const family = isIP(address) as 4 | 6;
    const value = addressNumber(address, family);
    if (family === 4) return `4:${value}`;
    if (value >= mappedStart && value < mappedStart + (1n << 32n))
      return `4:${value - mappedStart}`;
    return `6:${value}`;
  };
  return normalized(first) === normalized(second);
}

/** Reject a union that makes every IPv4, IPv6, or mapped IPv4 peer trusted. */
export function trustedProxyCidrs(value: unknown): string[] {
  if (value === undefined || value === '') return [];
  if (typeof value !== 'string')
    throw new Error('Invalid AUTH_TRUSTED_PROXY_CIDRS');
  const entries = value.split(',').map((part) => part.trim());
  if (entries.length > 64 || entries.some((entry) => !entry))
    throw new Error('Invalid AUTH_TRUSTED_PROXY_CIDRS');
  const ranges = entries.map(range);
  const ipv4 = ranges.filter((item) => item.family === 4);
  const ipv6 = ranges.filter((item) => item.family === 6);
  const mappedStart = 0xffffn << 32n;
  const mapped = [
    ...ipv6,
    ...ipv4.map((item) => ({
      family: 6 as const,
      first: mappedStart + item.first,
      last: mappedStart + item.last,
    })),
  ];
  if (
    covers(ipv4, 0n, (1n << 32n) - 1n) ||
    covers(ipv6, 0n, (1n << 128n) - 1n) ||
    covers(mapped, mappedStart, mappedStart + (1n << 32n) - 1n)
  )
    throw new Error('Invalid AUTH_TRUSTED_PROXY_CIDRS');
  return entries;
}

/** Fail closed when a trusted ingress did not supply a usable client hop. */
export function trustedClientIp(request: Request): string {
  const remote = request.socket?.remoteAddress;
  const ip = request.ip;
  if (
    !remote ||
    !isIP(remote) ||
    remote.includes('%') ||
    !ip ||
    !isIP(ip) ||
    ip.includes('%')
  )
    fail(503, 'SERVICE_UNAVAILABLE', 'Client address unavailable', [], true, 5);
  const trust = request.app?.get('trust proxy fn') as
    ((address: string, hop: number) => boolean) | undefined;
  const forwarded = request.ips;
  // proxy-addr stops before testing the farthest selected address. Express's
  // ips excludes the socket, so its length is that address's original hop index.
  if (
    trust?.(remote, 0) &&
    (!request.headers['x-forwarded-for'] ||
      !forwarded?.length ||
      sameAddress(ip, remote) ||
      trust(ip, forwarded.length))
  )
    fail(503, 'SERVICE_UNAVAILABLE', 'Client address unavailable', [], true, 5);
  return ip;
}
