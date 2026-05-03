import { Router } from 'express';
import type { ResultSetHeader } from 'mysql2';
import type { PoolConnection } from 'mysql2/promise';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);
let ensurePracticesSchemaPromise: Promise<void> | null = null;

type TutorRole = 'EMHA' | 'COMPANY';
type TutorPayload = {
  dni: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  tutorOf: TutorRole;
};
type EnrollmentResolution =
  | { ok: true; studentId: number }
  | { ok: false; error: string };

async function hasColumn(tableName: string, columnName: string): Promise<boolean> {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS c
     FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = ?
       AND column_name = ?`,
    [tableName, columnName]
  );
  return Number((rows as Array<{ c: number }>)[0]?.c || 0) > 0;
}

async function hasIndex(tableName: string, indexName: string): Promise<boolean> {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS c
     FROM information_schema.statistics
     WHERE table_schema = DATABASE()
       AND table_name = ?
       AND index_name = ?`,
    [tableName, indexName]
  );
  return Number((rows as Array<{ c: number }>)[0]?.c || 0) > 0;
}

async function hasForeignKey(tableName: string, constraintName: string): Promise<boolean> {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS c
     FROM information_schema.table_constraints
     WHERE table_schema = DATABASE()
       AND table_name = ?
       AND constraint_name = ?
       AND constraint_type = 'FOREIGN KEY'`,
    [tableName, constraintName]
  );
  return Number((rows as Array<{ c: number }>)[0]?.c || 0) > 0;
}

async function ensureColumn(tableName: string, columnName: string, definitionSql: string) {
  const exists = await hasColumn(tableName, columnName);
  if (exists) return;
  await pool.query(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definitionSql}`);
}

async function ensurePracticesSchema() {
  if (ensurePracticesSchemaPromise) {
    await ensurePracticesSchemaPromise;
    return;
  }

  ensurePracticesSchemaPromise = (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS pnl_registered_companies (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(190) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_pnl_registered_companies_name (name)
      ) ENGINE=InnoDB
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS practices (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        expediente VARCHAR(64) NOT NULL,
        company_id BIGINT NULL,
        company_name VARCHAR(190) NULL,
        pnl_registered_company_id BIGINT NULL,
        workplace VARCHAR(255) NULL,
        does_practices VARCHAR(20) NOT NULL DEFAULT 'NO',
        conditions_for_practice TEXT NULL,
        practice_shift TEXT NULL,
        observations TEXT NULL,
        start_date DATE NULL,
        end_date DATE NULL,
        attendance_days INT NULL,
        schedule TEXT NULL,
        evaluation TEXT NULL,
        practice_status VARCHAR(40) NULL,
        leave_date DATE NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_practices_expediente (expediente),
        INDEX idx_practices_company (company_id),
        INDEX idx_practices_pnl_registered_company_id (pnl_registered_company_id),
        INDEX idx_practices_start_date (start_date),
        INDEX idx_practices_end_date (end_date),
        CONSTRAINT fk_practices_expediente
          FOREIGN KEY (expediente) REFERENCES course_itinerary_students(expediente)
          ON UPDATE CASCADE
          ON DELETE CASCADE,
        CONSTRAINT fk_practices_company
          FOREIGN KEY (company_id) REFERENCES companies(id)
          ON UPDATE CASCADE
          ON DELETE SET NULL,
        CONSTRAINT fk_practices_pnl_registered_company
          FOREIGN KEY (pnl_registered_company_id) REFERENCES pnl_registered_companies(id)
          ON UPDATE CASCADE
          ON DELETE SET NULL
      ) ENGINE=InnoDB
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS tutors (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        dni VARCHAR(32) NOT NULL,
        full_name VARCHAR(190) NOT NULL,
        phone VARCHAR(50) NULL,
        email VARCHAR(190) NULL,
        tutor_of ENUM('EMHA','COMPANY') NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_tutors_dni_role (dni, tutor_of),
        INDEX idx_tutors_dni (dni)
      ) ENGINE=InnoDB
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS practice_tutors (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        practice_id BIGINT NOT NULL,
        tutor_id BIGINT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_practice_tutors_pair (practice_id, tutor_id),
        INDEX idx_practice_tutors_tutor_id (tutor_id),
        CONSTRAINT fk_practice_tutors_practice
          FOREIGN KEY (practice_id) REFERENCES practices(id)
          ON UPDATE CASCADE
          ON DELETE CASCADE,
        CONSTRAINT fk_practice_tutors_tutor
          FOREIGN KEY (tutor_id) REFERENCES tutors(id)
          ON UPDATE CASCADE
          ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);

    await ensureColumn('practices', 'pnl_registered_company_id', 'BIGINT NULL AFTER company_id');
    await ensureColumn('tutors', 'email', 'VARCHAR(190) NULL AFTER phone');

    const practicesPnlIdxExists = await hasIndex('practices', 'idx_practices_pnl_registered_company_id');
    if (!practicesPnlIdxExists) {
      await pool.query('ALTER TABLE practices ADD INDEX idx_practices_pnl_registered_company_id (pnl_registered_company_id)');
    }

    const practicesPnlFkExists = await hasForeignKey('practices', 'fk_practices_pnl_registered_company');
    if (!practicesPnlFkExists) {
      await pool.query(`
        ALTER TABLE practices
        ADD CONSTRAINT fk_practices_pnl_registered_company
        FOREIGN KEY (pnl_registered_company_id) REFERENCES pnl_registered_companies(id)
        ON UPDATE CASCADE
        ON DELETE SET NULL
      `);
    }
  })();

  try {
    await ensurePracticesSchemaPromise;
  } catch (error) {
    ensurePracticesSchemaPromise = null;
    throw error;
  }
}

