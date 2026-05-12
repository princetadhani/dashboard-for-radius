import http from 'node:http';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
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

const provisionLimiter = rateLimit({
  windowMs: 60_000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/hosts', (req, res, next) => {
  if (req.method === 'POST') return provisionLimiter(req, res, next);
  next();
});

app.use('/api/hosts', buildHostsRouter(io));

attachSocketHandlers(io);
startStatusPoller(io);

httpServer.listen(env.port, () => {
  console.log(`[backend] listening on http://localhost:${env.port}`);
  console.log(`[backend] frontend origin: ${env.frontendOrigin}`);
  console.log(`[backend] status poll every ${env.statusPollIntervalMs}ms`);
});
