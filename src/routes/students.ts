import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

type EmploymentStatus = 'unemployed' | 'employed' | 'improved' | 'unknown';
type SexValue = 'mujer' | 'hombre' | 'other' | 'unknown';

type StudentPayload = {
  expediente: string;
  first_names: string;
  last_names: string;
  dni_nie: string;
  social_security_number: string | null;
  birth_date: string | null;
  age: number | null;
  sex: SexValue;
  district: string | null;
  municipality: string | null;
  phone: string | null;
  email: string | null;
  employment_status: EmploymentStatus;
  notes: string | null;
};

const compactSpaces = (value: string) => value.replace(/\s+/g, ' ').trim();
const norm = (value: unknown) => compactSpaces((value ?? '').toString().replace(/\u00A0/g, ' '));
const toNull = (value: unknown) => {
  const cleaned = norm(value);
  return cleaned ? cleaned : null;
};

const normalizeExpediente = (value: unknown) => norm(value).toUpperCase();
const normalizeDocument = (value: unknown) => norm(value).replace(/\s+/g, '').toUpperCase();

const normalizeEmail = (value: unknown) => {
  const cleaned = norm(value).toLowerCase();
  return cleaned ? cleaned : null;
};

const normalizeSex = (value: unknown): SexValue => {
  const cleaned = norm(value).toLowerCase();
  if (['mujer', 'female', 'f'].includes(cleaned)) return 'mujer';
  if (['hombre', 'male', 'm'].includes(cleaned)) return 'hombre';
  if (['other', 'otro', 'otra', 'no binario', 'no-binario', 'non-binary'].includes(cleaned)) return 'other';
  return 'unknown';
};

const normalizeEmploymentStatus = (value: unknown): EmploymentStatus => {
  const cleaned = norm(value).toLowerCase();
  if (['unemployed', 'desempleado', 'desempleada'].includes(cleaned)) return 'unemployed';
  if (['employed', 'empleado', 'empleada'].includes(cleaned)) return 'employed';
  if (['improved', 'buscando mejor opción', 'buscando mejor opcion'].includes(cleaned)) return 'improved';
  return 'unknown';
};

const normalizeAge = (value: unknown) => {
  const cleaned = norm(value);
  if (!cleaned) return null;
  const digits = cleaned.replace(/[^\d]/g, '');
  if (!digits) return null;
  const parsed = Number.parseInt(digits, 10);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 120) return null;
  return parsed;
};

const toIsoDate = (year: number, month: number, day: number) => {
  const d = new Date(Date.UTC(year, month - 1, day));
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() + 1 !== month ||
    d.getUTCDate() !== day
  ) {
    return null;
  }
  return d.toISOString().slice(0, 10);
};

const normalizeBirthDate = (value: unknown) => {
  const cleaned = norm(value);
  if (!cleaned) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) {
    return cleaned;
  }

  const slashLike = cleaned.replace(/[.\-]/g, '/');
  const m = slashLike.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    let year = Number(m[3]);
    if (!Number.isFinite(year)) return null;
    if (year < 100) year += year >= 70 ? 1900 : 2000;

    let month = a;
    let day = b;
    if (a > 12 && b <= 12) {
      day = a;
      month = b;
    } else if (b > 12 && a <= 12) {
      month = a;
      day = b;
    }

    return toIsoDate(year, month, day);
  }

  const parsed = new Date(cleaned);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
};

function splitFullName(full: string): { first_names: string; last_names: string } {
  const parts = norm(full).split(/\s+/).filter(Boolean);
  const first_names = parts.shift() || '';
  const last_names = parts.join(' ');
  return { first_names, last_names };
}

function pickValue(obj: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (obj[key] !== undefined) return obj[key];
  }
  return undefined;
}

