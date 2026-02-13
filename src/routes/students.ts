import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

//router.use(requireAuth);

const norm = (v: any) => (v ?? '').toString().trim();
const toNull = (v: any) => {
  const s = norm(v);
  return s ? s : null;
};

const normStatus = (s?: string) => {
  const v = norm(s).toLowerCase();
  return ['unemployed', 'employed', 'improved', 'unknown'].includes(v) ? v : 'unknown';
};

function splitFullName(full: string): { first_names: string; last_names: string } {
  const parts = norm(full).split(/\s+/).filter(Boolean);
  const first_names = parts.shift() || '';
  const last_names = parts.join(' ');
  return { first_names, last_names };
}

/**
 * POST /students/import - Importación masiva de alumnos
 */
router.post('/import', requireAuth, async (req, res) => {
  type ImportRow = {
    first_names?: string;
    last_names?: string;
    full_name?: string; // legacy
    dni_nie?: string;
    social_security_number?: string;
    birth_date?: string;
    district?: string;
    phone?: string;
    email?: string;
    employment_status?: string;
  };

  const rows = (req.body?.rows || []) as ImportRow[];
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'rows must be a non-empty array' });
  }

  // Filtrar filas válidas (campos obligatorios)
  const valid = rows
    .map((r) => {
      let first_names = norm(r.first_names);
      let last_names = norm(r.last_names);

      if ((!first_names || !last_names) && norm(r.full_name)) {
        const s = splitFullName(r.full_name as string);
        if (!first_names) first_names = s.first_names;
        if (!last_names) last_names = s.last_names;
      }

      const dni_nie = norm(r.dni_nie);
      if (!first_names || !last_names || !dni_nie) return null;

      return [
        first_names,
        last_names,
        dni_nie,
        toNull(r.social_security_number),
        toNull(r.birth_date),
        toNull(r.district),
        toNull(r.phone),
        toNull(r.email),
        normStatus(r.employment_status),
      ];
    })
    .filter(Boolean) as any[];

  if (valid.length === 0) return res.status(400).json({ error: 'no valid rows' });

  try {
    // INSERT IGNORE para saltar duplicados por uq_students_dni (dni_nie)
    const placeholders = valid.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?)').join(',');
    const sql = `INSERT IGNORE INTO students (first_names, last_names, dni_nie, social_security_number, birth_date, district, phone, email, employment_status) VALUES ${placeholders}`;
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
 * POST /students - Crear un nuevo alumno
 */
router.post('/', async (req, res) => {
  const {
    first_names,
    last_names,
    full_name, // legacy
    dni_nie,
    social_security_number,
    birth_date,
    district,
    phone,
    email,
    practices_start,
    practices_end,
    employment_status,
    notes,
  } = req.body;

  let fn = norm(first_names);
  let ln = norm(last_names);
  if ((!fn || !ln) && norm(full_name)) {
    const s = splitFullName(full_name);
    if (!fn) fn = s.first_names;
    if (!ln) ln = s.last_names;
  }

  if (!fn || !ln || !norm(dni_nie)) {
    return res.status(400).json({ error: 'Nombres, apellidos y DNI/NIE son obligatorios' });
  }

  try {
    const query = `
      INSERT INTO students
      (first_names, last_names, dni_nie, social_security_number, birth_date, district, phone, email, practices_start, practices_end, employment_status, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const [result] = await pool.query(query, [
      fn,
      ln,
      norm(dni_nie),
      toNull(social_security_number),
      toNull(birth_date),
      toNull(district),
      toNull(phone),
      toNull(email),
      practices_start || null,
      practices_end || null,
      employment_status ? normStatus(employment_status) : 'unknown',
      notes || null,
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
    first_names,
    last_names,
    full_name, // legacy
    dni_nie,
    social_security_number,
    birth_date,
    district,
    phone,
    email,
    practices_start,
    practices_end,
    employment_status,
    notes,
  } = req.body;

  let fn = norm(first_names);
  let ln = norm(last_names);
  if ((!fn || !ln) && norm(full_name)) {
    const s = splitFullName(full_name);
    if (!fn) fn = s.first_names;
    if (!ln) ln = s.last_names;
  }

  try {
    const query = `
      UPDATE students
      SET first_names = ?, last_names = ?, dni_nie = ?, social_security_number = ?, birth_date = ?, district = ?, phone = ?, email = ?, practices_start = ?,
          practices_end = ?, employment_status = ?, notes = ?
      WHERE id = ?
    `;

    await pool.query(query, [
      fn,
      ln,
      norm(dni_nie),
      toNull(social_security_number),
      toNull(birth_date),
      toNull(district),
      toNull(phone),
      toNull(email),
      practices_start || null,
      practices_end || null,
      employment_status ? normStatus(employment_status) : 'unknown',
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
