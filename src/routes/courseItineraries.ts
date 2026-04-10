import { Router } from 'express';
import { pool } from '../db/pool.js';

const router = Router();

const compactSpaces = (value: string) => value.replace(/\s+/g, ' ').trim();
const normText = (value: unknown) => {
  const cleaned = compactSpaces((value ?? '').toString().replace(/\u00A0/g, ' '));
  return cleaned ? cleaned.toUpperCase() : null;
};
const normCode = (value: unknown) => {
  const cleaned = normText(value);
  if (!cleaned) return null;
  return cleaned.replace(/\s+/g, '');
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

const normalizeOptionalDate = (value: unknown) => {
  const cleaned = compactSpaces((value ?? '').toString());
  if (!cleaned) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) return cleaned;

  const slashLike = cleaned.replace(/[.\-]/g, '/');
  const m = slashLike.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;

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
};

router.get('/', async (_req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT
         course_code,
         itinerary_name,
         formation_start_date,
         formation_end_date,
         formation_schedule,
         company,
         teacher
       FROM course_itineraries
       ORDER BY course_code ASC`
    );
    return res.json(rows);
  } catch (e) {
    return res.status(500).json({ error: 'Error al consultar cursos', details: (e as Error).message });
  }
});

router.post('/', async (req, res) => {
  const courseCode = normCode(req.body?.course_code);
  const itineraryName = normText(req.body?.itinerary_name);
  if (!courseCode || !itineraryName) {
    return res.status(400).json({ error: 'course_code e itinerary_name son obligatorios' });
  }

  const formationStartDate = normalizeOptionalDate(req.body?.formation_start_date);
  const formationEndDate = normalizeOptionalDate(req.body?.formation_end_date);
  const formationSchedule = normText(req.body?.formation_schedule);
  const company = normText(req.body?.company);
  const teacher = normText(req.body?.teacher);

  try {
    await pool.query(
      `INSERT INTO course_itineraries
       (course_code, itinerary_name, formation_start_date, formation_end_date, formation_schedule, company, teacher)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        courseCode,
        itineraryName,
        formationStartDate,
        formationEndDate,
        formationSchedule,
        company,
        teacher,
      ]
    );
    return res.status(201).json({ message: 'Curso creado' });
  } catch (e: any) {
    if (e?.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Ya existe un curso con ese código' });
    }
    return res.status(500).json({ error: 'Error al crear curso', details: (e as Error).message });
  }
});

router.put('/:courseCode', async (req, res) => {
  const courseCode = normCode(req.params.courseCode);
  if (!courseCode) {
    return res.status(400).json({ error: 'courseCode inválido' });
  }

  const itineraryName = normText(req.body?.itinerary_name);
  if (!itineraryName) {
    return res.status(400).json({ error: 'itinerary_name es obligatorio' });
  }

  const formationStartDate = normalizeOptionalDate(req.body?.formation_start_date);
  const formationEndDate = normalizeOptionalDate(req.body?.formation_end_date);
  const formationSchedule = normText(req.body?.formation_schedule);
  const company = normText(req.body?.company);
  const teacher = normText(req.body?.teacher);

  try {
    const [result] = await pool.query(
      `UPDATE course_itineraries
       SET itinerary_name = ?,
           formation_start_date = ?,
           formation_end_date = ?,
           formation_schedule = ?,
           company = ?,
           teacher = ?
       WHERE course_code = ?`,
      [
        itineraryName,
        formationStartDate,
        formationEndDate,
        formationSchedule,
        company,
        teacher,
        courseCode,
      ]
    );

    if ((result as any).affectedRows === 0) {
      return res.status(404).json({ error: 'Curso no encontrado' });
    }

    return res.json({ message: 'Curso actualizado' });
  } catch (e) {
    return res.status(500).json({ error: 'Error al actualizar curso', details: (e as Error).message });
  }
});

export default router;
