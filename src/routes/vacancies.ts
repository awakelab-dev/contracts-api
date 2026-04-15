import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

const norm = (value: unknown) => (value ?? '').toString().trim();

const normalizeSectorName = (value: unknown) => {
  const cleaned = norm(value).replace(/\s+/g, ' ').toUpperCase();
  return cleaned ? cleaned : null;
};

async function resolveSectorId(sectorNameRaw: unknown): Promise<number | null> {
  const sectorName = normalizeSectorName(sectorNameRaw);
  if (!sectorName) return null;

  const [result] = await pool.query(
    `INSERT INTO sectors (sector_name)
     VALUES (?)
     ON DUPLICATE KEY UPDATE
       id = LAST_INSERT_ID(id),
       sector_name = VALUES(sector_name)`,
    [sectorName]
  );

  return Number((result as any).insertId || 0) || null;
}

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
  const { company_id, title, sector, description, requirements, status } = req.body;

  if (!company_id || !title) {
    return res.status(400).json({ error: 'La empresa y el título son obligatorios' });
  }

  try {
    const query = `
      INSERT INTO vacancies (company_id, title, sector, description, requirements, status)
      VALUES (?, ?, ?, ?, ?, ?)
    `;
    const [result] = await pool.query(query, [
      company_id,
      title,
      sector || null,
      description || null,
      requirements || null,
      status || 'open',
    ]);

    res.status(201).json({ message: 'Vacante creada con éxito', id: (result as any).insertId });
  } catch (e) {
    res.status(500).json({ error: 'Error al crear vacante', details: (e as Error).message });
  }
});

/**
 * POST /vacancies/import - importación masiva de vacantes (crea empresa si no existe)
 */
router.post('/import', async (req, res) => {
  const rows = (req.body?.rows || []) as Array<{ title?: string; company_name?: string; sector?: string; location?: string }>;
  if (!Array.isArray(rows) || rows.length === 0) return res.status(400).json({ error: 'rows must be a non-empty array' });
  let inserted = 0;
  let total = rows.length;
  try {
    for (const r of rows) {
      const title = norm(r.title);
      const companyName = norm(r.company_name);
      const sectorId = await resolveSectorId(r.sector);
      if (!title || !companyName) continue; // skip inválidas
      // buscar o crear empresa
      const [cRows] = await pool.query('SELECT id FROM companies WHERE name = ? LIMIT 1', [companyName]);
      let companyId = (cRows as any[])[0]?.id as number | undefined;
      if (!companyId) {
        const [ins] = await pool.query(
          'INSERT IGNORE INTO companies (name, fiscal_name, sector_id, notes) VALUES (?, ?, ?, ?)',
          [companyName, companyName, sectorId, norm(r.location) || null]
        );
        companyId = (ins as any).insertId || (await (async () => {
          const [c2] = await pool.query('SELECT id FROM companies WHERE name = ? LIMIT 1', [companyName]);
          return (c2 as any[])[0]?.id;
        })());
      } else if (sectorId) {
        await pool.query('UPDATE companies SET sector_id = COALESCE(sector_id, ?) WHERE id = ?', [sectorId, companyId]);
      }
      if (!companyId) continue; // si no se pudo resolver empresa, saltamos
      const [vres] = await pool.query(
        'INSERT INTO vacancies (company_id, title, sector, status) VALUES (?, ?, ?, ?)',
        [companyId, title, normalizeSectorName(r.sector), 'open']
      );
      if ((vres as any).affectedRows) inserted += 1;
    }
    const skipped = total - inserted;
    return res.json({ inserted, skipped, total });
  } catch (e) {
    return res.status(500).json({ error: 'Error en importación', details: (e as Error).message });
  }
});

/**
 * PUT /:id - Actualizar una vacante
 */
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { title, sector, description, requirements, status } = req.body;

  try {
    const query = `
      UPDATE vacancies 
      SET title = ?, sector = ?, description = ?, requirements = ?, status = ?
      WHERE id = ?
    `;
    await pool.query(query, [
      title,
      sector || null,
      description || null,
      requirements || null,
      status || 'open',
      id,
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