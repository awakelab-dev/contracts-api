import { Router } from 'express';
import { pool } from '../db/pool.js';

const router = Router();

router.get('/', async (_req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT
         code,
         contract_type,
         workday,
         hiring_mode
       FROM contract_codes
       ORDER BY code ASC`
    );
    return res.json(rows);
  } catch (e) {
    return res.status(500).json({
      error: 'Error al consultar el catálogo de contratos',
      details: (e as Error).message,
    });
  }
});

export default router;
