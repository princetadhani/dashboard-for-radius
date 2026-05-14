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

async function probeViaSsh(creds: SshCreds, port: number): Promise<ProbeResult> {
  const r = await sshExecCapture(
    creds,
    `curl -sf --max-time 5 http://127.0.0.1:${port}/api/service/status`,
    10_000,
  );
  if (!r.ok) return { ok: false, reason: `SSH exec failed: ${r.error}` };
  try {
    const body = JSON.parse(r.stdout) as { status?: string; active?: boolean };
    if (body.status === 'running' && body.active === true) return { ok: true };
    return { ok: false, reason: `status=${body.status ?? '?'} active=${body.active ?? '?'}` };
  } catch {
    return { ok: false, reason: `could not parse response: ${r.stdout.slice(0, 80)}` };
  }
}

async function probeOnceHttp(ip: string, port: number): Promise<ProbeResult> {
  const url = `http://${ip}:${port}/api/service/status`;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), env.statusHttpTimeoutMs);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    const body = (await res.json()) as { status?: string; active?: boolean };
    if (body.status !== 'running' || body.active !== true) {
      return { ok: false, reason: `status=${body.status ?? '?'} active=${body.active ?? '?'}` };
    }
    return { ok: true };
  } catch (e) {
    const err = e as Error & { cause?: Error & { code?: string } };
    return { ok: false, reason: err.cause?.code ?? err.cause?.message ?? err.message };
  }
}

/**
 * Poll candidate IPs on `port`/api/service/status until healthy or timed out.
 *
 * Each tick tries direct HTTP probes first (fast path). If direct HTTP fails
 * for all candidates — e.g. because the remote app rejects connections from
 * the backend's IP — falls back to probing via SSH (curl 127.0.0.1 on the
 * remote host itself), which bypasses any IP allowlist.
 *
 * Returns the first IP that responded healthy via HTTP (preferred for ongoing
 * polling), or the entered IP when health was confirmed via SSH fallback.
 */
export async function waitForHealthy(
  candidateIps: string[],
  port: number,
  io: IOServer,
  room: string,
  sshCreds?: SshCreds,
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
    // Try direct HTTP on all candidates in parallel
    const httpResults = await Promise.all(
      ips.map(async (ip) => ({ ip, result: await probeOnceHttp(ip, port) })),
    );
    const httpWinner = httpResults.find((r) => r.result.ok);
    if (httpWinner) {
      io.to(room).emit('provision:log', {
        line: `Service is healthy at http://${httpWinner.ip}:${port}`,
        level: 'system',
        ts: Date.now(),
        sessionId,
      });
      return httpWinner.ip;
    }

    // Direct HTTP failed — try SSH fallback if creds available
    if (sshCreds) {
      const sshResult = await probeViaSsh(sshCreds, port);
      if (sshResult.ok) {
        io.to(room).emit('provision:log', {
          line: `Service is healthy (confirmed via SSH). Note: port ${port} is not directly reachable from this backend — status polling may show as unreachable until firewall rules allow access.`,
          level: 'system',
          ts: Date.now(),
          sessionId,
        });
        return sshCreds.ipAddress;
      }
    }

    const failures = httpResults
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
    line: `Timed out waiting for service to become healthy`,
    level: 'stderr',
    ts: Date.now(),
    sessionId,
  });
  return null;
}
