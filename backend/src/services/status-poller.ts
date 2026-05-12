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

async function probeHost(host: {
  id: string;
  ipAddress: string;
  port: number;
}): Promise<HostStatusUpdate> {
  const url = `http://${host.ipAddress}:${host.port}/api/service/status`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), env.statusHttpTimeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) {
      return {
        hostId: host.id,
        reachable: true,
        service: { healthy: false, status: 'unknown' },
        ts: Date.now(),
      };
    }
    const body = (await res.json()) as ServiceSnapshot & { status?: string };
    const healthy = body.status === 'running' && body.active === true;
    return {
      hostId: host.id,
      reachable: true,
      service: {
        healthy,
        status: (body.status as ServiceSnapshot['status']) ?? 'unknown',
        active: body.active,
        pid: body.pid,
        memory: body.memory,
        description: body.description,
      },
      ts: Date.now(),
    };
  } catch {
    clearTimeout(timer);
    return {
      hostId: host.id,
      reachable: false,
      service: { healthy: false },
      ts: Date.now(),
    };
  }
}

let timer: NodeJS.Timeout | null = null;

export function startStatusPoller(io: IOServer): void {
  if (timer) return;

  const tick = async () => {
    const hosts = await prisma.host.findMany({
      select: { id: true, ipAddress: true, port: true },
    });
    const updates = await Promise.all(hosts.map(probeHost));
    for (const u of updates) {
      lastByHost.set(u.hostId, u);
      io.emit('status:update', u);
    }
    // Clean cache for deleted hosts
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