router.use(async (req, res, next) => {
  if (req.method === 'OPTIONS') {
    return next();
  }
  try {
    await ensurePracticesSchema();
    return next();
  } catch (e) {
    return res.status(500).json({ error: 'Error al preparar esquema de prácticas', details: (e as Error).message });
  }
});

const norm = (v: unknown) => (v ?? '').toString().trim();
const compactSpaces = (value: string) => value.replace(/\s+/g, ' ').trim();
const toNull = (v: unknown) => {
  const cleaned = compactSpaces(norm(v));
  return cleaned ? cleaned : null;
};

const normalizePracticeState = (value: unknown): 'SI' | 'NO' | 'INSERCION' | 'ACTUALIZAR' => {
  const raw = norm(value).toUpperCase();
  if (!raw) return 'NO';
  if (raw.includes('INSER')) return 'INSERCION';
  if (raw.startsWith('SI') || raw === 'SÍ') return 'SI';
  if (raw.includes('ACTUALIZ')) return 'ACTUALIZAR';
  return 'NO';
};

const normalizePracticeStatus = (value: unknown): string | null => {
  const raw = norm(value).toUpperCase();
  if (!raw) return null;
  if (raw.includes('PROGRAMAD')) return 'PROGRAMADAS';
  if (raw.includes('PROGRES')) return 'EN PROGRESO';
  if (raw.includes('CULMIN') || raw.includes('FINALIZ')) return 'CULMINADAS';
  if (raw.includes('INTERRUMP') || raw.includes('INTERRUP')) return 'INTERRUMPIDAS';
  if (raw.includes('NO REALIZA')) return 'NO REALIZA PRACTICAS';
  if (raw.includes('NO APTO')) return 'NO APTO FORMACION';
  if (raw.includes('INSER')) return 'INSERCION FORMACION';
  return raw;
};

const normalizeDate = (value: unknown) => {
  const s = norm(value);
  if (!s) return null;
  return s.length >= 10 ? s.slice(0, 10) : null;
};

