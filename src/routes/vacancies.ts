import { Router } from 'express';
import { pool } from '../db/pool';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.use(requireAuth);

/**
 * GET / - Listar todas las vacantes con el nombre de la empresa
 */
router.get('/', async (_req, res) => {
  try {
    const query = `
      SELECT v.*, c.name as company_name 
      FROM vacancies v
      JOIN companies c ON v.company_id = c.id
      ORDER BY v.id DESC
    `;
    const [rows] = await pool.query(query);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'Error al consultar vacantes', details: (e as Error).message });
  }
});

/**
 * POST / - Crear una nueva vacante
 */
router.post('/', async (req, res) => {
  const { company_id, title, sector, requirements, status, deadline } = req.body;

  if (!company_id || !title) {
    return res.status(400).json({ error: 'La empresa y el título son obligatorios' });
  }

  try {
    const query = `
      INSERT INTO vacancies (company_id, title, sector, requirements, status, deadline)
      VALUES (?, ?, ?, ?, ?, ?)
    `;
    const [result] = await pool.query(query, [
      company_id,
      title,
      sector || null,
      requirements || null,
      status || 'open',
      deadline || null
    ]);

    res.status(201).json({ message: 'Vacante creada con éxito', id: (result as any).insertId });
  } catch (e) {
    res.status(500).json({ error: 'Error al crear vacante', details: (e as Error).message });
  }
});

/**
 * PUT /:id - Actualizar una vacante
 */
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { title, sector, requirements, status, deadline } = req.body;

  try {
    const query = `
      UPDATE vacancies 
      SET title = ?, sector = ?, requirements = ?, status = ?, deadline = ?
      WHERE id = ?
    `;
    await pool.query(query, [
      title,
      sector || null,
      requirements || null,
      status || 'open',
      deadline || null,
      id
    ]);
    res.json({ message: 'Vacante actualizada con éxito' });
  } catch (e) {
    res.status(500).json({ error: 'Error al actualizar vacante', details: (e as Error).message });
  }
});

/**
 * GET by id
 */
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM vacancies WHERE id = ?', [req.params.id]);
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
    await pool.query('DELETE FROM vacancies WHERE id = ?', [req.params.id]);
    res.json({ message: 'Eliminado correctamente' });
  } catch (e) {
    res.status(500).json({ error: 'Error al eliminar', details: (e as Error).message });
  }
});

export default router;