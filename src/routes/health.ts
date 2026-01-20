import { Router } from 'express';
import { ping } from '../db/pool';
const router = Router();
router.get('/live', (_req, res) => res.json({ status: 'ok' }));
router.get('/ready', async (_req, res) => {
  try { await ping(); res.json({ db: 'ok' }); } catch { res.status(500).json({ db: 'down' }); }
});
export default router;
