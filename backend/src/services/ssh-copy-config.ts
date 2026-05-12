import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client, type ConnectConfig, type SFTPWrapper } from 'ssh2';
import type { Server as IOServer } from 'socket.io';
import { makeEmitter } from '../lib/provision-emit.js';

export type CopyConfigCreds = {
  sshPort: number;
  sshUsername: string;
  sshPassword: string;
};

export type CopyConfigParams = {
  sourceIp: string;
  targetIp: string;
  sourceCreds: CopyConfigCreds;
  targetCreds: CopyConfigCreds;
};

export type CopyConfigResult = { success: true } | { success: false; error: string };

const REMOTE_DIR = '/etc/freeradius/3.0';

function connect(client: Client, cfg: ConnectConfig): Promise<void> {
  return new Promise((resolve, reject) => {
    client.once('ready', resolve);
    client.once('error', reject);
    client.connect(cfg);
  });
}

/**
 * Run a sudo command over SSH with our SUDOPW marker; resolves on exit code 0,
 * rejects otherwise. Also pipes log lines via `onLine` so callers can stream.
 */
function execSudo(
  client: Client,
  command: string,
  password: string,
  handleLine: (line: string, level: 'info' | 'stderr' | 'system') => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const wrapped = `sudo -p 'SUDOPW:' bash -c ${JSON.stringify(command)}`;
    client.exec(wrapped, { pty: true }, (err, stream) => {
      if (err) return reject(err);
      let attempts = 0;
      stream.on('data', (data: Buffer) => {
        const text = data.toString('utf8');
        if (text.includes('SUDOPW:')) {
          attempts++;
          if (attempts > 3) {
            handleLine('sudo refused password', 'stderr');
            return;
          }
          stream.write(`${password}\n`);
          const rest = text.replace(/SUDOPW:\s*/g, '');
          for (const line of rest.split(/\r?\n/)) handleLine(line, 'info');
          return;
        }
        for (const line of text.split(/\r?\n/)) handleLine(line, 'info');
      });
      stream.stderr.on('data', (data: Buffer) => {
        for (const line of data.toString('utf8').split(/\r?\n/)) handleLine(line, 'stderr');
      });
      stream.on('close', (code: number | null) => {
        if (code === 0) resolve();
        else reject(new Error(`command exited with code ${code}`));
      });
    });
  });
}

function withSftp<T>(client: Client, fn: (sftp: SFTPWrapper) => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    client.sftp((err, sftp) => {
      if (err) return reject(err);
      fn(sftp).then(resolve, reject).finally(() => sftp.end());
    });
  });
}

function sftpFastGet(sftp: SFTPWrapper, remote: string, local: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.fastGet(remote, local, (err) => (err ? reject(err) : resolve()));
  });
}

function sftpFastPut(sftp: SFTPWrapper, local: string, remote: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.fastPut(local, remote, (err) => (err ? reject(err) : resolve()));
  });
}

export async function runCopyConfig(
  io: IOServer,
  room: string,
  params: CopyConfigParams,
): Promise<CopyConfigResult> {
  const { sourceIp, targetIp, sourceCreds, targetCreds } = params;
  const { emitLog: emit, handleLine } = makeEmitter(io, room);

  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const remoteSrcPath = `/tmp/fr-config-${stamp}.tgz`;
  const remoteTgtPath = `/tmp/fr-config-${stamp}.tgz`;
  const localPath = path.join(os.tmpdir(), `fr-config-${stamp}.tgz`);

  const srcClient = new Client();
  const tgtClient = new Client();

  try {
    handleLine(`Stage 1/3: connecting to source ${sourceIp}`, 'system');
    await connect(srcClient, {
      host: sourceIp,
      port: sourceCreds.sshPort,
      username: sourceCreds.sshUsername,
      password: sourceCreds.sshPassword,
      readyTimeout: 20_000,
    });
    emit(`Source connected. Tarballing ${REMOTE_DIR}...`, 'system');

    // Tar + chown so the SSH user can SFTP-download it.
    await execSudo(
      srcClient,
      `tar -czf ${remoteSrcPath} -C /etc/freeradius 3.0 && chown ${sourceCreds.sshUsername} ${remoteSrcPath} && chmod 600 ${remoteSrcPath}`,
      sourceCreds.sshPassword,
      handleLine,
    );

    emit(`Downloading tarball to dashboard...`, 'system');
    await withSftp(srcClient, (sftp) => sftpFastGet(sftp, remoteSrcPath, localPath));

    const stat = await fs.stat(localPath);
    emit(`Downloaded ${stat.size} bytes`, 'system');

    // Cleanup source-side tmp
    try {
      await execSudo(srcClient, `rm -f ${remoteSrcPath}`, sourceCreds.sshPassword, handleLine);
    } catch {
      // non-fatal
    }
    srcClient.end();

    handleLine(`Stage 2/3: connecting to target ${targetIp}`, 'system');
    await connect(tgtClient, {
      host: targetIp,
      port: targetCreds.sshPort,
      username: targetCreds.sshUsername,
      password: targetCreds.sshPassword,
      readyTimeout: 20_000,
    });
    emit(`Target connected. Uploading tarball...`, 'system');

    await withSftp(tgtClient, (sftp) => sftpFastPut(sftp, localPath, remoteTgtPath));

    handleLine(`Stage 3/3: extracting + restarting FreeRADIUS on target`, 'system');

    // Backup existing config, extract new one, restart.
    const backupPath = `/etc/freeradius/3.0.bak-${stamp}`;
    await execSudo(
      tgtClient,
      [
        // Backup if existing
        `if [ -d ${REMOTE_DIR} ]; then mv ${REMOTE_DIR} ${backupPath}; fi`,
        // Extract — tarball was created with "-C /etc/freeradius 3.0", so it contains "3.0/..."
        `mkdir -p /etc/freeradius`,
        `tar -xzf ${remoteTgtPath} -C /etc/freeradius`,
        // Cleanup tarball
        `rm -f ${remoteTgtPath}`,
        // Restart freeradius
        `systemctl restart freeradius`,
      ].join(' && '),
      targetCreds.sshPassword,
      handleLine,
    );

    emit(`Config copied successfully. Backup of old config kept at ${backupPath} on target.`, 'system');
    tgtClient.end();
    await fs.unlink(localPath).catch(() => {});

    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    emit(`Copy-config failed: ${msg}`, 'stderr');
    try {
      srcClient.end();
    } catch {}
    try {
      tgtClient.end();
    } catch {}
    await fs.unlink(localPath).catch(() => {});
    return { success: false, error: msg };
  }
}
