import type { Server as IOServer } from 'socket.io';
import { prisma } from '../lib/prisma.js';
import { env } from '../lib/env.js';

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
  const preferred = host.controlIp ?? host.ipAddress;

  // Fast path: probe the preferred IP only.
  const fast = await probeOne(preferred, host.port);
  if (fast.kind === 'ok') {
    return {
      hostId: host.id,
      reachable: true,
      service: fast.snapshot,
      ts: Date.now(),
    };
  }

  // Fallback: probe every other known IP in parallel.
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
      return {
        hostId: host.id,
        reachable: true,
        service: winner.outcome.snapshot,
        ts: Date.now(),
      };
    }
    // Fallback also produced no ok response; classify based on best info we have.
    if (winner && winner.outcome.kind === 'http-bad') {
      return {
        hostId: host.id,
        reachable: true,
        service: { healthy: false, status: 'unknown' },
        ts: Date.now(),
      };
    }
  }

  // Fast probe was http-bad means TCP up but body not ok → reachable, unhealthy.
  if (fast.kind === 'http-bad') {
    return {
      hostId: host.id,
      reachable: true,
      service: { healthy: false, status: 'unknown' },
      ts: Date.now(),
    };
  }

  return {
    hostId: host.id,
    reachable: false,
    service: { healthy: false },
    ts: Date.now(),
  };
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
