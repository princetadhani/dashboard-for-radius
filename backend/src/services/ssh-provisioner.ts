import type { Server as IOServer } from 'socket.io';
import { env } from '../lib/env.js';
import {
  installScriptCommand,
  runSshCommand,
  sshExecCapture,
  type CommandResult,
  type SshCreds,
} from './ssh-runner.js';

export type ProvisionParams = SshCreds;
export type ProvisionResult = CommandResult;

export async function runProvision(
  io: IOServer,
  room: string,
  params: ProvisionParams,
): Promise<ProvisionResult> {
  return runSshCommand(io, room, params, {
    command: installScriptCommand(env.installScriptUrl),
    timeoutMs: env.sshInstallTimeoutMs,
  });
}

const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}$/;

/**
 * Enumerate the host's globally-routable IPv4 addresses over SSH.
 * Falls back to an empty list on failure — caller should always include
 * the user-entered IP as a candidate too.
 */
export async function discoverHostIps(creds: SshCreds): Promise<string[]> {
  const cmd =
    "ip -4 -o addr show scope global 2>/dev/null | awk '{print $4}' | cut -d/ -f1 || hostname -I";
  const r = await sshExecCapture(creds, cmd, 10_000);
  if (!r.ok) return [];
  return r.stdout
    .split(/\s+/)
    .map((s) => s.trim())
    .filter((s) => IPV4_RE.test(s));
}

function sessionIdFromRoom(room: string): string {
  return room.startsWith('provision:') ? room.slice('provision:'.length) : room;
}

async function probeOnce(ip: string, port: number): Promise<boolean> {
  const url = `http://${ip}:${port}/api/service/status`;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), env.statusHttpTimeoutMs);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return false;
    const body = (await res.json()) as { status?: string; active?: boolean };
    return body.status === 'running' && body.active === true;
  } catch {
    return false;
  }
}

/**
 * Poll candidate IPs on `port`/api/service/status until one is healthy or we
 * time out. Returns the first IP that responded healthy, or null.
 *
 * Candidates are tried in order each tick; the first match wins. The user-
 * entered IP should be passed first so we prefer it when it works.
 */
export async function waitForHealthy(
  candidateIps: string[],
  port: number,
  io: IOServer,
  room: string,
): Promise<string | null> {
  const sessionId = sessionIdFromRoom(room);
  const ips = Array.from(new Set(candidateIps.filter((ip) => IPV4_RE.test(ip))));
  if (ips.length === 0) {
    io.to(room).emit('provision:log', {
      line: 'No candidate IPs to health-check',
      level: 'stderr',
      ts: Date.now(),
      sessionId,
    });
    return null;
  }

  const list = ips.map((ip) => `http://${ip}:${port}/api/service/status`).join(', ');
  io.to(room).emit('provision:log', {
    line: `Waiting for service to become healthy on any of: ${list}`,
    level: 'system',
    ts: Date.now(),
    sessionId,
  });

  const deadline = Date.now() + env.sshPostInstallHealthcheckTimeoutMs;
  while (Date.now() < deadline) {
    for (const ip of ips) {
      if (await probeOnce(ip, port)) {
        io.to(room).emit('provision:log', {
          line: `Service is healthy at http://${ip}:${port} (status=running, active=true)`,
          level: 'system',
          ts: Date.now(),
          sessionId,
        });
        return ip;
      }
    }
    await new Promise((r) => setTimeout(r, 3_000));
  }
  io.to(room).emit('provision:log', {
    line: `Timed out waiting for service to become healthy on any of: ${list}`,
    level: 'stderr',
    ts: Date.now(),
    sessionId,
  });
  return null;
}
