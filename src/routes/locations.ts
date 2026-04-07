import { Router } from 'express';
import { pool } from '../db/pool.js';

const router = Router();

const compactSpaces = (value: string) => value.replace(/\s+/g, ' ').trim();
const toIntCode = (value: unknown) => {
  const cleaned = compactSpaces((value ?? '').toString());
  if (!cleaned) return null;
  if (!/^\d+$/.test(cleaned)) return null;
  const parsed = Number.parseInt(cleaned, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
};

router.get('/municipalities', async (_req, res) => {
  try {
    const [rows] = await pool.query('SELECT code, name FROM municipalities ORDER BY name ASC');
    return res.json(rows);
  } catch (e) {
    return res.status(500).json({ error: 'Error al consultar municipios', details: (e as Error).message });
  }
});

router.get('/districts', async (req, res) => {
  try {
    const municipalityCode = toIntCode(req.query?.municipality_code);
    if (municipalityCode) {
      const [rows] = await pool.query(
        'SELECT code, municipality_code, name FROM districts WHERE municipality_code = ? ORDER BY name ASC',
        [municipalityCode]
      );
      return res.json(rows);
    }

    const [rows] = await pool.query('SELECT code, municipality_code, name FROM districts ORDER BY name ASC');
    return res.json(rows);
  } catch (e) {
    return res.status(500).json({ error: 'Error al consultar distritos', details: (e as Error).message });
  }
});

export default router;
