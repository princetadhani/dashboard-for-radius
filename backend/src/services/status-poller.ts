import { createConnection } from 'net';
import type { Server as IOServer } from 'socket.io';
import { prisma } from '../lib/prisma.js';
import { env } from '../lib/env.js';
import { isHostname, resolveHostname } from '../lib/dns-resolver.js';

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
    ? await resolveHostname(host.ipAddress)
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

// Prevents concurrent page-loads from triggering redundant full probe sweeps.
let lastProbeAllAt = 0;
const PROBE_ALL_COOLDOWN_MS = 30_000;

/**
 * Probe all hosts immediately. Skips if a full probe ran within the last 30s
 * so concurrent browser sessions don't pile up duplicate sweeps.
 */
export async function triggerProbeAll(io: IOServer): Promise<void> {
  const now = Date.now();
  if (now - lastProbeAllAt < PROBE_ALL_COOLDOWN_MS) return;
  lastProbeAllAt = now;
  const hosts = await prisma.host.findMany({
    select: { id: true, ipAddress: true, controlIp: true, knownIps: true, port: true },
  });
  const updates = await Promise.all(hosts.map((h) => probeHost(io, h)));
  for (const u of updates) {
    lastByHost.set(u.hostId, u);
    io.emit('status:update', u);
  }
}

/**
 * Immediately probe a single host by ID, store the result, and emit
 * status:update — used by the per-host refresh button.
 */
export async function triggerProbe(io: IOServer, hostId: string): Promise<void> {
  const host = await prisma.host.findUnique({
    where: { id: hostId },
    select: { id: true, ipAddress: true, controlIp: true, knownIps: true, port: true },
  });
  if (!host) return;
  const update = await probeHost(io, host);
  lastByHost.set(update.hostId, update);
  io.emit('status:update', update);
}

export function stopStatusPoller(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

const INTERFACE_POLL_MS = 15 * 60 * 1000; // 15 minutes
let interfaceTimer: NodeJS.Timeout | null = null;

/**
 * Fetch /api/service/dashboarddatadump from a single host and update
 * knownIps in the DB if any new interfaces are discovered.
 */
async function pollHostInterfaces(io: IOServer, host: HostForProbe): Promise<void> {
  const target = host.controlIp ?? host.ipAddress;
  const url = `http://${target}:${host.port}/api/service/dashboarddatadump`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return;

    const body = (await res.json()) as { interfaces?: unknown };
    if (!Array.isArray(body.interfaces)) return;

    const incoming = (body.interfaces as unknown[])
      .filter((ip): ip is string => typeof ip === 'string' && ip.length > 0);
    if (incoming.length === 0) return;

    const current = parseStringList(host.knownIps);
    const hasNew = incoming.some((ip) => !current.includes(ip));
    if (!hasNew) return;

    // Merge without duplicates — never include the hostname itself
    const merged = Array.from(new Set([...current, ...incoming]));
    const updated = await prisma.host.update({
      where: { id: host.id },
      data: { knownIps: JSON.stringify(merged) },
    });
    io.emit('host:updated', {
      ...updated,
      tags: parseStringList(updated.tags),
      knownIps: parseStringList(updated.knownIps),
    });
  } catch {
    clearTimeout(t);
    // Best-effort — silently skip unreachable hosts
  }
}

export function startInterfacePoller(io: IOServer): void {
  if (interfaceTimer) return;

  const tick = async () => {
    const hosts = await prisma.host.findMany({
      select: { id: true, ipAddress: true, controlIp: true, knownIps: true, port: true },
    });
    await Promise.all(hosts.map((h) => pollHostInterfaces(io, h)));
  };

  void tick();
  interfaceTimer = setInterval(tick, INTERFACE_POLL_MS);
}

export function stopInterfacePoller(): void {
  if (interfaceTimer) clearInterval(interfaceTimer);
  interfaceTimer = null;
}
