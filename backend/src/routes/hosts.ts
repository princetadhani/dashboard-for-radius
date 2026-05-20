import { Router } from 'express';
import type { Server as IOServer } from 'socket.io';
import { prisma } from '../lib/prisma.js';
import { env } from '../lib/env.js';
import {
  copyConfigSchema,
  createHostSchema,
  formatZodError,
  sshActionSchema,
  updateHostSchema,
} from '../lib/validation.js';
import { checkPort9000Free, discoverHostIps, runProvision, waitForHealthy } from '../services/ssh-provisioner.js';
import { isHostname } from '../lib/dns-resolver.js';
import {
  installScriptCommand,
  runSshCommand,
  systemctlCommand,
} from '../services/ssh-runner.js';
import { runCopyConfig } from '../services/ssh-copy-config.js';
import { getAllCachedStatuses, getCachedStatus, triggerProbe, triggerProbeAll } from '../services/status-poller.js';
import { fetchLatestRelease } from '../lib/releases.js';

type HostRow = {
  id: string;
  friendlyName: string;
  ipAddress: string;
  controlIp?: string | null;
  knownIps?: string | null;
  port: number;
  tags?: string | null;
  installedVersion?: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function parseStringList(s: string | null | undefined): string[] {
  if (!s) return [];
  try {
    const parsed = JSON.parse(s);
    return Array.isArray(parsed) ? parsed.filter((t) => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

function serialize(h: HostRow) {
  return {
    ...h,
    tags: parseStringList(h.tags),
    knownIps: parseStringList(h.knownIps),
  };
}

function newSessionId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function buildHostsRouter(io: IOServer): Router {
  const router = Router();

  router.get('/', async (_req, res) => {
    const hosts = await prisma.host.findMany({ orderBy: { createdAt: 'desc' } });
    res.json({
      hosts: hosts.map(serialize),
      statuses: getAllCachedStatuses(),
    });
  });

  router.post('/probe-all', async (_req, res) => {
    void triggerProbeAll(io);
    res.status(204).end();
  });

  router.get('/:id', async (req, res) => {
    const host = await prisma.host.findUnique({ where: { id: req.params.id } });
    if (!host) return res.status(404).json({ error: 'host not found' });
    res.json(serialize(host));
  });

  router.post('/:id/probe', async (req, res) => {
    const host = await prisma.host.findUnique({ where: { id: req.params.id } });
    if (!host) return res.status(404).json({ error: 'host not found' });
    void triggerProbe(io, host.id);
    res.status(204).end();
  });

  router.get('/:id/status', (req, res) => {
    const snap = getCachedStatus(req.params.id);
    if (!snap) return res.status(404).json({ error: 'no status yet' });
    res.json(snap);
  });

  router.post('/', async (req, res) => {
    const parsed = createHostSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: formatZodError(parsed.error) });
    }
    const input = parsed.data;

    const existing = await prisma.host.findUnique({ where: { ipAddress: input.ipAddress } });
    if (existing) {
      return res.status(409).json({ error: 'A host with this IP already exists' });
    }

    const sessionId = newSessionId('prov');
    res.status(202).json({ sessionId });

    queueMicrotask(async () => {
      const room = `provision:${sessionId}`;

      const sshCreds = {
        ipAddress: input.ipAddress,
        sshPort: input.sshPort,
        sshUsername: input.sshUsername,
        sshPassword: input.sshPassword,
      };

      io.to(room).emit('provision:log', {
        line: 'Checking if port 9000 is available on the host...',
        level: 'system',
        ts: Date.now(),
        sessionId,
      });

      const portCheck = await checkPort9000Free(sshCreds);
      if (!portCheck.free) {
        io.to(room).emit('provision:log', {
          line: `Port 9000 is already in use by "${portCheck.occupiedBy}". Free it up before provisioning.`,
          level: 'stderr',
          ts: Date.now(),
          sessionId,
        });
        io.to(room).emit('provision:done', {
          success: false,
          error: `Port 9000 is already occupied by "${portCheck.occupiedBy}" on this host. Stop that process first, then retry.`,
          sessionId,
        });
        return;
      }

      io.to(room).emit('provision:log', {
        line: 'Port 9000 is free — proceeding with installation.',
        level: 'system',
        ts: Date.now(),
        sessionId,
      });

      const release = await fetchLatestRelease();
      const result = await runProvision(io, room, {
        ipAddress: input.ipAddress,
        sshPort: input.sshPort,
        sshUsername: input.sshUsername,
        sshPassword: input.sshPassword,
      }, release?.scriptUrl);

      if (!result.success) {
        io.to(room).emit('provision:done', { success: false, error: result.error, sessionId });
        return;
      }

      const discovered = await discoverHostIps(sshCreds);
      // candidates includes ipAddress for health-checking (waitForHealthy filters non-IPs itself)
      const candidates = Array.from(new Set([input.ipAddress, ...discovered]));
      const healthResult = await waitForHealthy(candidates, input.port, io, room, sshCreds);
      // knownIps stores only numeric IPs — hostname lives in ipAddress column, not here
      const numericIps = isHostname(input.ipAddress) ? discovered : candidates;
      if (!healthResult) {
        io.to(room).emit('provision:done', {
          success: false,
          error: 'Could not reach the host after install — check that port 9000 is accessible',
          sessionId,
        });
        return;
      }

      const host = await prisma.host.create({
        data: {
          friendlyName: input.friendlyName,
          ipAddress: input.ipAddress,
          controlIp: healthResult.ip === input.ipAddress ? null : healthResult.ip,
          knownIps: JSON.stringify(numericIps),
          port: input.port,
          tags: JSON.stringify(input.tags ?? []),
          installedVersion: release?.version ?? null,
        },
      });
      const out = serialize(host);
      io.to(room).emit('provision:done', { success: true, host: out, sessionId });
      io.emit('host:created', out);
    });
  });

  router.patch('/:id', async (req, res) => {
    const parsed = updateHostSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: formatZodError(parsed.error) });
    }
    const data: Record<string, unknown> = { ...parsed.data };
    if (parsed.data.tags) data.tags = JSON.stringify(parsed.data.tags);

    try {
      const host = await prisma.host.update({
        where: { id: req.params.id },
        data,
      });
      const out = serialize(host);
      io.emit('host:updated', out);
      res.json(out);
    } catch {
      res.status(404).json({ error: 'host not found' });
    }
  });

  router.delete('/:id', async (req, res) => {
    try {
      await prisma.host.delete({ where: { id: req.params.id } });
      io.emit('host:deleted', { id: req.params.id });
      res.status(204).end();
    } catch {
      res.status(404).json({ error: 'host not found' });
    }
  });

  router.post('/:id/actions', async (req, res) => {
    const parsed = sshActionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: formatZodError(parsed.error) });
    }
    const host = await prisma.host.findUnique({ where: { id: req.params.id } });
    if (!host) return res.status(404).json({ error: 'host not found' });

    const sessionId = newSessionId('act');
    res.status(202).json({ sessionId });

    const input = parsed.data;
    const release = input.action !== 'restart-service' ? await fetchLatestRelease() : null;
    const scriptUrl = release?.scriptUrl ?? env.installScriptUrl;
    const command =
      input.action === 'restart-service'
        ? systemctlCommand('restart', 'freeradius')
        : installScriptCommand(scriptUrl);

    queueMicrotask(async () => {
      const room = `provision:${sessionId}`;
      const runOpts = {
        command,
        timeoutMs: input.action === 'restart-service' ? 60_000 : env.sshInstallTimeoutMs,
      };

      // Try primary ipAddress first. If the connection itself fails (not a command
      // error) and a proven-reachable controlIp exists, retry with that instead.
      let result = await runSshCommand(
        io, room,
        { ipAddress: host.ipAddress, sshPort: input.sshPort, sshUsername: input.sshUsername, sshPassword: input.sshPassword },
        runOpts,
      );

      let sshTarget = host.ipAddress;
      if (!result.success && result.connectionFailed && host.controlIp && host.controlIp !== host.ipAddress) {
        io.to(room).emit('provision:log', {
          line: `Could not reach ${host.ipAddress} — retrying via ${host.controlIp}...`,
          level: 'system', ts: Date.now(), sessionId,
        });
        sshTarget = host.controlIp;
        result = await runSshCommand(
          io, room,
          { ipAddress: sshTarget, sshPort: input.sshPort, sshUsername: input.sshUsername, sshPassword: input.sshPassword },
          runOpts,
        );
      }

      if (!result.success) {
        io.to(room).emit('provision:done', { success: false, error: result.error, sessionId });
        return;
      }

      // After install/repair, re-discover IPs (interfaces may have changed).
      // After restart, just use what we already know.
      const sshCreds = {
        ipAddress: sshTarget,
        sshPort: input.sshPort,
        sshUsername: input.sshUsername,
        sshPassword: input.sshPassword,
      };
      const previousKnown = parseStringList(host.knownIps);
      const discovered =
        input.action === 'restart-service' ? [] : await discoverHostIps(sshCreds);
      const candidates = Array.from(new Set([
        ...(host.controlIp ? [host.controlIp] : []),
        host.ipAddress,
        ...previousKnown,
        ...discovered,
      ]));
      const healthResult = await waitForHealthy(candidates, host.port, io, room, sshCreds);

      let updatedHost = host;
      if (healthResult) {
        const desiredControlIp = healthResult.ip === host.ipAddress ? null : healthResult.ip;
        // Only update knownIps when we have fresh discoveries — if ip addr failed
        // (discovered is empty), leave knownIps untouched rather than overwriting
        // with just the hostname. Hostname is never stored in knownIps.
        const desiredKnownIps =
          input.action === 'restart-service' || discovered.length === 0
            ? null
            : JSON.stringify(Array.from(new Set(discovered)));
        const controlIpChanged = desiredControlIp !== (host.controlIp ?? null);
        const knownIpsChanged =
          desiredKnownIps !== null && desiredKnownIps !== (host.knownIps ?? '[]');
        const versionChanged = release != null && release.version !== (host.installedVersion ?? null);
        if (controlIpChanged || knownIpsChanged || versionChanged) {
          updatedHost = await prisma.host.update({
            where: { id: host.id },
            data: {
              controlIp: desiredControlIp,
              ...(desiredKnownIps !== null ? { knownIps: desiredKnownIps } : {}),
              ...(versionChanged ? { installedVersion: release.version } : {}),
            },
          });
          io.emit('host:updated', serialize(updatedHost));
        }
      }

      io.to(room).emit('provision:done', healthResult
        ? { success: true, host: serialize(updatedHost), sessionId }
        : { success: false, error: 'Could not reach the host after action — check network connectivity', sessionId });
    });
  });

  router.post('/:id/copy-config', async (req, res) => {
    const parsed = copyConfigSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: formatZodError(parsed.error) });
    }
    const sourceHost = await prisma.host.findUnique({ where: { id: req.params.id } });
    const targetHost = await prisma.host.findUnique({ where: { id: parsed.data.targetHostId } });
    if (!sourceHost || !targetHost) {
      return res.status(404).json({ error: 'host not found' });
    }
    if (sourceHost.id === targetHost.id) {
      return res.status(400).json({ error: 'source and target must be different hosts' });
    }

    const sessionId = newSessionId('copy');
    res.status(202).json({ sessionId });

    const input = parsed.data;
    queueMicrotask(async () => {
      const room = `provision:${sessionId}`;
      const result = await runCopyConfig(io, room, {
        sourceIp: sourceHost.ipAddress,
        targetIp: targetHost.ipAddress,
        sourceCreds: input.source,
        targetCreds: input.target,
      });

      if (!result.success) {
        io.to(room).emit('provision:done', { success: false, error: result.error, sessionId });
        return;
      }

      const targetSshCreds = {
        ipAddress: targetHost.ipAddress,
        sshPort: input.target.sshPort,
        sshUsername: input.target.sshUsername,
        sshPassword: input.target.sshPassword,
      };
      const previousKnown = parseStringList(targetHost.knownIps);
      const candidates = Array.from(new Set([
        ...(targetHost.controlIp ? [targetHost.controlIp] : []),
        targetHost.ipAddress,
        ...previousKnown,
      ]));
      const healthResult = await waitForHealthy(candidates, targetHost.port, io, room, targetSshCreds);

      let updatedTarget = targetHost;
      if (healthResult) {
        const desiredControlIp = healthResult.ip === targetHost.ipAddress ? null : healthResult.ip;
        if (desiredControlIp !== (targetHost.controlIp ?? null)) {
          updatedTarget = await prisma.host.update({
            where: { id: targetHost.id },
            data: { controlIp: desiredControlIp },
          });
          io.emit('host:updated', serialize(updatedTarget));
        }
      }

      io.to(room).emit('provision:done', healthResult
        ? { success: true, host: serialize(updatedTarget), sessionId }
        : { success: false, error: 'Could not reach target host after config copy', sessionId });
    });
  });

  return router;
}
