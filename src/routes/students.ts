import { Router } from 'express';
import { pool } from '../db/pool';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.use(requireAuth);

/**
 * POST /students - Crear un nuevo alumno
 */
router.post('/', async (req, res) => {
  const { 
    full_name, 
    dni_nie, 
    course_code, 
    practices_start, 
    practices_end, 
    employment_status, 
    notes 
  } = req.body;

  if (!full_name || !dni_nie || !course_code) {
    return res.status(400).json({ error: 'Nombre, DNI/NIE y código de curso son obligatorios' });
  }

  try {
    const query = `
      INSERT INTO students 
      (full_name, dni_nie, course_code, practices_start, practices_end, employment_status, notes) 
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;
    
    const [result] = await pool.query(query, [
      full_name, 
      dni_nie, 
      course_code, 
      practices_start || null, 
      practices_end || null, 
      employment_status || 'unknown', 
      notes || null
    ]);

    res.status(201).json({ 
      message: 'Alumno creado con éxito', 
      studentId: (result as any).insertId 
    });
  } catch (e) {
    res.status(500).json({ error: 'Error al crear alumno', details: (e as Error).message });
  }
});

/**
 * PUT /students/:id - Actualizar datos de un alumno
 */
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { 
    full_name, 
    dni_nie, 
    course_code, 
    practices_start, 
    practices_end, 
    employment_status, 
    notes 
  } = req.body;

  try {
    const query = `
      UPDATE students 
      SET full_name = ?, dni_nie = ?, course_code = ?, practices_start = ?, 
          practices_end = ?, employment_status = ?, notes = ? 
      WHERE id = ?
    `;
    
    await pool.query(query, [
      full_name, 
      dni_nie, 
      course_code, 
      practices_start || null, 
      practices_end || null, 
      employment_status || 'unknown', 
      notes || null,
      id
    ]);

    res.json({ message: 'Alumno actualizado con éxito' });
  } catch (e) {
    res.status(500).json({ error: 'Error al actualizar alumno', details: (e as Error).message });
  }
});

/**
 * GET / - Listado de alumnos
 */
router.get('/', async (_req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM students ORDER BY id DESC');
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'Error al consultar alumnos', details: (e as Error).message });
  }
});

/**
 * GET by id
 */
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM students WHERE id = ?', [req.params.id]);
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
    await pool.query('DELETE FROM students WHERE id = ?', [req.params.id]);
    res.json({ message: 'Eliminado correctamente' });
  } catch (e) {
    res.status(500).json({ error: 'Error al eliminar', details: (e as Error).message });
  }
});

export default router;