function normalizeStudentInput(raw: Record<string, unknown>): StudentPayload {
  let first_names = norm(
    pickValue(raw, ['first_names', 'nombre', 'NOMBRE', 'nombres', 'NOMBRES'])
  );
  let last_names = norm(
    pickValue(raw, ['last_names', 'apellidos', 'APELLIDOS'])
  );

  if ((!first_names || !last_names) && norm(pickValue(raw, ['full_name', 'nombre_completo']))) {
    const split = splitFullName(norm(pickValue(raw, ['full_name', 'nombre_completo'])));
    if (!first_names) first_names = split.first_names;
    if (!last_names) last_names = split.last_names;
  }

  return {
    expediente: normalizeExpediente(
      pickValue(raw, ['expediente', 'EXPEDIENTE', 'n_expediente', 'Nº EXPEDIENTE'])
    ),
    first_names,
    last_names,
    dni_nie: normalizeDocument(
      pickValue(raw, [
        'dni_nie',
        'dni_nie_pasaporte',
        'document_number',
        'DNI / NIE / PASAPORTE',
        'DNI/NIE/Pasaporte',
      ])
    ),
    social_security_number: toNull(
      pickValue(raw, ['social_security_number', 'nss', 'Nº SS', 'N° SS'])
    ),
    birth_date: normalizeBirthDate(
      pickValue(raw, ['birth_date', 'fecha_nacimiento', 'FECHA NACIMIENTO'])
    ),
    age: normalizeAge(
      pickValue(raw, ['age', 'edad', 'EDAD'])
    ),
    sex: normalizeSex(
      pickValue(raw, ['sex', 'sexo', 'SEXO'])
    ),
    district: toNull(
      pickValue(raw, ['district', 'distrito', 'DISTRITO'])
    ),
    municipality: toNull(
      pickValue(raw, ['municipality', 'municipio', 'MUNICIPIO COMUNIDAD DE MADRID'])
    ),
    phone: toNull(
      pickValue(raw, ['phone', 'telefono', 'teléfono', 'TLF CONTACTO'])
    ),
    email: normalizeEmail(
      pickValue(raw, ['email', 'correo', 'E-MAIL'])
    ),
    employment_status: normalizeEmploymentStatus(
      pickValue(raw, ['employment_status', 'situacion_laboral', 'estado_laboral'])
    ),
    notes: toNull(
      pickValue(raw, ['notes', 'observaciones', 'OBSERVACIONES'])
    ),
  };
}

/**
 * POST /students/import - Importación masiva de alumnos con normalización
 */
router.post('/import', requireAuth, async (req, res) => {
  const rawRows = req.body?.rows;
  if (!Array.isArray(rawRows) || rawRows.length === 0) {
    return res.status(400).json({ error: 'rows must be a non-empty array' });
  }

  const byDocument = new Map<string, StudentPayload>();
  for (const row of rawRows as Record<string, unknown>[]) {
    const normalized = normalizeStudentInput(row);
    const isValid =
      !!normalized.expediente &&
      !!normalized.first_names &&
      !!normalized.last_names &&
      !!normalized.dni_nie;
    if (!isValid) continue;
    byDocument.set(normalized.dni_nie, normalized);
  }

  const byExpediente = new Map<string, StudentPayload>();
  for (const row of byDocument.values()) {
    byExpediente.set(row.expediente, row);
  }

  const validRows = Array.from(byExpediente.values());
  if (validRows.length === 0) {
    return res.status(400).json({ error: 'no valid rows' });
  }

  try {
    const dniValues = validRows.map((r) => r.dni_nie);
    const expedienteValues = validRows.map((r) => r.expediente);
    const dniPlaceholders = dniValues.map(() => '?').join(',');
    const expedientePlaceholders = expedienteValues.map(() => '?').join(',');

    const [existingRows] = await pool.query(
      `SELECT dni_nie, expediente
       FROM students
       WHERE dni_nie IN (${dniPlaceholders})
          OR expediente IN (${expedientePlaceholders})`,
      [...dniValues, ...expedienteValues]
    );

    const existingDni = new Set<string>();
    const existingExpediente = new Set<string>();
    for (const row of existingRows as Array<{ dni_nie: string; expediente: string }>) {
      existingDni.add(row.dni_nie);
      existingExpediente.add(row.expediente);
    }

    const inserted = validRows.filter(
      (r) => !existingDni.has(r.dni_nie) && !existingExpediente.has(r.expediente)
    ).length;
    const updated = validRows.length - inserted;

    const placeholders = validRows
      .map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .join(',');

    const sql = `
      INSERT INTO students
      (
        expediente,
        first_names,
        last_names,
        dni_nie,
        social_security_number,
        birth_date,
        age,
        sex,
        district,
        municipality,
        phone,
        email,
        employment_status,
        notes
      )
      VALUES ${placeholders}
      ON DUPLICATE KEY UPDATE
        first_names = VALUES(first_names),
        last_names = VALUES(last_names),
        social_security_number = VALUES(social_security_number),
        birth_date = VALUES(birth_date),
        age = VALUES(age),
        sex = VALUES(sex),
        district = VALUES(district),
        municipality = VALUES(municipality),
        phone = VALUES(phone),
        email = VALUES(email),
        employment_status = VALUES(employment_status),
        notes = VALUES(notes)
    `;

    await pool.query(
      sql,
      validRows.flatMap((r) => [
        r.expediente,
        r.first_names,
        r.last_names,
        r.dni_nie,
        r.social_security_number,
        r.birth_date,
        r.age,
        r.sex,
        r.district,
        r.municipality,
        r.phone,
        r.email,
        r.employment_status,
        r.notes,
      ])
    );

    const total = rawRows.length;
    const skipped = total - validRows.length;
    return res.json({ inserted, updated, skipped, total, processed: validRows.length });
  } catch (e) {
    return res.status(500).json({ error: 'Error en importación', details: (e as Error).message });
  }
});

