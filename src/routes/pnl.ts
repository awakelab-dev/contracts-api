import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

const norm = (v: any) => (v ?? '').toString().trim();
const toNull = (v: any) => {
  const s = norm(v);
  return s ? s : null;
};

// GET /pnl?student_id=1
router.get('/', async (req, res) => {
  try {
    const student_id = req.query.student_id ? Number(req.query.student_id) : null;
    if (req.query.student_id && !Number.isFinite(student_id)) {
      return res.status(400).json({ error: 'student_id must be a number' });
    }

    const sql = student_id
      ? 'SELECT * FROM pnl WHERE student_id = ? ORDER BY start_date DESC, id DESC'
      : 'SELECT * FROM pnl ORDER BY start_date DESC, id DESC';

    const params = student_id ? [student_id] : [];
    const [rows] = await pool.query(sql, params);
    return res.json(rows);
  } catch (e) {
    return res.status(500).json({ error: 'Error al consultar PnL', details: (e as Error).message });
  }
});

// POST /pnl
router.post('/', async (req, res) => {
  const {
    student_id,
    company_nif,
    company_name,
    signer_name,
    signer_nif,
    workplace,
    position,
    start_date,
    end_date,
    schedule,
    weekly_hours,
    observations,
  } = req.body;

  const sid = Number(student_id);
  if (!Number.isFinite(sid) || !norm(company_nif) || !norm(company_name) || !norm(start_date)) {
    return res.status(400).json({ error: 'student_id, company_nif, company_name and start_date are required' });
  }

  try {
    const sql = `
      INSERT INTO pnl
      (student_id, company_nif, company_name, signer_name, signer_nif, workplace, position, start_date, end_date, schedule, weekly_hours, observations)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const [result] = await pool.query(sql, [
      sid,
      norm(company_nif),
      norm(company_name),
      toNull(signer_name),
      toNull(signer_nif),
      toNull(workplace),
      toNull(position),
      start_date,
      toNull(end_date),
      toNull(schedule),
      weekly_hours ?? null,
      toNull(observations),
    ]);

    return res.status(201).json({ id: (result as any).insertId });
  } catch (e) {
    return res.status(500).json({ error: 'Error al crear PnL', details: (e as Error).message });
  }
});

// PUT /pnl/:id
router.put('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'id must be a number' });

  const {
    company_nif,
    company_name,
    signer_name,
    signer_nif,
    workplace,
    position,
    start_date,
    end_date,
    schedule,
    weekly_hours,
    observations,
  } = req.body;

  if (!norm(company_nif) || !norm(company_name) || !norm(start_date)) {
    return res.status(400).json({ error: 'company_nif, company_name and start_date are required' });
  }

  try {
    const sql = `
      UPDATE pnl
      SET company_nif = ?, company_name = ?, signer_name = ?, signer_nif = ?, workplace = ?, position = ?, start_date = ?, end_date = ?, schedule = ?, weekly_hours = ?, observations = ?
      WHERE id = ?
    `;

    await pool.query(sql, [
      norm(company_nif),
      norm(company_name),
      toNull(signer_name),
      toNull(signer_nif),
      toNull(workplace),
      toNull(position),
      start_date,
      toNull(end_date),
      toNull(schedule),
      weekly_hours ?? null,
      toNull(observations),
      id,
    ]);

    return res.json({ message: 'PnL actualizada' });
  } catch (e) {
    return res.status(500).json({ error: 'Error al actualizar PnL', details: (e as Error).message });
  }
});

// DELETE /pnl/:id
router.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'id must be a number' });

  try {
    await pool.query('DELETE FROM pnl WHERE id = ?', [id]);
    return res.json({ message: 'PnL eliminada' });
  } catch (e) {
    return res.status(500).json({ error: 'Error al eliminar PnL', details: (e as Error).message });
  }
});

export default router;