const parseIsoDate = (value: unknown): Date | null => {
  const iso = normalizeDate(value);
  if (!iso) return null;
  const parsed = new Date(`${iso}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const calculatePracticeStatusByDates = (
  startDate: unknown,
  endDate: unknown,
  leaveDate: unknown
): string | null => {
  const start = parseIsoDate(startDate);
  const end = parseIsoDate(endDate);
  const leave = parseIsoDate(leaveDate);
  if (!start && !end && !leave) return null;

  if (leave && (!end || leave.getTime() < end.getTime())) {
    return 'INTERRUMPIDAS';
  }

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (start && today.getTime() < start.getTime()) {
    return 'PROGRAMADAS';
  }
  if (start && end && today.getTime() >= start.getTime() && today.getTime() <= end.getTime()) {
    return 'EN PROGRESO';
  }
  if (start && !end && today.getTime() >= start.getTime()) {
    return 'EN PROGRESO';
  }
  if (end && today.getTime() > end.getTime()) {
    return 'CULMINADAS';
  }

  return null;
};

const toIntOrNull = (value: unknown) => {
  const s = norm(value);
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.trunc(n);
};

function normalizeTutorRoleForFilter(value: unknown): TutorRole | null {
  const raw = norm(value).toUpperCase();
  if (!raw) return null;
  if (raw.includes('COMP')) return 'COMPANY';
  if (raw.includes('EMHA')) return 'EMHA';
  return null;
}

function normalizeTutorRole(value: unknown): TutorRole {
  return normalizeTutorRoleForFilter(value) ?? 'EMHA';
}

function normalizeTutorDni(value: unknown): string {
  return norm(value)
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[^0-9A-Z]/g, '');
}

function parseTutorsPayload(value: unknown): TutorPayload[] {
  if (!Array.isArray(value)) return [];

  const dedup = new Map<string, TutorPayload>();
  for (const row of value) {
    if (!row || typeof row !== 'object') continue;
    const item = row as Record<string, unknown>;
    const dni = normalizeTutorDni(item.dni);
    const fullName = toNull(item.full_name ?? item.fullName ?? item.name);
    if (!dni || !fullName) continue;

    const tutorOf = normalizeTutorRole(item.tutor_of ?? item.tutorOf ?? item.role);
    const phone = toNull(item.phone ?? item.tlf ?? item.telefono);
    const email = toNull(item.email ?? item.mail);
    const key = `${dni}::${tutorOf}`;

    dedup.set(key, {
      dni,
      fullName,
      phone,
      email,
      tutorOf,
    });
  }

  return Array.from(dedup.values());
}

async function resolveCompany(company_id: unknown, company_name: unknown): Promise<{ companyId: number | null; companyName: string | null }> {
  const explicitId = Number(company_id);
  const name = toNull(company_name);

  if (Number.isFinite(explicitId)) {
    const [rows] = await pool.query(
      'SELECT id, name FROM companies WHERE id = ? LIMIT 1',
      [explicitId]
    );
    const company = (rows as Array<{ id: number; name: string }>)[0];
    if (company) {
      return {
        companyId: Number(company.id),
        companyName: name ?? company.name,
      };
    }
  }

  if (!name) return { companyId: null, companyName: null };

  const [rows] = await pool.query(
    `SELECT id, name
     FROM companies
     WHERE
       TRIM(name) COLLATE utf8mb4_unicode_ci = TRIM(?) COLLATE utf8mb4_unicode_ci
       OR TRIM(COALESCE(fiscal_name, '')) COLLATE utf8mb4_unicode_ci = TRIM(?) COLLATE utf8mb4_unicode_ci
     ORDER BY
       CASE
         WHEN TRIM(name) COLLATE utf8mb4_unicode_ci = TRIM(?) COLLATE utf8mb4_unicode_ci THEN 0
         ELSE 1
       END,
       id ASC
     LIMIT 1`,
    [name, name, name]
  );
  const company = (rows as Array<{ id: number; name: string }>)[0];
  if (!company) return { companyId: null, companyName: name };
  return { companyId: Number(company.id), companyName: name };
}

async function resolveEnrollment(expediente: string, student_id?: number | null): Promise<EnrollmentResolution> {
  const [rows] = await pool.query(
    `SELECT cis.expediente, s.id AS student_id
     FROM course_itinerary_students cis
     INNER JOIN students s ON s.dni_nie = cis.dni_nie
     WHERE cis.expediente = ?
     LIMIT 1`,
    [expediente]
  );

  const enrollment = (rows as Array<{ expediente: string; student_id: number }>)[0];
  if (!enrollment) {
    return { ok: false, error: 'expediente not found in enrolled itineraries' };
  }

  if (Number.isFinite(student_id) && Number(enrollment.student_id) !== student_id) {
    return { ok: false, error: 'expediente does not belong to student_id' };
  }

  return { ok: true, studentId: Number(enrollment.student_id) };
}

async function resolvePnlRegisteredCompanyId(connection: PoolConnection, value: unknown): Promise<number | null> {
  const name = toNull(value);
  if (!name) return null;

  const [result] = await connection.query<ResultSetHeader>(
    `INSERT INTO pnl_registered_companies (name)
     VALUES (?)
     ON DUPLICATE KEY UPDATE
       id = LAST_INSERT_ID(id),
       name = VALUES(name)`,
    [name]
  );

  const id = Number((result as ResultSetHeader).insertId);
  return Number.isFinite(id) && id > 0 ? id : null;
}

async function upsertTutorId(connection: PoolConnection, tutor: TutorPayload): Promise<number> {
  const [result] = await connection.query<ResultSetHeader>(
    `INSERT INTO tutors (dni, full_name, phone, email, tutor_of)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       id = LAST_INSERT_ID(id),
       full_name = VALUES(full_name),
       phone = VALUES(phone),
       email = VALUES(email)`,
    [tutor.dni, tutor.fullName, tutor.phone, tutor.email, tutor.tutorOf]
  );
  return Number((result as ResultSetHeader).insertId);
}

async function replacePracticeTutors(connection: PoolConnection, practiceId: number, tutors: TutorPayload[]) {
  await connection.query('DELETE FROM practice_tutors WHERE practice_id = ?', [practiceId]);

  for (const tutor of tutors) {
    const tutorId = await upsertTutorId(connection, tutor);
    await connection.query(
      `INSERT INTO practice_tutors (practice_id, tutor_id)
       VALUES (?, ?)`,
      [practiceId, tutorId]
    );
  }
}

async function loadPracticeTutors(practiceIds: number[]): Promise<Map<number, Array<{ id: number; tutor_id: number; dni: string; full_name: string; phone: string | null; email: string | null; tutor_of: TutorRole }>>> {
  const validIds = practiceIds.filter((id) => Number.isFinite(id));
  if (validIds.length === 0) return new Map();

  const placeholders = validIds.map(() => '?').join(', ');
  const [rows] = await pool.query(
    `SELECT
       pt.id AS practice_tutor_id,
       pt.practice_id,
       t.id AS tutor_id,
       t.dni,
       t.full_name,
       t.phone,
       t.email,
       t.tutor_of
     FROM practice_tutors pt
     INNER JOIN tutors t ON t.id = pt.tutor_id
     WHERE pt.practice_id IN (${placeholders})
     ORDER BY pt.practice_id ASC, t.tutor_of ASC, t.dni ASC`,
    validIds
  );

  const mapped = new Map<number, Array<{ id: number; tutor_id: number; dni: string; full_name: string; phone: string | null; email: string | null; tutor_of: TutorRole }>>();
  for (const row of rows as Array<{
    practice_tutor_id: number;
    practice_id: number;
    tutor_id: number;
    dni: string;
    full_name: string;
    phone: string | null;
    email: string | null;
    tutor_of: string;
  }>) {
    const practiceId = Number(row.practice_id);
    const current = mapped.get(practiceId) ?? [];
    current.push({
      id: Number(row.practice_tutor_id),
      tutor_id: Number(row.tutor_id),
      dni: row.dni,
      full_name: row.full_name,
      phone: row.phone ?? null,
      email: row.email ?? null,
      tutor_of: normalizeTutorRole(row.tutor_of),
    });
    mapped.set(practiceId, current);
  }

  return mapped;
}

// GET /practices/tutors?search=123&tutor_of=EMHA
router.get('/tutors', async (req, res) => {
  try {
    const search = norm(req.query.search ?? req.query.q ?? req.query.dni);
    const tutorOf = normalizeTutorRoleForFilter(req.query.tutor_of);

    let sql = `
      SELECT id, dni, full_name, phone, email, tutor_of
      FROM tutors
      WHERE 1 = 1
    `;
    const params: Array<string> = [];

    if (search) {
      sql += ' AND (dni LIKE ? OR full_name LIKE ?)';
      params.push(`${normalizeTutorDni(search)}%`, `%${search}%`);
    }
    if (tutorOf) {
      sql += ' AND tutor_of = ?';
      params.push(tutorOf);
    }

    sql += ' ORDER BY dni ASC LIMIT 30';

    const [rows] = await pool.query(sql, params);
    return res.json(rows);
  } catch (e) {
    return res.status(500).json({ error: 'Error al consultar tutores', details: (e as Error).message });
  }
});

// GET /practices/pnl-registered-companies?search=empresa
router.get('/pnl-registered-companies', async (req, res) => {
  try {
    const search = norm(req.query.search ?? req.query.q ?? req.query.name);
    let sql = `
      SELECT id, name
      FROM pnl_registered_companies
      WHERE 1 = 1
    `;
    const params: string[] = [];

    if (search) {
      sql += ' AND name LIKE ?';
      params.push(`%${search}%`);
    }

    sql += ' ORDER BY name ASC LIMIT 30';

    const [rows] = await pool.query(sql, params);
    return res.json(rows);
  } catch (e) {
    return res.status(500).json({ error: 'Error al consultar empresas de alta PnL', details: (e as Error).message });
  }
});

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
        c.name AS company_name_resolved,
        prc.name AS pnl_registered_company_name
      FROM practices p
      INNER JOIN course_itinerary_students cis ON cis.expediente = p.expediente
      INNER JOIN students s ON s.dni_nie = cis.dni_nie
      LEFT JOIN course_itineraries ci ON ci.course_code = cis.course_code
      LEFT JOIN companies c ON c.id = p.company_id
      LEFT JOIN pnl_registered_companies prc ON prc.id = p.pnl_registered_company_id
      WHERE 1 = 1
    `;
    const params: Array<number | string> = [];

    if (Number.isFinite(student_id)) {
      sql += ' AND s.id = ?';
      params.push(student_id as number);
    }
    if (expediente) {
      sql += ' AND p.expediente = ?';
      params.push(expediente);
    }

    sql += ' ORDER BY COALESCE(p.start_date, p.end_date) DESC, p.id DESC';

    const [rows] = await pool.query(sql, params);
    const list = (rows as Array<Record<string, unknown>>);
    const practiceIds = list
      .map((row) => Number(row.id))
      .filter((id) => Number.isFinite(id));
    const tutorMap = await loadPracticeTutors(practiceIds);

    const merged = list.map((row) => {
      const pid = Number(row.id);
      return {
        ...row,
        tutors: tutorMap.get(pid) ?? [],
      };
    });

    return res.json(merged);
  } catch (e) {
    return res.status(500).json({ error: 'Error al consultar prácticas', details: (e as Error).message });
  }
});

