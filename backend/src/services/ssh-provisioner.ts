import { Client } from 'ssh2';
import type { Server as IOServer } from 'socket.io';
import { env } from '../lib/env.js';

export type ProvisionParams = {
  ipAddress: string;
  sshPort: number;
  sshUsername: string;
  sshPassword: string;
};

export type ProvisionResult = { success: true } | { success: false; error: string };

// IMPORTANT: sudo runs OUTSIDE the curl pipe so that sudo's stdin is the SSH pty
// (not the curl output). This lets sudo prompt on the tty and read our password reply.
// Using `sudo -S` here would be wrong because stdin would be consumed by the pipe.
const INSTALL_CMD = `sudo -p 'SUDOPW:' bash -c "curl -sSL '${env.installScriptUrl}' | bash"`;

/**
 * Runs the one-click install script over SSH and streams stdout/stderr
 * to the given Socket.io room. Credentials are NOT logged or persisted.
 */
export async function runProvision(
  io: IOServer,
  room: string,
  params: ProvisionParams,
): Promise<ProvisionResult> {
  const { ipAddress, sshPort, sshUsername, sshPassword } = params;

  const emit = (line: string, level: 'info' | 'stderr' | 'system' = 'info') => {
    io.to(room).emit('provision:log', { line, level, ts: Date.now() });
  };

  return await new Promise<ProvisionResult>((resolve) => {
    const conn = new Client();
    let resolved = false;
    const finish = (r: ProvisionResult) => {
      if (resolved) return;
      resolved = true;
      try {
        conn.end();
      } catch { }
      resolve(r);
    };

    const timeout = setTimeout(() => {
      emit(`SSH install timed out after ${env.sshInstallTimeoutMs / 1000}s`, 'system');
      finish({ success: false, error: 'SSH install timed out' });
    }, env.sshInstallTimeoutMs);

    conn.on('ready', () => {
      emit(`SSH connection established to ${ipAddress}:${sshPort}`, 'system');
      emit(`Running one-click install...`, 'system');

      // pty:true so sudo can read the password if needed
      conn.exec(INSTALL_CMD, { pty: true }, (err, stream) => {
        if (err) {
          clearTimeout(timeout);
          emit(`exec error: ${err.message}`, 'stderr');
          return finish({ success: false, error: err.message });
        }

        // sudo prints our custom marker `SUDOPW:` whenever it wants the password.
        // Respond every time we see it (sudo retries up to 3 times). We never
        // log the marker line, and we never log the password itself.
        let sudoAttempts = 0;
        const MAX_SUDO_ATTEMPTS = 3;
        stream.on('data', (data: Buffer) => {
          const text = data.toString('utf8');
          if (text.includes('SUDOPW:')) {
            sudoAttempts++;
            if (sudoAttempts > MAX_SUDO_ATTEMPTS) {
              emit('sudo refused password (max attempts reached)', 'stderr');
              return;
            }
            stream.write(`${sshPassword}\n`);
            // Strip the marker out of any same-chunk trailing output before emitting.
            const rest = text.replace(/SUDOPW:\s*/g, '');
            for (const line of rest.split(/\r?\n/)) {
              if (line.length > 0) emit(line, 'info');
            }
            return;
          }
          for (const line of text.split(/\r?\n/)) {
            if (line.length > 0) emit(line, 'info');
          }
        });

        stream.stderr.on('data', (data: Buffer) => {
          const text = data.toString('utf8');
          for (const line of text.split(/\r?\n/)) {
            if (line.length > 0) emit(line, 'stderr');
          }
        });

        stream.on('close', (code: number | null) => {
          clearTimeout(timeout);
          if (code === 0) {
            emit('Install script completed successfully', 'system');
            finish({ success: true });
          } else {
            emit(`Install script exited with code ${code}`, 'stderr');
            finish({ success: false, error: `install exited with code ${code}` });
          }
        });
      });
    });

    conn.on('error', (err) => {
      clearTimeout(timeout);
      emit(`SSH error: ${err.message}`, 'stderr');
      finish({ success: false, error: err.message });
    });

    emit(`Connecting to ${ipAddress}:${sshPort} as ${sshUsername}...`, 'system');
    conn.connect({
      host: ipAddress,
      port: sshPort,
      username: sshUsername,
      password: sshPassword,
      readyTimeout: 20_000,
      // Allow a wide range of legacy host key algorithms; this is an internal-network tool.
      algorithms: undefined,
    });
  });
}

/**
 * After the install script finishes, poll the host's :9000/api/service/status
 * endpoint until it responds healthy or we time out.
 */
export async function waitForHealthy(
  ipAddress: string,
  port: number,
  io: IOServer,
  room: string,
): Promise<boolean> {
  const url = `http://${ipAddress}:${port}/api/service/status`;
  const deadline = Date.now() + env.sshPostInstallHealthcheckTimeoutMs;
  io.to(room).emit('provision:log', {
    line: `Waiting for ${url} to become healthy...`,
    level: 'system',
    ts: Date.now(),
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
  });
  return false;
}
