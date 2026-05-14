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
  // Exclude docker/bridge virtual interfaces — their IPs (e.g. 172.17.0.1 on docker0)
  // exist on every Docker host and would cause the backend to probe itself.
  const cmd =
    "ip -4 -o addr show scope global 2>/dev/null" +
    " | grep -Ev '\\s(docker[0-9]*|br-[a-f0-9]+|virbr[0-9]*)\\s'" +
    " | awk '{print $4}' | cut -d/ -f1";
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

type ProbeResult =
  | { ok: true }
  | { ok: false; reason: string };

async function probeOnce(ip: string, port: number): Promise<ProbeResult> {
  const url = `http://${ip}:${port}/api/service/status`;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), env.statusHttpTimeoutMs);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status} ${res.statusText}` };
    const body = (await res.json()) as { status?: string; active?: boolean };
    if (body.status !== 'running' || body.active !== true) {
      return { ok: false, reason: `status=${body.status ?? '?'} active=${body.active ?? '?'}` };
    }
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, reason: msg };
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
    const results = await Promise.all(ips.map(async (ip) => ({ ip, result: await probeOnce(ip, port) })));
    const winner = results.find((r) => r.result.ok);
    if (winner) {
      io.to(room).emit('provision:log', {
        line: `Service is healthy at http://${winner.ip}:${port}`,
        level: 'system',
        ts: Date.now(),
        sessionId,
      });
      return winner.ip;
    }
    // Log why each candidate failed so the user can see the actual error
    const failures = results
      .map((r) => `${r.ip}: ${(r.result as { ok: false; reason: string }).reason}`)
      .join(' | ');
    io.to(room).emit('provision:log', {
      line: `Not healthy yet — ${failures}`,
      level: 'system',
      ts: Date.now(),
      sessionId,
    });
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
