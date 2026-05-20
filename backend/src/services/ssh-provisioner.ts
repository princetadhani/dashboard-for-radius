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
  scriptUrl?: string,
): Promise<ProvisionResult> {
  return runSshCommand(io, room, params, {
    command: installScriptCommand(scriptUrl ?? env.installScriptUrl),
    timeoutMs: env.sshInstallTimeoutMs,
  });
}

const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}$/;

/**
 * Enumerate the host's globally-routable IPv4 addresses over SSH.
 * Falls back to an empty list on failure — caller should always include
 * the user-entered IP as a candidate too.
 */
/**
 * Check whether port 9000 is already bound on the remote host.
 * Uses `ss` (iproute2 — present on all modern distros).
 * Returns { free: true } if the port is available or the check is inconclusive.
 * Returns { free: false, occupiedBy } if something is already listening.
 */
export async function checkPort9000Free(
  creds: SshCreds,
): Promise<{ free: true } | { free: false; occupiedBy: string }> {
  // `|| true` ensures exit code 0 regardless so sshExecCapture doesn't treat
  // "no match" (grep exit 1) as a failure.
  const r = await sshExecCapture(
    creds,
    "ss -tlnp 2>/dev/null | grep ':9000' || true",
    8_000,
  );
  // SSH itself failed — let provisioning proceed and surface the real error.
  if (!r.ok || !r.stdout.trim()) return { free: true };

  // ss output includes users:(("processname",pid=N,...)) when a process owns the port.
  const match = r.stdout.match(/users:\(\("([^"]+)"/);
  const occupiedBy = match?.[1] ?? 'an unknown process';
  return { free: false, occupiedBy };
}

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

// Three-state probe result:
//   healthy    — control panel API up + freeradius running
//   reachable  — control panel API up, freeradius stopped (install done, service issue)
//   failed     — couldn't connect at all (network/firewall)
type ProbeResult =
  | { kind: 'healthy' }
  | { kind: 'reachable'; reason: string }
  | { kind: 'failed'; reason: string };

export type HealthResult = {
  ip: string;
  serviceHealthy: boolean;
};

async function probeViaSsh(creds: SshCreds, port: number): Promise<ProbeResult> {
  const r = await sshExecCapture(
    creds,
    `curl -s --max-time 5 http://127.0.0.1:${port}/api/service/status`,
    10_000,
  );
  if (!r.ok) return { kind: 'failed', reason: `SSH exec failed: ${r.error}` };
  try {
    const body = JSON.parse(r.stdout) as { status?: string; active?: boolean };
    if (body.status === 'running' && body.active === true) return { kind: 'healthy' };
    // API responded — control panel is up, freeradius just isn't running
    return { kind: 'reachable', reason: `status=${body.status ?? '?'} active=${body.active ?? '?'}` };
  } catch {
    return { kind: 'failed', reason: `unexpected response: ${r.stdout.slice(0, 80)}` };
  }
}

async function probeOnceHttp(ip: string, port: number): Promise<ProbeResult> {
  const url = `http://${ip}:${port}/api/service/status`;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), env.statusHttpTimeoutMs);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return { kind: 'failed', reason: `HTTP ${res.status}` };
    const body = (await res.json()) as { status?: string; active?: boolean };
    if (body.status === 'running' && body.active === true) return { kind: 'healthy' };
    // HTTP 200 + valid JSON but freeradius not running — control panel is up
    return { kind: 'reachable', reason: `status=${body.status ?? '?'} active=${body.active ?? '?'}` };
  } catch (e) {
    const err = e as Error & { cause?: Error & { code?: string } };
    return { kind: 'failed', reason: err.cause?.code ?? err.cause?.message ?? err.message };
  }
}

/**
 * Poll candidate IPs on `port`/api/service/status.
 *
 * Returns:
 *   { ip, serviceHealthy: true }  — freeradius running, normal case
 *   { ip, serviceHealthy: false } — control panel API is up but freeradius is
 *                                   stopped; install completed, host should still
 *                                   be added so the user can start the service
 *                                   from the UI
 *   null                          — could not reach the host at all (network/firewall)
 *
 * Tries direct HTTP first. Falls back to SSH curl (bypasses IP allowlists).
 * Returns immediately on first "reachable" result — no point waiting since the
 * control panel is up and the user can recover from there.
 */
export async function waitForHealthy(
  candidateIps: string[],
  port: number,
  io: IOServer,
  room: string,
  sshCreds?: SshCreds,
): Promise<HealthResult | null> {
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
    const httpResults = await Promise.all(
      ips.map(async (ip) => ({ ip, result: await probeOnceHttp(ip, port) })),
    );

    const healthy = httpResults.find((r) => r.result.kind === 'healthy');
    if (healthy) {
      io.to(room).emit('provision:log', {
        line: `Service is healthy at http://${healthy.ip}:${port}`,
        level: 'system',
        ts: Date.now(),
        sessionId,
      });
      return { ip: healthy.ip, serviceHealthy: true };
    }

    // Control panel API responded but freeradius is stopped — add host immediately
    const reachable = httpResults.find((r) => r.result.kind === 'reachable');
    if (reachable) {
      const reason = (reachable.result as { kind: 'reachable'; reason: string }).reason;
      io.to(room).emit('provision:log', {
        line: `Control panel is up at http://${reachable.ip}:${port} but FreeRADIUS is not running (${reason}). Adding host — use the UI to start the service.`,
        level: 'system',
        ts: Date.now(),
        sessionId,
      });
      return { ip: reachable.ip, serviceHealthy: false };
    }

    // All direct HTTP failed — try SSH fallback
    if (sshCreds) {
      const sshResult = await probeViaSsh(sshCreds, port);
      if (sshResult.kind === 'healthy') {
        io.to(room).emit('provision:log', {
          line: `Service is healthy (confirmed via SSH). Note: port ${port} is not directly reachable from this backend — status polling may show as unreachable until firewall rules allow access.`,
          level: 'system',
          ts: Date.now(),
          sessionId,
        });
        return { ip: sshCreds.ipAddress, serviceHealthy: true };
      }
      if (sshResult.kind === 'reachable') {
        io.to(room).emit('provision:log', {
          line: `Control panel is up (confirmed via SSH) but FreeRADIUS is not running (${sshResult.reason}). Adding host — use the UI to start the service.`,
          level: 'system',
          ts: Date.now(),
          sessionId,
        });
        return { ip: sshCreds.ipAddress, serviceHealthy: false };
      }
    }

    const failures = httpResults
      .map((r) => `${r.ip}: ${(r.result as { kind: 'failed'; reason: string }).reason}`)
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
