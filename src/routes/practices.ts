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

const normalizePracticeState = (value: any): 'SI' | 'NO' | 'INSERCION' | 'ACTUALIZAR' => {
  const raw = norm(value).toUpperCase();
  if (!raw) return 'NO';
  if (raw.includes('INSER')) return 'INSERCION';
  if (raw.startsWith('SI') || raw === 'SÍ') return 'SI';
  if (raw.includes('ACTUALIZ')) return 'ACTUALIZAR';
  return 'NO';
};

const normalizePracticeStatus = (value: any): string | null => {
  const raw = norm(value).toUpperCase();
  if (!raw) return null;
  if (raw.includes('FINALIZ')) return 'FINALIZADAS';
  if (raw.includes('INTERRUMP') || raw.includes('INTERRUP')) return 'INTERRUMPIDAS';
  if (raw.includes('NO REALIZA')) return 'NO REALIZA PRACTICAS';
  if (raw.includes('NO APTO')) return 'NO APTO FORMACION';
  if (raw.includes('INSER')) return 'INSERCION FORMACION';
  return raw;
};

const normalizeDate = (value: any) => {
  const s = norm(value);
  if (!s) return null;
  return s.length >= 10 ? s.slice(0, 10) : null;
};

const toIntOrNull = (value: any) => {
  const s = norm(value);
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.trunc(n);
};

async function resolveCompany(company_id: any, company_name: any): Promise<{ companyId: number | null; companyName: string | null }> {
  const explicitId = Number(company_id);
  const name = toNull(company_name);

  if (Number.isFinite(explicitId)) {
    const [rows] = await pool.query(
      'SELECT id, name FROM companies WHERE id = ? LIMIT 1',
      [explicitId]
    );
    const company = (rows as any[])[0];
    if (company) {
      return {
        companyId: Number(company.id),
        companyName: name ?? (company.name as string),
      };
    }
  }

  if (!name) return { companyId: null, companyName: null };

  const [rows] = await pool.query(
    `SELECT id, name
     FROM companies
     WHERE TRIM(name) COLLATE utf8mb4_unicode_ci = TRIM(?) COLLATE utf8mb4_unicode_ci
     LIMIT 1`,
    [name]
  );
  const company = (rows as any[])[0];
  if (!company) return { companyId: null, companyName: name };
  return { companyId: Number(company.id), companyName: name };
}

async function resolveEnrollment(expediente: string, student_id?: number | null) {
  const [rows] = await pool.query(
    `SELECT cis.expediente, s.id AS student_id
     FROM course_itinerary_students cis
     INNER JOIN students s ON s.dni_nie = cis.dni_nie
     WHERE cis.expediente = ?
     LIMIT 1`,
    [expediente]
  );

  const enrollment = (rows as any[])[0];
  if (!enrollment) {
    return { ok: false as const, error: 'expediente not found in enrolled itineraries' };
  }

  if (Number.isFinite(student_id) && Number(enrollment.student_id) !== student_id) {
    return { ok: false as const, error: 'expediente does not belong to student_id' };
  }

  return { ok: true as const, studentId: Number(enrollment.student_id) };
}

// GET /practices?student_id=1
router.get('/', async (req, res) => {
  try {
    const student_id = req.query.student_id ? Number(req.query.student_id) : null;
    if (req.query.student_id && !Number.isFinite(student_id)) {
      return res.status(400).json({ error: 'student_id must be a number' });
    }

    const expediente = req.query.expediente ? norm(req.query.expediente) : null;

    let sql = `
      SELECT
        p.*,
        cis.course_code,
        cis.dni_nie,
        s.id AS student_id,
        ci.itinerary_name,
        c.name AS company_name_resolved
      FROM practices p
      INNER JOIN course_itinerary_students cis ON cis.expediente = p.expediente
      INNER JOIN students s ON s.dni_nie = cis.dni_nie
      LEFT JOIN course_itineraries ci ON ci.course_code = cis.course_code
      LEFT JOIN companies c ON c.id = p.company_id
      WHERE 1 = 1
    `;
    const params: any[] = [];

    if (Number.isFinite(student_id)) {
      sql += ' AND s.id = ?';
      params.push(student_id);
    }
    if (expediente) {
      sql += ' AND p.expediente = ?';
      params.push(expediente);
    }

    sql += ' ORDER BY COALESCE(p.start_date, p.end_date) DESC, p.id DESC';

    const [rows] = await pool.query(sql, params);
    return res.json(rows);
  } catch (e) {
    return res.status(500).json({ error: 'Error al consultar prácticas', details: (e as Error).message });
  }
});

