import { Router } from 'express';
import { pool } from '../db/pool';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.use(requireAuth);

/**
 * GET / - Listar todas las empresas
 */
router.get('/', async (_req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM companies ORDER BY name ASC');
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'Error al consultar empresas', details: (e as Error).message });
  }
});

/**
 * POST / - Crear una nueva empresa
 */
router.post('/', async (req, res) => {
  const { name, sector, contact_name, contact_email, contact_phone, notes } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'El nombre de la empresa es obligatorio' });
  }

  try {
    const query = `
      INSERT INTO companies (name, sector, contact_name, contact_email, contact_phone, notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `;
    const [result] = await pool.query(query, [
      name, 
      sector || null, 
      contact_name || null, 
      contact_email || null, 
      contact_phone || null, 
      notes || null
    ]);

    res.status(201).json({ message: 'Empresa creada', id: (result as any).insertId });
  } catch (e) {
    res.status(500).json({ error: 'Error al crear empresa', details: (e as Error).message });
  }
});

/**
 * POST /companies/import - importación masiva de empresas
 */
router.post('/import', requireAuth, async (req, res) => {
  const rows = (req.body?.rows || []) as Array<{ name?: string; sector?: string; email?: string; location?: string }>;
  if (!Array.isArray(rows) || rows.length === 0) return res.status(400).json({ error: 'rows must be a non-empty array' });
  const valid = rows.filter(r => (r.name || '').trim()).map(r => [
    (r.name || '').trim(),
    (r.sector || null),
    (r.email || null),
    // Guardamos 'location' en notes si viene, para no perder la info
    (r.location || null)
  ]);
  if (valid.length === 0) return res.status(400).json({ error: 'no valid rows' });
  try {
    const placeholders = valid.map(() => '(?, ?, ?, ?)').join(',');
    const sql = `INSERT IGNORE INTO companies (name, sector, contact_email, notes) VALUES ${placeholders}`;
    const [result] = await pool.query(sql, valid.flat());
    const inserted = (result as any).affectedRows || 0;
    const total = rows.length;
    const skipped = total - inserted;
    return res.json({ inserted, skipped, total });
  } catch (e) {
    return res.status(500).json({ error: 'Error en importación', details: (e as Error).message });
  }
});

/**
 * PUT /:id - Actualizar una empresa
 */
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { name, sector, contact_name, contact_email, contact_phone, notes } = req.body;

  try {
    const query = `
      UPDATE companies 
      SET name = ?, sector = ?, contact_name = ?, contact_email = ?, contact_phone = ?, notes = ?
      WHERE id = ?
    `;
    await pool.query(query, [
      name, 
      sector || null, 
      contact_name || null, 
      contact_email || null, 
      contact_phone || null, 
      notes || null, 
      id
    ]);
    res.json({ message: 'Empresa actualizada con éxito' });
  } catch (e) {
    res.status(500).json({ error: 'Error al actualizar empresa', details: (e as Error).message });
  }
});

/**
 * GET by id
 */
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM companies WHERE id = ?', [req.params.id]);
    if ((rows as any[]).length === 0) return res.status(404).json({ error: 'Empresa no encontrada' });
    res.json((rows as any[])[0]);
  } catch (e) { res.status(500).json({ error: 'Error', details: (e as Error).message }); }
});


/**
 * DELETE by id
 */
router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM companies WHERE id = ?', [req.params.id]);
    res.json({ message: 'Eliminado correctamente' });
  } catch (e) {
    res.status(500).json({ error: 'Error al eliminar', details: (e as Error).message });
  }
});

export default router;