// POST /practices
router.post('/', async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const exp = norm(body.expediente).toUpperCase();
  const sid = body.student_id != null ? Number(body.student_id) : null;
  if (!exp) {
    return res.status(400).json({ error: 'expediente is required' });
  }
  if (body.student_id != null && !Number.isFinite(sid)) {
    return res.status(400).json({ error: 'student_id must be a number' });
  }

  try {
    const enrollment = await resolveEnrollment(exp, Number.isFinite(sid) ? sid : null);
    if (!enrollment.ok) {
      return res.status(400).json({ error: enrollment.error });
    }

    const company = await resolveCompany(body.company_id, body.company_name);
    const doesPractices = normalizePracticeState(body.does_practices);
    const tutors = parseTutorsPayload(body.tutors);
    const startDate = normalizeDate(body.start_date);
    const endDate = normalizeDate(body.end_date);
    const leaveDate = normalizeDate(body.leave_date);
    const status =
      normalizePracticeStatus(body.practice_status) ??
      calculatePracticeStatusByDates(startDate, endDate, leaveDate);

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const pnlRegisteredCompanyId = await resolvePnlRegisteredCompanyId(connection, body.pnl_registered_company_name);

      const [result] = await connection.query<ResultSetHeader>(
        `
        INSERT INTO practices
        (
          expediente,
          company_id,
          company_name,
          pnl_registered_company_id,
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
          leave_date
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        [
          exp,
          company.companyId,
          company.companyName,
          pnlRegisteredCompanyId,
          toNull(body.workplace),
          doesPractices,
          toNull(body.conditions_for_practice),
          toNull(body.practice_shift),
          toNull(body.observations),
          startDate,
          endDate,
          toIntOrNull(body.attendance_days),
          toNull(body.schedule),
          toNull(body.evaluation),
          status,
          leaveDate,
        ]
      );

      const practiceId = Number((result as ResultSetHeader).insertId);
      await replacePracticeTutors(connection, practiceId, tutors);
      await connection.commit();
      return res.status(201).json({ id: practiceId });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (e) {
    return res.status(500).json({ error: 'Error al crear práctica', details: (e as Error).message });
  }
});

// PUT /practices/:id
router.put('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'id must be a number' });

  const body = (req.body ?? {}) as Record<string, unknown>;
  const exp = norm(body.expediente).toUpperCase();
  const sid = body.student_id != null ? Number(body.student_id) : null;
  if (!exp) {
    return res.status(400).json({ error: 'expediente is required' });
  }
  if (body.student_id != null && !Number.isFinite(sid)) {
    return res.status(400).json({ error: 'student_id must be a number' });
  }

  try {
    const enrollment = await resolveEnrollment(exp, Number.isFinite(sid) ? sid : null);
    if (!enrollment.ok) {
      return res.status(400).json({ error: enrollment.error });
    }

    const company = await resolveCompany(body.company_id, body.company_name);
    const doesPractices = normalizePracticeState(body.does_practices);
    const tutors = parseTutorsPayload(body.tutors);
    const startDate = normalizeDate(body.start_date);
    const endDate = normalizeDate(body.end_date);
    const leaveDate = normalizeDate(body.leave_date);
    const status =
      normalizePracticeStatus(body.practice_status) ??
      calculatePracticeStatusByDates(startDate, endDate, leaveDate);

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const pnlRegisteredCompanyId = await resolvePnlRegisteredCompanyId(connection, body.pnl_registered_company_name);

      const [result] = await connection.query<ResultSetHeader>(
        `
        UPDATE practices
        SET
          expediente = ?,
          company_id = ?,
          company_name = ?,
          pnl_registered_company_id = ?,
          workplace = ?,
          does_practices = ?,
          conditions_for_practice = ?,
          practice_shift = ?,
          observations = ?,
          start_date = ?,
          end_date = ?,
          attendance_days = ?,
          schedule = ?,
          evaluation = ?,
          practice_status = ?,
          leave_date = ?
        WHERE id = ?
      `,
        [
          exp,
          company.companyId,
          company.companyName,
          pnlRegisteredCompanyId,
          toNull(body.workplace),
          doesPractices,
          toNull(body.conditions_for_practice),
          toNull(body.practice_shift),
          toNull(body.observations),
          startDate,
          endDate,
          toIntOrNull(body.attendance_days),
          toNull(body.schedule),
          toNull(body.evaluation),
          status,
          leaveDate,
          id,
        ]
      );

      if ((result as ResultSetHeader).affectedRows === 0) {
        await connection.rollback();
        return res.status(404).json({ error: 'Práctica no encontrada' });
      }

      await replacePracticeTutors(connection, id, tutors);
      await connection.commit();
      return res.json({ message: 'Práctica actualizada' });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
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