// POST /practices
router.post('/', async (req, res) => {
  const {
    student_id,
    expediente,
    company_id,
    company_name,
    workplace,
    does_practices,
    conditions_for_practice,
    practice_shift,
    observations,
    start_date,
    end_date,
    attendance_days,
    schedule,
    evaluation,
    practice_status,
    leave_date,
  } = req.body;

  const exp = norm(expediente).toUpperCase();
  const sid = student_id != null ? Number(student_id) : null;
  if (!exp) {
    return res.status(400).json({ error: 'expediente is required' });
  }
  if (student_id != null && !Number.isFinite(sid)) {
    return res.status(400).json({ error: 'student_id must be a number' });
  }

  try {
    const enrollment = await resolveEnrollment(exp, Number.isFinite(sid) ? sid : null);
    if (!enrollment.ok) {
      return res.status(400).json({ error: enrollment.error });
    }

    const company = await resolveCompany(company_id, company_name);
    const doesPractices = normalizePracticeState(does_practices);
    let status = normalizePracticeStatus(practice_status);

    if (!status) {
      if (doesPractices === 'INSERCION') status = 'INSERCION FORMACION';
      else if (doesPractices === 'NO') status = 'NO REALIZA PRACTICAS';
      else if (normalizeDate(end_date)) status = 'FINALIZADAS';
    }

    const sql = `
      INSERT INTO practices
      (expediente, company_id, company_name, workplace, does_practices, conditions_for_practice, practice_shift, observations, start_date, end_date, attendance_days, schedule, evaluation, practice_status, leave_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const [result] = await pool.query(sql, [
      exp,
      company.companyId,
      company.companyName,
      toNull(workplace),
      doesPractices,
      toNull(conditions_for_practice),
      toNull(practice_shift),
      toNull(observations),
      normalizeDate(start_date),
      normalizeDate(end_date),
      toIntOrNull(attendance_days),
      toNull(schedule),
      toNull(evaluation),
      status,
      normalizeDate(leave_date),
    ]);

    return res.status(201).json({ id: (result as any).insertId });
  } catch (e) {
    return res.status(500).json({ error: 'Error al crear práctica', details: (e as Error).message });
  }
});

// PUT /practices/:id
router.put('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'id must be a number' });

  const {
    student_id,
    expediente,
    company_id,
    company_name,
    workplace,
    does_practices,
    conditions_for_practice,
    practice_shift,
    observations,
    start_date,
    end_date,
    attendance_days,
    schedule,
    evaluation,
    practice_status,
    leave_date,
  } = req.body;

  const exp = norm(expediente).toUpperCase();
  const sid = student_id != null ? Number(student_id) : null;
  if (!exp) {
    return res.status(400).json({ error: 'expediente is required' });
  }
  if (student_id != null && !Number.isFinite(sid)) {
    return res.status(400).json({ error: 'student_id must be a number' });
  }

  try {
    const enrollment = await resolveEnrollment(exp, Number.isFinite(sid) ? sid : null);
    if (!enrollment.ok) {
      return res.status(400).json({ error: enrollment.error });
    }

    const company = await resolveCompany(company_id, company_name);
    const doesPractices = normalizePracticeState(does_practices);
    let status = normalizePracticeStatus(practice_status);

    if (!status) {
      if (doesPractices === 'INSERCION') status = 'INSERCION FORMACION';
      else if (doesPractices === 'NO') status = 'NO REALIZA PRACTICAS';
      else if (normalizeDate(end_date)) status = 'FINALIZADAS';
    }

    const sql = `
      UPDATE practices
      SET expediente = ?, company_id = ?, company_name = ?, workplace = ?, does_practices = ?, conditions_for_practice = ?, practice_shift = ?, observations = ?, start_date = ?, end_date = ?, attendance_days = ?, schedule = ?, evaluation = ?, practice_status = ?, leave_date = ?
      WHERE id = ?
    `;

    await pool.query(sql, [
      exp,
      company.companyId,
      company.companyName,
      toNull(workplace),
      doesPractices,
      toNull(conditions_for_practice),
      toNull(practice_shift),
      toNull(observations),
      normalizeDate(start_date),
      normalizeDate(end_date),
      toIntOrNull(attendance_days),
      toNull(schedule),
      toNull(evaluation),
      status,
      normalizeDate(leave_date),
      id,
    ]);

    return res.json({ message: 'Práctica actualizada' });
  } catch (e) {
    return res.status(500).json({ error: 'Error al actualizar práctica', details: (e as Error).message });
  }
});

// DELETE /practices/:id
router.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'id must be a number' });

  try {
    await pool.query('DELETE FROM practices WHERE id = ?', [id]);
    return res.json({ message: 'Práctica eliminada' });
  } catch (e) {
    return res.status(500).json({ error: 'Error al eliminar práctica', details: (e as Error).message });
  }
});

export default router;
