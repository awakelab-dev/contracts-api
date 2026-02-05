import { Router } from 'express';
import { pool } from '../db/pool';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.use(requireAuth);

/**
 * Obtener el listado de todas las pasantías.
 */
router.get('/', async (_req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT i.*, CONCAT_WS(' ', s.first_names, s.last_names) as student_name 
      FROM internships i 
      JOIN students s ON i.student_id = s.id
    `);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Error', details: (e as Error).message }); }
});

/**
 * Registrar una nueva pasantía.
 */
router.post('/', async (req, res) => {
  const { student_id, company_name, start_date, end_date } = req.body;
  try {
    const [result] = await pool.query(
      'INSERT INTO internships (student_id, company_name, start_date, end_date) VALUES (?, ?, ?, ?)',
      [student_id, company_name, start_date, end_date || null]
    );
    res.status(201).json({ id: (result as any).insertId });
  } catch (e) { res.status(500).json({ error: 'Error al crear', details: (e as Error).message }); }
});

export default router;