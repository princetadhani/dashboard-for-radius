import { promises as dnsPromises } from 'dns';

/** Returns true if the string is a hostname rather than a bare IPv4/IPv6 address. */
export function isHostname(s: string): boolean {
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(s)) return false; // IPv4
  if (s.includes(':')) return false;                      // IPv6
  return true;
}

// Ordered list: private/on-prem DNS first, then public resolvers as fallback.
// The Resolver tries each in order, moving on after timeout.
const DNS_SERVERS = ['10.14.0.1', '8.8.8.8', '1.1.1.1'];

/**
 * Resolve a hostname to all its A (IPv4) and AAAA (IPv6) records using the
 * configured DNS servers. Both record types are fetched in parallel.
 * Returns [] if the hostname has no records or DNS is unreachable.
 */
export async function resolveHostname(hostname: string): Promise<string[]> {
  const resolver = new dnsPromises.Resolver({ timeout: 3_000, tries: 1 });
  resolver.setServers(DNS_SERVERS);

  const [ipv4, ipv6] = await Promise.allSettled([
    resolver.resolve4(hostname),
    resolver.resolve6(hostname),
  ]);

  return [
    ...(ipv4.status === 'fulfilled' ? ipv4.value : []),
    ...(ipv6.status === 'fulfilled' ? ipv6.value : []),
  ];
}

/**
 * Resolve a hostname to its first IP for use in a direct connection (SSH, TCP).
 * If the input is already an IP, returns it unchanged.
 * Falls back to the original hostname string on DNS failure so the caller's
 * own library (ssh2, net) can attempt system DNS as a last resort.
 */
export async function resolveToConnectAddress(address: string): Promise<string> {
  if (!isHostname(address)) return address;
  const ips = await resolveHostname(address);
  return ips[0] ?? address;
}
