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
  return ['sent', 'attended', 'no_show'].includes(v) ? v : 'sent';
};

/**
 * GET / - Listar todas las entrevistas con el nombre del alumno
 */
router.get('/', async (req, res) => {
  try {
    const student_id = req.query.student_id ? Number(req.query.student_id) : null;
    if (req.query.student_id && !Number.isFinite(student_id)) {
      return res.status(400).json({ error: 'student_id must be a number' });
    }

    const where = student_id ? 'WHERE i.student_id = ?' : '';
    const params = student_id ? [student_id] : [];

    const query = `
      SELECT i.*, CONCAT_WS(' ', s.first_names, s.last_names) as student_name 
      FROM interviews i
      JOIN students s ON i.student_id = s.id
      ${where}
      ORDER BY i.interview_date DESC
    `;
    const [rows] = await pool.query(query, params);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'Error al consultar entrevistas', details: (e as Error).message });
  }
});

/**
 * POST / - Crear una nueva entrevista
 */
router.post('/', async (req, res) => {
  const { student_id, place, interview_date, status, notes } = req.body;
  const sid = Number(student_id);

  if (!Number.isFinite(sid) || !norm(interview_date)) {
    return res.status(400).json({ error: 'El alumno y la fecha son obligatorios' });
  }

  try {
    const query = `
      INSERT INTO interviews (student_id, place, interview_date, status, notes)
      VALUES (?, ?, ?, ?, ?)
    `;
    const [result] = await pool.query(query, [
      sid,
      toNull(place),
      interview_date,
      normStatus(status),
      toNull(notes),
    ]);

    res.status(201).json({ message: 'Entrevista registrada', id: (result as any).insertId });
  } catch (e) {
    res.status(500).json({ error: 'Error al registrar entrevista', details: (e as Error).message });
  }
});

/**
 * PUT /:id - Actualizar una entrevista
 */
router.put('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'id must be a number' });

  const { place, interview_date, status, notes } = req.body;

  if (!norm(interview_date)) {
    return res.status(400).json({ error: 'interview_date is required' });
  }

  try {
    const query = `
      UPDATE interviews 
      SET place = ?, interview_date = ?, status = ?, notes = ?
      WHERE id = ?
    `;
    await pool.query(query, [toNull(place), interview_date, normStatus(status), toNull(notes), id]);
    res.json({ message: 'Entrevista actualizada con éxito' });
  } catch (e) {
    res.status(500).json({ error: 'Error al actualizar entrevista', details: (e as Error).message });
  }
});

/**
 * GET by id
 */
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM interviews WHERE id = ?', [req.params.id]);
    if ((rows as any[]).length === 0) return res.status(404).json({ error: 'No encontrado' });
    res.json((rows as any[])[0]);
  } catch (e) {
    res.status(500).json({ error: 'Error', details: (e as Error).message });
  }
});

/**
 * DELETE by id
 */
router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM interviews WHERE id = ?', [req.params.id]);
    res.json({ message: 'Eliminado correctamente' });
  } catch (e) {
    res.status(500).json({ error: 'Error al eliminar', details: (e as Error).message });
  }
});

export default router;