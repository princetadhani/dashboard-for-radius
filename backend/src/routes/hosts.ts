import { Router } from 'express';
import type { Server as IOServer } from 'socket.io';
import { prisma } from '../lib/prisma.js';
import { env } from '../lib/env.js';
import {
  copyConfigSchema,
  createHostSchema,
  sshActionSchema,
  updateHostSchema,
} from '../lib/validation.js';
import { runProvision, waitForHealthy } from '../services/ssh-provisioner.js';
import {
  installScriptCommand,
  runSshCommand,
  systemctlCommand,
} from '../services/ssh-runner.js';
import { runCopyConfig } from '../services/ssh-copy-config.js';
import { getAllCachedStatuses, getCachedStatus } from '../services/status-poller.js';

type HostRow = {
  id: string;
  friendlyName: string;
  ipAddress: string;
  port: number;
  hostname?: string | null;
  tags?: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function serialize(h: HostRow) {
  let tags: string[] = [];
  if (h.tags) {
    try {
      const parsed = JSON.parse(h.tags);
      if (Array.isArray(parsed)) tags = parsed.filter((t) => typeof t === 'string');
    } catch {}
  }
  return { ...h, tags };
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

  router.get('/:id/status', (req, res) => {
    const snap = getCachedStatus(req.params.id);
    if (!snap) return res.status(404).json({ error: 'no status yet' });
    res.json(snap);
  });

  router.post('/', async (req, res) => {
    const parsed = createHostSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid input', details: parsed.error.flatten() });
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
      const result = await runProvision(io, room, {
        ipAddress: input.ipAddress,
        sshPort: input.sshPort,
        sshUsername: input.sshUsername,
        sshPassword: input.sshPassword,
      });

      if (!result.success) {
        io.to(room).emit('provision:done', { success: false, error: result.error, sessionId });
        return;
      }

      const healthy = await waitForHealthy(input.ipAddress, input.port, io, room);
      if (!healthy) {
        io.to(room).emit('provision:done', {
          success: false,
          error: 'Service did not become healthy after install',
          sessionId,
        });
        return;
      }

      const host = await prisma.host.create({
        data: {
          friendlyName: input.friendlyName,
          ipAddress: input.ipAddress,
          hostname: input.hostname ?? null,
          port: input.port,
          tags: JSON.stringify(input.tags ?? []),
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
      return res.status(400).json({ error: 'invalid input', details: parsed.error.flatten() });
    }
    const data: Record<string, unknown> = { ...parsed.data };
    if (parsed.data.tags) data.tags = JSON.stringify(parsed.data.tags);
    // Allow explicit clearing of hostname by sending null/empty
    if (parsed.data.hostname === null || parsed.data.hostname === '') data.hostname = null;

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
      return res.status(400).json({ error: 'invalid input', details: parsed.error.flatten() });
    }
    const host = await prisma.host.findUnique({ where: { id: req.params.id } });
    if (!host) return res.status(404).json({ error: 'host not found' });

    const sessionId = newSessionId('act');
    res.status(202).json({ sessionId });

    const input = parsed.data;
    const command =
      input.action === 'restart-service'
        ? systemctlCommand('restart', 'freeradius')
        : installScriptCommand(env.installScriptUrl);

    queueMicrotask(async () => {
      const room = `provision:${sessionId}`;
      const result = await runSshCommand(
        io,
        room,
        {
          ipAddress: host.ipAddress,
          sshPort: input.sshPort,
          sshUsername: input.sshUsername,
          sshPassword: input.sshPassword,
        },
        {
          command,
          timeoutMs:
            input.action === 'restart-service' ? 60_000 : env.sshInstallTimeoutMs,
        },
      );

      if (!result.success) {
        io.to(room).emit('provision:done', { success: false, error: result.error, sessionId });
        return;
      }

      // After install/repair, wait for health. After restart, just verify briefly.
      const healthy = await waitForHealthy(host.ipAddress, host.port, io, room);
      io.to(room).emit('provision:done', healthy
        ? { success: true, host: serialize(host), sessionId }
        : { success: false, error: 'Service did not become healthy after action', sessionId });
    });
  });

  router.post('/:id/copy-config', async (req, res) => {
    const parsed = copyConfigSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid input', details: parsed.error.flatten() });
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

      const healthy = await waitForHealthy(targetHost.ipAddress, targetHost.port, io, room);
      io.to(room).emit('provision:done', healthy
        ? { success: true, host: serialize(targetHost), sessionId }
        : { success: false, error: 'Target service did not become healthy after restart', sessionId });
    });
  });

  return router;
}
