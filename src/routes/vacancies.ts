import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

let ensureVacanciesSchemaPromise: Promise<void> | null = null;

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

async function ensureColumn(tableName: string, columnName: string, definitionSql: string) {
  const exists = await hasColumn(tableName, columnName);
  if (exists) return;
  await pool.query(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definitionSql}`);
}

async function ensureVacanciesSchema() {
  if (ensureVacanciesSchemaPromise) {
    await ensureVacanciesSchemaPromise;
    return;
  }

  ensureVacanciesSchemaPromise = (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS vacancies (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        company_id BIGINT NOT NULL,
        title VARCHAR(190) NOT NULL,
        sector VARCHAR(120) NULL,
        description TEXT NULL,
        requirements TEXT NULL,
        status ENUM("open","closed") DEFAULT "open",
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);

    await ensureColumn('vacancies', 'practice_center_id', 'BIGINT NULL AFTER company_id');
    await ensureColumn('vacancies', 'workplace', 'VARCHAR(255) NULL AFTER practice_center_id');
    await ensureColumn('vacancies', 'horarios', 'TEXT NULL AFTER requirements');
    await ensureColumn('vacancies', 'tipo_contrato', 'VARCHAR(120) NULL AFTER horarios');
    await ensureColumn('vacancies', 'sueldo_aproximado_bruto_anual', 'DECIMAL(12,2) NULL AFTER tipo_contrato');
  })();

  try {
    await ensureVacanciesSchemaPromise;
  } catch (error) {
    ensureVacanciesSchemaPromise = null;
    throw error;
  }
}

router.use(async (req, res, next) => {
  if (req.method === 'OPTIONS') return next();
  try {
    await ensureVacanciesSchema();
    return next();
  } catch (e) {
    return res.status(500).json({ error: 'Error al preparar esquema de vacantes', details: (e as Error).message });
  }
});

const norm = (value: unknown) => (value ?? '').toString().trim();

const hasOwn = (obj: Record<string, unknown>, key: string) =>
  Object.prototype.hasOwnProperty.call(obj, key);

const toNullableText = (value: unknown) => {
  const cleaned = norm(value).replace(/\s+/g, ' ').trim();
  return cleaned ? cleaned : null;
};

const toPositiveInt = (value: unknown) => {
  const cleaned = norm(value);
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.trunc(parsed);
};

const normalizeVacancyStatus = (value: unknown): 'open' | 'closed' => {
  const cleaned = norm(value).toLowerCase();
  if (!cleaned || cleaned === 'open') return 'open';
  if (cleaned === 'closed') return 'closed';
  throw new Error('status must be open or closed');
};

const normalizeMoney = (value: unknown) => {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const cleaned = norm(value);
  if (!cleaned) return null;
  let normalized = cleaned.replace(/\s+/g, '');
  if (normalized.includes(',') && normalized.includes('.')) {
    if (normalized.lastIndexOf(',') > normalized.lastIndexOf('.')) {
      normalized = normalized.replace(/\./g, '').replace(',', '.');
    } else {
      normalized = normalized.replace(/,/g, '');
    }
  } else if (normalized.includes(',')) {
    normalized = normalized.replace(',', '.');
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

async function ensureCompanyExists(companyId: number): Promise<boolean> {
  const [rows] = await pool.query('SELECT id FROM companies WHERE id = ? LIMIT 1', [companyId]);
  return Boolean((rows as any[])[0]?.id);
}

async function resolvePracticeCenter(
  companyId: number,
  practiceCenterId: number | null,
  workplace: string | null
) {
  if (!practiceCenterId) {
    return {
      practiceCenterId: null as number | null,
      workplace: workplace ?? null,
    };
  }

  const [rows] = await pool.query(
    `SELECT id, address
     FROM company_practice_centers
     WHERE id = ? AND company_id = ?
     LIMIT 1`,
    [practiceCenterId, companyId]
  );
  const row = (rows as Array<{ id: number; address: string | null }>)[0];
  if (!row) {
    throw new Error('practice_center_id no pertenece a la empresa seleccionada');
  }

  return {
    practiceCenterId,
    workplace: workplace ?? row.address ?? null,
  };
}

/**
 * GET / - Listar todas las vacantes con datos de empresa
 */
router.get('/', async (_req, res) => {
  try {
    const query = `
      SELECT
        v.*,
        c.name AS company_name,
        c.fiscal_name AS company_fiscal_name,
        pc.sector AS practice_center_sector,
        pc.center AS practice_center_name,
        pc.address AS practice_center_address
      FROM vacancies v
      INNER JOIN companies c ON v.company_id = c.id
      LEFT JOIN company_practice_centers pc ON pc.id = v.practice_center_id
      ORDER BY v.id DESC
    `;
    const [rows] = await pool.query(query);
    return res.json(rows);
  } catch (e) {
    return res.status(500).json({ error: 'Error al consultar vacantes', details: (e as Error).message });
  }
});

/**
 * POST / - Crear una nueva vacante
 */
router.post('/', async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const companyId = toPositiveInt(body.company_id);
  const title = toNullableText(body.title);

  if (!companyId || !title) {
    return res.status(400).json({ error: 'La empresa y el puesto de trabajo son obligatorios' });
  }

  try {
    const exists = await ensureCompanyExists(companyId);
    if (!exists) {
      return res.status(400).json({ error: 'company_id no válido' });
    }

    const practiceCenterIdRaw =
      body.practice_center_id == null || norm(body.practice_center_id) === ''
        ? null
        : toPositiveInt(body.practice_center_id);
    if (body.practice_center_id != null && norm(body.practice_center_id) !== '' && !practiceCenterIdRaw) {
      return res.status(400).json({ error: 'practice_center_id inválido' });
    }

    const resolvedPracticeCenter = await resolvePracticeCenter(
      companyId,
      practiceCenterIdRaw,
      toNullableText(body.workplace)
    );

    const query = `
      INSERT INTO vacancies (
        company_id,
        practice_center_id,
        workplace,
        title,
        sector,
        description,
        requirements,
        horarios,
        tipo_contrato,
        sueldo_aproximado_bruto_anual,
        status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const [result] = await pool.query(query, [
      companyId,
      resolvedPracticeCenter.practiceCenterId,
      resolvedPracticeCenter.workplace,
      title,
      toNullableText(body.sector),
      toNullableText(body.description),
      toNullableText(body.requirements),
      toNullableText(body.horarios),
      toNullableText(body.tipo_contrato),
      normalizeMoney(body.sueldo_aproximado_bruto_anual),
      normalizeVacancyStatus(body.status),
    ]);

    return res.status(201).json({ message: 'Vacante creada con éxito', id: (result as any).insertId });
  } catch (e) {
    const msg = (e as Error).message || '';
    if (msg.includes('practice_center_id') || msg.includes('status')) {
      return res.status(400).json({ error: msg });
    }
    return res.status(500).json({ error: 'Error al crear vacante', details: (e as Error).message });
  }
});

