import { Router } from 'express';
import { fetchLatestRelease } from '../lib/releases.js';

const router = Router();

router.get('/latest', async (_req, res) => {
  const release = await fetchLatestRelease();
  if (!release) {
    return res.status(502).json({ error: 'Failed to fetch GitHub releases' });
  }
  res.json(release);
});

export default router;
