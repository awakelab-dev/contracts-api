import { Router } from 'express';
import { pool } from '../db/pool';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.use(requireAuth);

const norm = (v: any) => (v ?? '').toString().trim();
const toNull = (v: any) => {
  const s = norm(v);
  return s ? s : null;
};

// GET /hiring-contracts?student_id=1
router.get('/', async (req, res) => {
  try {
    const student_id = req.query.student_id ? Number(req.query.student_id) : null;
    if (req.query.student_id && !Number.isFinite(student_id)) {
      return res.status(400).json({ error: 'student_id must be a number' });
    }

    const sql = student_id
      ? 'SELECT * FROM hiring_contracts WHERE student_id = ? ORDER BY start_date DESC, id DESC'
      : 'SELECT * FROM hiring_contracts ORDER BY start_date DESC, id DESC';

    const params = student_id ? [student_id] : [];
    const [rows] = await pool.query(sql, params);
    return res.json(rows);
  } catch (e) {
    return res.status(500).json({ error: 'Error al consultar contrataciones', details: (e as Error).message });
  }
});

// POST /hiring-contracts
router.post('/', async (req, res) => {
  const {
    student_id,
    company_nif,
    company_name,
    sector,
    start_date,
    end_date,
    workday_pct,
    contribution_group,
    contract_type,
    weekly_hours,
    contributed_days,
    notes,
  } = req.body;

  const sid = Number(student_id);
  if (!Number.isFinite(sid) || !norm(company_nif) || !norm(company_name) || !norm(start_date)) {
    return res.status(400).json({ error: 'student_id, company_nif, company_name and start_date are required' });
  }

  try {
    const sql = `
      INSERT INTO hiring_contracts
      (student_id, company_nif, company_name, sector, start_date, end_date, workday_pct, contribution_group, contract_type, weekly_hours, contributed_days, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const [result] = await pool.query(sql, [
      sid,
      norm(company_nif),
      norm(company_name),
      toNull(sector),
      start_date,
      toNull(end_date),
      toNull(workday_pct),
      toNull(contribution_group),
      toNull(contract_type),
      weekly_hours ?? null,
      contributed_days ?? null,
      toNull(notes),
    ]);

    return res.status(201).json({ id: (result as any).insertId });
  } catch (e) {
    return res.status(500).json({ error: 'Error al crear contratación', details: (e as Error).message });
  }
});

// PUT /hiring-contracts/:id
router.put('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'id must be a number' });

  const {
    company_nif,
    company_name,
    sector,
    start_date,
    end_date,
    workday_pct,
    contribution_group,
    contract_type,
    weekly_hours,
    contributed_days,
    notes,
  } = req.body;

  if (!norm(company_nif) || !norm(company_name) || !norm(start_date)) {
    return res.status(400).json({ error: 'company_nif, company_name and start_date are required' });
  }

  try {
    const sql = `
      UPDATE hiring_contracts
      SET company_nif = ?, company_name = ?, sector = ?, start_date = ?, end_date = ?, workday_pct = ?, contribution_group = ?, contract_type = ?, weekly_hours = ?, contributed_days = ?, notes = ?
      WHERE id = ?
    `;

    await pool.query(sql, [
      norm(company_nif),
      norm(company_name),
      toNull(sector),
      start_date,
      toNull(end_date),
      toNull(workday_pct),
      toNull(contribution_group),
      toNull(contract_type),
      weekly_hours ?? null,
      contributed_days ?? null,
      toNull(notes),
      id,
    ]);

    return res.json({ message: 'Contratación actualizada' });
  } catch (e) {
    return res.status(500).json({ error: 'Error al actualizar contratación', details: (e as Error).message });
  }
});

// DELETE /hiring-contracts/:id
router.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'id must be a number' });

  try {
    await pool.query('DELETE FROM hiring_contracts WHERE id = ?', [id]);
    return res.json({ message: 'Contratación eliminada' });
  } catch (e) {
    return res.status(500).json({ error: 'Error al eliminar contratación', details: (e as Error).message });
  }
});

export default router;