/**
 * POST /students - Crear un nuevo alumno
 */
router.post('/', async (req, res) => {
  const payload = normalizeStudentInput(req.body ?? {});

  if (!payload.expediente || !payload.first_names || !payload.last_names || !payload.dni_nie) {
    return res.status(400).json({
      error: 'Expediente, nombres, apellidos y DNI/NIE/Pasaporte son obligatorios',
    });
  }

  try {
    const query = `
      INSERT INTO students
      (
        expediente,
        first_names,
        last_names,
        dni_nie,
        social_security_number,
        birth_date,
        age,
        sex,
        district,
        municipality,
        phone,
        email,
        practices_start,
        practices_end,
        employment_status,
        notes
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const [result] = await pool.query(query, [
      payload.expediente,
      payload.first_names,
      payload.last_names,
      payload.dni_nie,
      payload.social_security_number,
      payload.birth_date,
      payload.age,
      payload.sex,
      payload.district,
      payload.municipality,
      payload.phone,
      payload.email,
      null,
      null,
      payload.employment_status,
      payload.notes,
    ]);

    return res.status(201).json({
      message: 'Alumno creado con éxito',
      studentId: (result as any).insertId,
    });
  } catch (e) {
    return res.status(500).json({ error: 'Error al crear alumno', details: (e as Error).message });
  }
});

/**
 * PUT /students/:id - Actualizar datos de un alumno
 */
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const payload = normalizeStudentInput(req.body ?? {});

  if (!payload.expediente || !payload.first_names || !payload.last_names || !payload.dni_nie) {
    return res.status(400).json({
      error: 'Expediente, nombres, apellidos y DNI/NIE/Pasaporte son obligatorios',
    });
  }

  try {
    const query = `
      UPDATE students
      SET
        expediente = ?,
        first_names = ?,
        last_names = ?,
        dni_nie = ?,
        social_security_number = ?,
        birth_date = ?,
        age = ?,
        sex = ?,
        district = ?,
        municipality = ?,
        phone = ?,
        email = ?,
        employment_status = ?,
        notes = ?
      WHERE id = ?
    `;

    await pool.query(query, [
      payload.expediente,
      payload.first_names,
      payload.last_names,
      payload.dni_nie,
      payload.social_security_number,
      payload.birth_date,
      payload.age,
      payload.sex,
      payload.district,
      payload.municipality,
      payload.phone,
      payload.email,
      payload.employment_status,
      payload.notes,
      id,
    ]);

    return res.json({ message: 'Alumno actualizado con éxito' });
  } catch (e) {
    return res.status(500).json({ error: 'Error al actualizar alumno', details: (e as Error).message });
  }
});

/**
 * GET /students - Listado de alumnos
 */
router.get('/', async (_req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM students ORDER BY expediente ASC, id DESC');
    return res.json(rows);
  } catch (e) {
    return res.status(500).json({ error: 'Error al consultar alumnos', details: (e as Error).message });
  }
});

/**
 * GET /students/:id - detalle
 */
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM students WHERE id = ?', [req.params.id]);
    if ((rows as any[]).length === 0) return res.status(404).json({ error: 'No encontrado' });
    return res.json((rows as any[])[0]);
  } catch (e) {
    return res.status(500).json({ error: 'Error', details: (e as Error).message });
  }
});

/**
 * DELETE /students/:id
 */
router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM students WHERE id = ?', [req.params.id]);
    return res.json({ message: 'Eliminado correctamente' });
  } catch (e) {
    return res.status(500).json({ error: 'Error al eliminar', details: (e as Error).message });
  }
});

export default router;
