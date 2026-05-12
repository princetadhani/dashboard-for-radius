import type { Server as IOServer } from 'socket.io';
import { env } from '../lib/env.js';
import {
  installScriptCommand,
  runSshCommand,
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

/**
 * After install/repair, poll the host's :9000/api/service/status until
 * it responds healthy or we time out.
 */
export async function waitForHealthy(
  ipAddress: string,
  port: number,
  io: IOServer,
  room: string,
): Promise<boolean> {
  const url = `http://${ipAddress}:${port}/api/service/status`;
  const deadline = Date.now() + env.sshPostInstallHealthcheckTimeoutMs;
  const sessionId = room.startsWith('provision:') ? room.slice('provision:'.length) : room;
  io.to(room).emit('provision:log', {
    line: `Waiting for ${url} to become healthy...`,
    level: 'system',
    ts: Date.now(),
    sessionId,
  });

  while (Date.now() < deadline) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), env.statusHttpTimeoutMs);
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(t);
      if (res.ok) {
        const body = (await res.json()) as { status?: string; active?: boolean };
        if (body.status === 'running' && body.active === true) {
          io.to(room).emit('provision:log', {
            line: `Service is healthy (status=running, active=true)`,
            level: 'system',
            ts: Date.now(),
            sessionId,
          });
          return true;
        }
      }
    } catch {
      // ignore and retry
    }
    await new Promise((r) => setTimeout(r, 3_000));
  }
  io.to(room).emit('provision:log', {
    line: 'Timed out waiting for service to become healthy',
    level: 'stderr',
    ts: Date.now(),
    sessionId,
  });
  return false;
}