/**
 * POST /vacancies/import - importación masiva de vacantes (crea empresa si no existe)
 */
router.post('/import', async (req, res) => {
  const rows = (req.body?.rows || []) as Array<{
    title?: string;
    company_name?: string;
    sector?: string;
    location?: string;
    horarios?: string;
    tipo_contrato?: string;
    sueldo_aproximado_bruto_anual?: string | number;
  }>;
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'rows must be a non-empty array' });
  }

  let inserted = 0;
  const total = rows.length;

  try {
    for (const row of rows) {
      const title = toNullableText(row.title);
      const companyName = toNullableText(row.company_name);
      if (!title || !companyName) continue;

      const [companyRows] = await pool.query('SELECT id FROM companies WHERE name = ? LIMIT 1', [companyName]);
      let companyId = (companyRows as any[])[0]?.id as number | undefined;
      if (!companyId) {
        const [ins] = await pool.query(
          'INSERT IGNORE INTO companies (name, fiscal_name, notes) VALUES (?, ?, ?)',
          [companyName, companyName, toNullableText(row.location)]
        );
        companyId =
          (ins as any).insertId ||
          (await (async () => {
            const [rows2] = await pool.query('SELECT id FROM companies WHERE name = ? LIMIT 1', [companyName]);
            return (rows2 as any[])[0]?.id;
          })());
      }
      if (!companyId) continue;

      const [vres] = await pool.query(
        `INSERT INTO vacancies (
           company_id,
           title,
           sector,
           horarios,
           tipo_contrato,
           sueldo_aproximado_bruto_anual,
           status
         ) VALUES (?, ?, ?, ?, ?, ?, 'open')`,
        [
          companyId,
          title,
          toNullableText(row.sector),
          toNullableText(row.horarios),
          toNullableText(row.tipo_contrato),
          normalizeMoney(row.sueldo_aproximado_bruto_anual),
        ]
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
  const vacancyId = toPositiveInt(req.params.id);
  if (!vacancyId) {
    return res.status(400).json({ error: 'id inválido' });
  }

  const body = (req.body ?? {}) as Record<string, unknown>;

  try {
    const [existingRows] = await pool.query('SELECT * FROM vacancies WHERE id = ? LIMIT 1', [vacancyId]);
    const existing = (existingRows as any[])[0];
    if (!existing) {
      return res.status(404).json({ error: 'No encontrado' });
    }

    const companyId = hasOwn(body, 'company_id') ? toPositiveInt(body.company_id) : Number(existing.company_id);
    if (!companyId) {
      return res.status(400).json({ error: 'company_id no válido' });
    }
    const companyExists = await ensureCompanyExists(companyId);
    if (!companyExists) {
      return res.status(400).json({ error: 'company_id no válido' });
    }

    const title = hasOwn(body, 'title') ? toNullableText(body.title) : toNullableText(existing.title);
    if (!title) {
      return res.status(400).json({ error: 'El puesto de trabajo es obligatorio' });
    }

    const practiceCenterId = hasOwn(body, 'practice_center_id')
      ? body.practice_center_id == null || norm(body.practice_center_id) === ''
        ? null
        : toPositiveInt(body.practice_center_id)
      : existing.practice_center_id != null
        ? Number(existing.practice_center_id)
        : null;
    if (hasOwn(body, 'practice_center_id') && body.practice_center_id != null && norm(body.practice_center_id) !== '' && !practiceCenterId) {
      return res.status(400).json({ error: 'practice_center_id inválido' });
    }

    const resolvedPracticeCenter = await resolvePracticeCenter(
      companyId,
      practiceCenterId,
      hasOwn(body, 'workplace') ? toNullableText(body.workplace) : toNullableText(existing.workplace)
    );

    const status = hasOwn(body, 'status')
      ? normalizeVacancyStatus(body.status)
      : normalizeVacancyStatus(existing.status);

    const query = `
      UPDATE vacancies
      SET
        company_id = ?,
        practice_center_id = ?,
        workplace = ?,
        title = ?,
        sector = ?,
        description = ?,
        requirements = ?,
        horarios = ?,
        tipo_contrato = ?,
        sueldo_aproximado_bruto_anual = ?,
        status = ?
      WHERE id = ?
    `;
    await pool.query(query, [
      companyId,
      resolvedPracticeCenter.practiceCenterId,
      resolvedPracticeCenter.workplace,
      title,
      hasOwn(body, 'sector') ? toNullableText(body.sector) : existing.sector,
      hasOwn(body, 'description') ? toNullableText(body.description) : existing.description,
      hasOwn(body, 'requirements') ? toNullableText(body.requirements) : existing.requirements,
      hasOwn(body, 'horarios') ? toNullableText(body.horarios) : existing.horarios,
      hasOwn(body, 'tipo_contrato') ? toNullableText(body.tipo_contrato) : existing.tipo_contrato,
      hasOwn(body, 'sueldo_aproximado_bruto_anual')
        ? normalizeMoney(body.sueldo_aproximado_bruto_anual)
        : existing.sueldo_aproximado_bruto_anual,
      status,
      vacancyId,
    ]);

    return res.json({ message: 'Vacante actualizada con éxito' });
  } catch (e) {
    const msg = (e as Error).message || '';
    if (msg.includes('practice_center_id') || msg.includes('status')) {
      return res.status(400).json({ error: msg });
    }
    return res.status(500).json({ error: 'Error al actualizar vacante', details: (e as Error).message });
  }
});

/**
 * GET by id
 */
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT
         v.*,
         c.name AS company_name,
         c.fiscal_name AS company_fiscal_name,
         pc.sector AS practice_center_sector,
         pc.center AS practice_center_name,
         pc.address AS practice_center_address
       FROM vacancies v
       INNER JOIN companies c ON c.id = v.company_id
       LEFT JOIN company_practice_centers pc ON pc.id = v.practice_center_id
       WHERE v.id = ?
       LIMIT 1`,
      [req.params.id]
    );
    if ((rows as any[]).length === 0) return res.status(404).json({ error: 'No encontrado' });
    return res.json((rows as any[])[0]);
  } catch (e) {
    return res.status(500).json({ error: 'Error', details: (e as Error).message });
  }
});

/**
 * DELETE by id
 */
router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM vacancies WHERE id = ?', [req.params.id]);
    return res.json({ message: 'Eliminado correctamente' });
  } catch (e) {
    return res.status(500).json({ error: 'Error al eliminar', details: (e as Error).message });
  }
});

export default router;
