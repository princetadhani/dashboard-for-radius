import { createConnection } from 'net';
import { promises as dnsPromises } from 'dns';
import type { Server as IOServer } from 'socket.io';
import { prisma } from '../lib/prisma.js';
import { env } from '../lib/env.js';

/** Returns true if the string is a hostname rather than a bare IPv4/IPv6 address. */
function isHostname(s: string): boolean {
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(s)) return false; // IPv4
  if (s.includes(':')) return false;                      // IPv6
  return true;
}

// Ordered list of DNS servers to try. The Resolver will fall back through
// them automatically: private/on-prem DNS first, then public resolvers.
const DNS_SERVERS = ['10.14.0.1', '8.8.8.8', '1.1.1.1'];

/**
 * Resolve a hostname to ALL its A-record IPs using the configured DNS servers.
 * Returns an empty array on any failure (NXDOMAIN, timeout, etc.).
 */
async function resolveToIps(hostname: string): Promise<string[]> {
  // timeout: ms per query attempt per server; tries: attempts per server before moving on.
  const resolver = new dnsPromises.Resolver({ timeout: 3_000, tries: 1 });
  resolver.setServers(DNS_SERVERS);
  try {
    return await resolver.resolve4(hostname);
  } catch {
    return [];
  }
}

/** TCP-connect to `host:port` to confirm the machine is up, without HTTP. */
function tcpPing(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    const timer = setTimeout(() => { socket.destroy(); resolve(false); }, timeoutMs);
    socket.once('connect', () => { clearTimeout(timer); socket.destroy(); resolve(true); });
    socket.once('error', () => { clearTimeout(timer); resolve(false); });
  });
}

export type ServiceSnapshot = {
  healthy: boolean;
  status?: 'running' | 'stopped' | 'unknown';
  active?: boolean;
  pid?: number;
  memory?: number;
  description?: string;
};

export type HostStatusUpdate = {
  hostId: string;
  reachable: boolean;
  service: ServiceSnapshot;
  ts: number;
  resolvedIps?: string[];
};

const lastByHost = new Map<string, HostStatusUpdate>();

export function getCachedStatus(hostId: string): HostStatusUpdate | undefined {
  return lastByHost.get(hostId);
}

export function getAllCachedStatuses(): HostStatusUpdate[] {
  return Array.from(lastByHost.values());
}

type ProbeOutcome =
  | { kind: 'ok'; snapshot: ServiceSnapshot }
  | { kind: 'http-bad' }
  | { kind: 'fail' };

async function probeOne(ip: string, port: number): Promise<ProbeOutcome> {
  const url = `http://${ip}:${port}/api/service/status`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), env.statusHttpTimeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return { kind: 'http-bad' };
    const body = (await res.json()) as ServiceSnapshot & { status?: string };
    return {
      kind: 'ok',
      snapshot: {
        healthy: body.status === 'running' && body.active === true,
        status: (body.status as ServiceSnapshot['status']) ?? 'unknown',
        active: body.active,
        pid: body.pid,
        memory: body.memory,
        description: body.description,
      },
    };
  } catch {
    clearTimeout(timer);
    return { kind: 'fail' };
  }
}

