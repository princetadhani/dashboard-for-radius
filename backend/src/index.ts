import http from 'node:http';
import express from 'express';
import cors from 'cors';
import { Server as IOServer } from 'socket.io';
import { env } from './lib/env.js';
import { buildHostsRouter } from './routes/hosts.js';
import { attachSocketHandlers } from './sockets/index.js';
import { startStatusPoller } from './services/status-poller.js';

const app = express();
const httpServer = http.createServer(app);
const io = new IOServer(httpServer, {
  cors: { origin: env.frontendOrigin, methods: ['GET', 'POST'] },
});

app.use(cors({ origin: env.frontendOrigin }));
app.use(express.json({ limit: '256kb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

app.use('/api/hosts', buildHostsRouter(io));

attachSocketHandlers(io);
startStatusPoller(io);

httpServer.listen(env.port, () => {
  console.log(`[backend] listening on http://localhost:${env.port}`);
  console.log(`[backend] frontend origin: ${env.frontendOrigin}`);
  console.log(`[backend] status poll every ${env.statusPollIntervalMs}ms`);
});
