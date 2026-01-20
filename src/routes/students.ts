import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { pool } from '../db/pool';

const router = Router();
router.use(requireAuth);

router.get('/', async (_req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, full_name, course_code FROM students ORDER BY id DESC LIMIT 50');
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'DB error', details: (e as Error).message });
  }
});

export default router;