function parseStringList(s: string | null | undefined): string[] {
  if (!s) return [];
  try {
    const parsed = JSON.parse(s);
    return Array.isArray(parsed) ? parsed.filter((t) => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Probe candidates in parallel, return the first one that comes back `kind: 'ok'`.
 * If none come back ok, prefer the first http-bad over a connection failure.
 */
async function probeFirstHealthy(
  ips: string[],
  port: number,
): Promise<{ ip: string; outcome: ProbeOutcome } | null> {
  if (ips.length === 0) return null;
  return new Promise((resolve) => {
    let pending = ips.length;
    let firstHttpBad: { ip: string; outcome: ProbeOutcome } | null = null;
    let resolved = false;
    ips.forEach((ip) => {
      probeOne(ip, port).then((outcome) => {
        if (resolved) return;
        if (outcome.kind === 'ok') {
          resolved = true;
          resolve({ ip, outcome });
          return;
        }
        if (outcome.kind === 'http-bad' && !firstHttpBad) {
          firstHttpBad = { ip, outcome };
        }
        if (--pending === 0 && !resolved) {
          resolved = true;
          resolve(firstHttpBad);
        }
      });
    });
  });
}

type HostForProbe = {
  id: string;
  ipAddress: string;
  controlIp: string | null;
  knownIps: string;
  port: number;
};

async function probeHost(io: IOServer, host: HostForProbe): Promise<HostStatusUpdate> {
  // If the user stored a hostname (not a bare IP), resolve all its A-records once
  // so the UI can identify which discovered interface IPs the hostname maps to.
  const resolvedIps = isHostname(host.ipAddress)
    ? await resolveToIps(host.ipAddress)
    : undefined;

  const preferred = host.controlIp ?? host.ipAddress;

  // Run TCP ping (SSH port 22 — always open on managed hosts) and HTTP in parallel.
  // This decouples host reachability from service health: the machine can be up
  // even when the freeradius container is stopped/deleted.
  const [tcpReachable, fast] = await Promise.all([
    tcpPing(preferred, 22, 2_000),
    probeOne(preferred, host.port),
  ]);

  // Host is reachable if SSH port responds OR HTTP responds (any non-connection-fail).
  const reachable = tcpReachable || fast.kind !== 'fail';

  if (fast.kind === 'ok') {
    return { hostId: host.id, reachable: true, service: fast.snapshot, ts: Date.now(), resolvedIps};
  }

  // HTTP on preferred IP failed — try fallback IPs in parallel for service health.
  const allKnown = Array.from(
    new Set([host.ipAddress, ...parseStringList(host.knownIps)]),
  );
  const fallbackIps = allKnown.filter((ip) => ip !== preferred);

  if (fallbackIps.length > 0) {
    const winner = await probeFirstHealthy(fallbackIps, host.port);
    if (winner && winner.outcome.kind === 'ok') {
      // Auto-heal: another interface answered, promote it to controlIp.
      const newControlIp = winner.ip === host.ipAddress ? null : winner.ip;
      try {
        const updated = await prisma.host.update({
          where: { id: host.id },
          data: { controlIp: newControlIp },
        });
        io.emit('host:updated', {
          ...updated,
          tags: parseStringList(updated.tags),
          knownIps: parseStringList(updated.knownIps),
        });
      } catch {
        // host may have been deleted between findMany and update — ignore
      }
      return { hostId: host.id, reachable: true, service: winner.outcome.snapshot, ts: Date.now(), resolvedIps};
    }
    if (winner && winner.outcome.kind === 'http-bad') {
      return { hostId: host.id, reachable, service: { healthy: false, status: 'unknown' }, ts: Date.now(), resolvedIps};
    }
  }

  if (fast.kind === 'http-bad') {
    return { hostId: host.id, reachable, service: { healthy: false, status: 'unknown' }, ts: Date.now(), resolvedIps};
  }

  // No HTTP response from any IP — reachable is determined by TCP ping alone.
  return { hostId: host.id, reachable, service: { healthy: false }, ts: Date.now(), resolvedIps};
}

let timer: NodeJS.Timeout | null = null;

export function startStatusPoller(io: IOServer): void {
  if (timer) return;

  const tick = async () => {
    const hosts = await prisma.host.findMany({
      select: { id: true, ipAddress: true, controlIp: true, knownIps: true, port: true },
    });
    const updates = await Promise.all(hosts.map((h) => probeHost(io, h)));
    for (const u of updates) {
      lastByHost.set(u.hostId, u);
      io.emit('status:update', u);
    }
    const liveIds = new Set(hosts.map((h) => h.id));
    for (const id of lastByHost.keys()) {
      if (!liveIds.has(id)) lastByHost.delete(id);
    }
  };

  void tick();
  timer = setInterval(tick, env.statusPollIntervalMs);
}

export function stopStatusPoller(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
