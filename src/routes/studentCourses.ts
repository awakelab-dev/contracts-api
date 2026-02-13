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

// GET /student-courses?student_id=1
router.get('/', async (req, res) => {
  try {
    const student_id = req.query.student_id ? Number(req.query.student_id) : null;
    if (req.query.student_id && !Number.isFinite(student_id)) {
      return res.status(400).json({ error: 'student_id must be a number' });
    }

    const sql = student_id
      ? 'SELECT * FROM student_courses WHERE student_id = ? ORDER BY COALESCE(end_date, start_date) DESC, id DESC'
      : 'SELECT * FROM student_courses ORDER BY COALESCE(end_date, start_date) DESC, id DESC';

    const params = student_id ? [student_id] : [];
    const [rows] = await pool.query(sql, params);
    return res.json(rows);
  } catch (e) {
    return res.status(500).json({ error: 'Error al consultar cursos', details: (e as Error).message });
  }
});

// POST /student-courses
router.post('/', async (req, res) => {
  const { student_id, title, description, institution, start_date, end_date } = req.body;
  const sid = Number(student_id);
  if (!Number.isFinite(sid)) {
    return res.status(400).json({ error: 'student_id is required and must be a number' });
  }
  if (!norm(title)) {
    return res.status(400).json({ error: 'title is required' });
  }

  try {
    const sql = `
      INSERT INTO student_courses (student_id, title, description, institution, start_date, end_date)
      VALUES (?, ?, ?, ?, ?, ?)
    `;

    const [result] = await pool.query(sql, [
      sid,
      norm(title),
      toNull(description),
      toNull(institution),
      toNull(start_date),
      toNull(end_date),
    ]);

    return res.status(201).json({ id: (result as any).insertId });
  } catch (e) {
    return res.status(500).json({ error: 'Error al crear curso', details: (e as Error).message });
  }
});

// PUT /student-courses/:id
router.put('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'id must be a number' });

  const { title, description, institution, start_date, end_date } = req.body;
  if (!norm(title)) {
    return res.status(400).json({ error: 'title is required' });
  }

  try {
    const sql = `
      UPDATE student_courses
      SET title = ?, description = ?, institution = ?, start_date = ?, end_date = ?
      WHERE id = ?
    `;

    await pool.query(sql, [
      norm(title),
      toNull(description),
      toNull(institution),
      toNull(start_date),
      toNull(end_date),
      id,
    ]);

    return res.json({ message: 'Curso actualizado' });
  } catch (e) {
    return res.status(500).json({ error: 'Error al actualizar curso', details: (e as Error).message });
  }
});

// DELETE /student-courses/:id
router.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'id must be a number' });

  try {
    await pool.query('DELETE FROM student_courses WHERE id = ?', [id]);
    return res.json({ message: 'Curso eliminado' });
  } catch (e) {
    return res.status(500).json({ error: 'Error al eliminar curso', details: (e as Error).message });
  }
});

export default router;
