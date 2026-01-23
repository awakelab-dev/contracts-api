import { Router } from 'express';
import { pool } from '../db/pool';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.use(requireAuth);

/**
 * GET / - Listar todas las entrevistas con el nombre del alumno
 */
router.get('/', async (_req, res) => {
  try {
    const query = `
      SELECT i.*, s.full_name as student_name 
      FROM interviews i
      JOIN students s ON i.student_id = s.id
      ORDER BY i.interview_date DESC
    `;
    const [rows] = await pool.query(query);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'Error al consultar entrevistas', details: (e as Error).message });
  }
});

/**
 * POST / - Crear una nueva entrevista
 */
router.post('/', async (req, res) => {
  const { student_id, place, interview_date, notes } = req.body;

  if (!student_id || !interview_date) {
    return res.status(400).json({ error: 'El alumno y la fecha son obligatorios' });
  }

  try {
    const query = `
      INSERT INTO interviews (student_id, place, interview_date, notes)
      VALUES (?, ?, ?, ?)
    `;
    const [result] = await pool.query(query, [
      student_id,
      place || null,
      interview_date,
      notes || null
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
  const { id } = req.params;
  const { place, interview_date, notes } = req.body;

  try {
    const query = `
      UPDATE interviews 
      SET place = ?, interview_date = ?, notes = ?
      WHERE id = ?
    `;
    await pool.query(query, [place || null, interview_date, notes || null, id]);
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