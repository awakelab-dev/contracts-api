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

const normStatus = (s?: string) => {
  const v = norm(s).toLowerCase();
  return ['sent', 'accepted', 'rejected', 'expired'].includes(v) ? v : 'sent';
};

// GET /invitations?student_id=1
router.get('/', async (req, res) => {
  try {
    const student_id = req.query.student_id ? Number(req.query.student_id) : null;
    if (req.query.student_id && !Number.isFinite(student_id)) {
      return res.status(400).json({ error: 'student_id must be a number' });
    }

    const where = student_id ? 'WHERE i.student_id = ?' : '';
    const params = student_id ? [student_id] : [];

    const sql = `
      SELECT
        i.*, 
        v.title AS vacancy_title,
        v.sector AS vacancy_sector,
        v.company_id AS company_id,
        c.name AS company_name
      FROM invitations i
      JOIN vacancies v ON i.vacancy_id = v.id
      JOIN companies c ON v.company_id = c.id
      ${where}
      ORDER BY i.sent_at DESC, i.id DESC
    `;

    const [rows] = await pool.query(sql, params);
    return res.json(rows);
  } catch (e) {
    return res.status(500).json({ error: 'Error al consultar invitaciones', details: (e as Error).message });
  }
});

// POST /invitations
router.post('/', async (req, res) => {
  const { vacancy_id, student_id, status, sent_at, responded_at } = req.body;
  const vid = Number(vacancy_id);
  const sid = Number(student_id);
  if (!Number.isFinite(vid) || !Number.isFinite(sid)) {
    return res.status(400).json({ error: 'vacancy_id and student_id are required and must be numbers' });
  }

  try {
    const sql = `
      INSERT INTO invitations (vacancy_id, student_id, status, sent_at, responded_at)
      VALUES (?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), ?)
    `;
    const [result] = await pool.query(sql, [
      vid,
      sid,
      normStatus(status),
      toNull(sent_at),
      toNull(responded_at),
    ]);

    return res.status(201).json({ id: (result as any).insertId });
  } catch (e) {
    return res.status(500).json({ error: 'Error al crear invitación', details: (e as Error).message });
  }
});

// PUT /invitations/:id
router.put('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'id must be a number' });

  const { status, sent_at, responded_at } = req.body;

  try {
    const sql = `
      UPDATE invitations
      SET status = ?, sent_at = COALESCE(?, sent_at), responded_at = ?
      WHERE id = ?
    `;
    await pool.query(sql, [normStatus(status), toNull(sent_at), toNull(responded_at), id]);
    return res.json({ message: 'Invitación actualizada' });
  } catch (e) {
    return res.status(500).json({ error: 'Error al actualizar invitación', details: (e as Error).message });
  }
});

// DELETE /invitations/:id
router.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'id must be a number' });

  try {
    await pool.query('DELETE FROM invitations WHERE id = ?', [id]);
    return res.json({ message: 'Invitación eliminada' });
  } catch (e) {
    return res.status(500).json({ error: 'Error al eliminar invitación', details: (e as Error).message });
  }
});

export default router;
