import { Client } from 'ssh2';
import type { Server as IOServer } from 'socket.io';
import { env } from '../lib/env.js';
import { makeEmitter } from '../lib/provision-emit.js';
import { resolveToConnectAddress } from '../lib/dns-resolver.js';

function friendlySshError(e: Error & { code?: string }, host: string, port: number): string {
  switch (e.code) {
    case 'ENETUNREACH':
      return `Host ${host} is unreachable — it may be powered off, or the network route is down`;
    case 'ECONNREFUSED':
      return `Connection refused on ${host}:${port} — SSH may not be running or the port is wrong`;
    case 'ETIMEDOUT':
    case 'ECONNRESET':
      return `Connection to ${host}:${port} timed out — host may be unresponsive or firewalled`;
    case 'EHOSTUNREACH':
      return `No route to host ${host} — check that the host is online and reachable from this server`;
    case 'ENOTFOUND':
      return `Could not resolve hostname "${host}" — check DNS or try an IP address instead`;
    default:
      if (e.message.includes('All configured authentication methods failed')) {
        return `Authentication failed for user on ${host} — wrong username or password`;
      }
      return e.message;
  }
}

export type SshCreds = {
  ipAddress: string;
  sshPort: number;
  sshUsername: string;
  sshPassword: string;
};

export type CommandResult = { success: true } | { success: false; error: string };

export type RunOptions = {
  /** Shell command to execute on the remote host. Caller is responsible for quoting. */
  command: string;
  /** Total wall-clock timeout for the whole exec (ms). */
  timeoutMs?: number;
};

/**
 * Connects via SSH, runs `command` over a pty, streams stdout/stderr
 * to the given Socket.io room, and answers our custom `SUDOPW:` sudo
 * prompt with the password. Credentials live only in this closure.
 */
export async function runSshCommand(
  io: IOServer,
  room: string,
  creds: SshCreds,
  opts: RunOptions,
): Promise<CommandResult> {
  const { ipAddress, sshPort, sshUsername, sshPassword } = creds;
  const timeoutMs = opts.timeoutMs ?? env.sshInstallTimeoutMs;
  const { emitLog: emit, handleLine } = makeEmitter(io, room);
  const connectHost = await resolveToConnectAddress(ipAddress);

  return await new Promise<CommandResult>((resolve) => {
    const conn = new Client();
    let resolved = false;
    const finish = (r: CommandResult) => {
      if (resolved) return;
      resolved = true;
      try {
        conn.end();
      } catch {}
      resolve(r);
    };

    const timeout = setTimeout(() => {
      emit(`SSH command timed out after ${timeoutMs / 1000}s`, 'system');
      finish({ success: false, error: 'SSH command timed out' });
    }, timeoutMs);

    conn.on('ready', () => {
      emit(`SSH connection established to ${ipAddress}:${sshPort}`, 'system');

      conn.exec(opts.command, { pty: true }, (err, stream) => {
        if (err) {
          clearTimeout(timeout);
          emit(`exec error: ${err.message}`, 'stderr');
          return finish({ success: false, error: err.message });
        }

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
            const rest = text.replace(/SUDOPW:\s*/g, '');
            for (const line of rest.split(/\r?\n/)) handleLine(line, 'info');
            return;
          }
          for (const line of text.split(/\r?\n/)) handleLine(line, 'info');
        });

        stream.stderr.on('data', (data: Buffer) => {
          const text = data.toString('utf8');
          for (const line of text.split(/\r?\n/)) handleLine(line, 'stderr');
        });

        stream.on('close', (code: number | null) => {
          clearTimeout(timeout);
          if (code === 0) {
            emit('Command completed successfully', 'system');
            finish({ success: true });
          } else {
            emit(`Command exited with code ${code}`, 'stderr');
            finish({ success: false, error: `command exited with code ${code}` });
          }
        });
      });
    });

    conn.on('error', (e) => {
      clearTimeout(timeout);
      const friendly = friendlySshError(e, ipAddress, sshPort);
      emit(`SSH error: ${friendly}`, 'stderr');
      finish({ success: false, error: friendly });
    });

    emit(`Connecting to ${ipAddress}:${sshPort} as ${sshUsername}...`, 'system');
    conn.connect({
      host: connectHost,
      port: sshPort,
      username: sshUsername,
      password: sshPassword,
      readyTimeout: 20_000,
      algorithms: undefined,
    });
  });
}

/**
 * Run a short non-interactive command over SSH and capture stdout.
 * Does NOT stream to socket.io. For commands that don't require sudo.
 */
export async function sshExecCapture(
  creds: SshCreds,
  command: string,
  timeoutMs = 15_000,
): Promise<{ ok: true; stdout: string } | { ok: false; error: string }> {
  const { ipAddress, sshPort, sshUsername, sshPassword } = creds;
  const connectHost = await resolveToConnectAddress(ipAddress);
  return await new Promise((resolve) => {
    const conn = new Client();
    let resolved = false;
    const finish = (r: { ok: true; stdout: string } | { ok: false; error: string }) => {
      if (resolved) return;
      resolved = true;
      try { conn.end(); } catch {}
      resolve(r);
    };
    const timeout = setTimeout(() => finish({ ok: false, error: 'timeout' }), timeoutMs);

    conn.on('ready', () => {
      conn.exec(command, (err, stream) => {
        if (err) {
          clearTimeout(timeout);
          return finish({ ok: false, error: err.message });
        }
        let stdout = '';
        stream.on('data', (d: Buffer) => { stdout += d.toString('utf8'); });
        stream.stderr.on('data', () => {});
        stream.on('close', (code: number | null) => {
          clearTimeout(timeout);
          if (code === 0) finish({ ok: true, stdout });
          else finish({ ok: false, error: `exit ${code}` });
        });
      });
    });
    conn.on('error', (e) => {
      clearTimeout(timeout);
      finish({ ok: false, error: friendlySshError(e, ipAddress, sshPort) });
    });
    conn.connect({
      host: connectHost,
      port: sshPort,
      username: sshUsername,
      password: sshPassword,
      readyTimeout: 15_000,
    });
  });
}

/** Build the sudo command that pipes-to-bash a script URL. */
export function installScriptCommand(scriptUrl: string): string {
  return `sudo -p 'SUDOPW:' bash -c "curl -sSL '${scriptUrl}' | bash"`;
}

/** Build a sudo systemctl command. */
export function systemctlCommand(action: 'restart' | 'start' | 'stop' | 'status', unit: string): string {
  return `sudo -p 'SUDOPW:' systemctl ${action} ${unit}`;
}
