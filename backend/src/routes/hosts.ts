import { Router } from 'express';
import type { Server as IOServer } from 'socket.io';
import { prisma } from '../lib/prisma.js';
import { createHostSchema, updateHostSchema } from '../lib/validation.js';
import { runProvision, waitForHealthy } from '../services/ssh-provisioner.js';
import { getAllCachedStatuses, getCachedStatus } from '../services/status-poller.js';

export function buildHostsRouter(io: IOServer): Router {
  const router = Router();

  router.get('/', async (_req, res) => {
    const hosts = await prisma.host.findMany({ orderBy: { createdAt: 'desc' } });
    res.json({
      hosts,
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

    // Reject duplicate IP up-front
    const existing = await prisma.host.findUnique({ where: { ipAddress: input.ipAddress } });
    if (existing) {
      return res.status(409).json({ error: 'A host with this IP already exists' });
    }

    // Use a temporary "session id" so the client can join the right Socket.io room
    // and receive provision logs before the host record is created.
    const sessionId = `prov_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    res.status(202).json({ sessionId });

    // Fire-and-forget provisioning. Credentials live only in this closure scope.
    queueMicrotask(async () => {
      const room = `provision:${sessionId}`;
      const result = await runProvision(io, room, {
        ipAddress: input.ipAddress,
        sshPort: input.sshPort,
        sshUsername: input.sshUsername,
        sshPassword: input.sshPassword,
      });

      if (!result.success) {
        io.to(room).emit('provision:done', {
          success: false,
          error: result.error,
        });
        return;
      }

      const healthy = await waitForHealthy(input.ipAddress, input.port, io, room);
      if (!healthy) {
        io.to(room).emit('provision:done', {
          success: false,
          error: 'Service did not become healthy after install',
        });
        return;
      }

      const host = await prisma.host.create({
        data: {
          friendlyName: input.friendlyName,
          ipAddress: input.ipAddress,
          port: input.port,
        },
      });
      io.to(room).emit('provision:done', { success: true, host });
      io.emit('host:created', host);
    });
  });

  router.patch('/:id', async (req, res) => {
    const parsed = updateHostSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid input', details: parsed.error.flatten() });
    }
    try {
      const host = await prisma.host.update({
        where: { id: req.params.id },
        data: parsed.data,
      });
      io.emit('host:updated', host);
      res.json(host);
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

  return router;
}
