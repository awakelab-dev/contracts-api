import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);
let ensureEmploymentContractsSchemaPromise: Promise<void> | null = null;

const norm = (v: any) => (v ?? '').toString().trim();
const toNull = (v: any) => {
  const s = norm(v);
  return s ? s : null;
};
const toPositiveInt = (v: any) => {
  const s = norm(v);
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.trunc(n);
};
const normalizeSiNo = (value: any, fallback: 'SI' | 'NO' = 'NO'): 'SI' | 'NO' => {
  const cleaned = norm(value).toUpperCase();
  if (!cleaned) return fallback;
  if (['SI', 'SÍ', 'S', '1', 'TRUE', 'YES'].includes(cleaned)) return 'SI';
  if (['NO', 'N', '0', 'FALSE'].includes(cleaned)) return 'NO';
  return fallback;
};
const normalizeDate = (value: any) => {
  const s = norm(value);
  if (!s) return null;
  return s.length >= 10 ? s.slice(0, 10) : null;
};
const normalizeExpediente = (value: any) => {
  const s = norm(value).toUpperCase();
  return s || null;
};

async function hasTable(tableName: string): Promise<boolean> {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS c
     FROM information_schema.tables
     WHERE table_schema = DATABASE()
       AND table_name = ?`,
    [tableName]
  );
  return Number((rows as Array<{ c: number }>)[0]?.c || 0) > 0;
}

async function dropForeignKeyIfExists(tableName: string, constraintName: string) {
  const exists = await hasForeignKeyConstraint(tableName, constraintName);
  if (!exists) return;
  await pool.query(`ALTER TABLE ${tableName} DROP FOREIGN KEY ${constraintName}`);
}

async function listForeignKeysForColumn(tableName: string, columnName: string): Promise<string[]> {
  const [rows] = await pool.query(
    `SELECT DISTINCT CONSTRAINT_NAME AS constraint_name
     FROM information_schema.key_column_usage
     WHERE table_schema = DATABASE()
       AND table_name = ?
       AND column_name = ?
       AND referenced_table_name IS NOT NULL`,
    [tableName, columnName]
  );
  return (rows as Array<Record<string, any>>)
    .map((row) => row.constraint_name ?? row.CONSTRAINT_NAME ?? row.Constraint_name)
    .map((name) => (typeof name === 'string' ? name : ''))
    .filter((name) => !!name);
}

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

async function dropColumnIfExists(tableName: string, columnName: string) {
  const exists = await hasColumn(tableName, columnName);
  if (!exists) return;
  await pool.query(`ALTER TABLE ${tableName} DROP COLUMN ${columnName}`);
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

async function dropIndexIfExists(tableName: string, indexName: string) {
  const exists = await hasIndex(tableName, indexName);
  if (!exists) return;
  await pool.query(`ALTER TABLE ${tableName} DROP INDEX ${indexName}`);
}

async function hasForeignKeyConstraint(tableName: string, constraintName: string): Promise<boolean> {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS c
     FROM information_schema.table_constraints
     WHERE table_schema = DATABASE()
       AND table_name = ?
       AND constraint_type = 'FOREIGN KEY'
       AND constraint_name = ?`,
    [tableName, constraintName]
  );
  return Number((rows as Array<{ c: number }>)[0]?.c || 0) > 0;
}

async function ensureEmploymentContractsSchema() {
  if (ensureEmploymentContractsSchemaPromise) {
    await ensureEmploymentContractsSchemaPromise;
    return;
  }

  ensureEmploymentContractsSchemaPromise = (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS employment_contracts (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        expediente VARCHAR(64) NOT NULL,
        sector_id BIGINT NULL,
        position VARCHAR(190) NULL,
        company_id BIGINT NULL,
        is_itinerary_company_contract VARCHAR(2) NOT NULL DEFAULT 'NO',
        contract_code INT UNSIGNED NULL,
        attached_contract VARCHAR(2) NOT NULL DEFAULT 'NO',
        attached_work_life VARCHAR(2) NOT NULL DEFAULT 'NO',
        observations TEXT NULL,
        start_date DATE NULL,
        end_date DATE NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB
    `);
    await ensureColumn('employment_contracts', 'expediente', 'VARCHAR(64) NULL AFTER id');
    await ensureColumn('employment_contracts', 'sector_id', 'BIGINT NULL AFTER expediente');
    await ensureColumn('employment_contracts', 'position', 'VARCHAR(190) NULL AFTER sector_id');
    await ensureColumn('employment_contracts', 'company_id', 'BIGINT NULL AFTER position');
    await ensureColumn(
      'employment_contracts',
      'is_itinerary_company_contract',
      "VARCHAR(2) NOT NULL DEFAULT 'NO' AFTER company_id"
    );
    await ensureColumn('employment_contracts', 'contract_code', 'INT UNSIGNED NULL AFTER is_itinerary_company_contract');
    await ensureColumn('employment_contracts', 'attached_contract', "VARCHAR(2) NOT NULL DEFAULT 'NO' AFTER contract_code");
    await ensureColumn('employment_contracts', 'attached_work_life', "VARCHAR(2) NOT NULL DEFAULT 'NO' AFTER attached_contract");
    await ensureColumn('employment_contracts', 'observations', 'TEXT NULL AFTER attached_work_life');
    await ensureColumn('employment_contracts', 'start_date', 'DATE NULL AFTER observations');
    await ensureColumn('employment_contracts', 'end_date', 'DATE NULL AFTER start_date');
    await ensureColumn('employment_contracts', 'created_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP AFTER end_date');
    await ensureColumn(
      'employment_contracts',
      'updated_at',
      'TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at'
    );

    const hasStudentIdColumn = await hasColumn('employment_contracts', 'student_id');
    if (hasStudentIdColumn) {
      await pool.query(`
        UPDATE employment_contracts ec
        SET ec.expediente = COALESCE(
          ec.expediente,
          (
            SELECT cis.expediente
            FROM students s
            INNER JOIN course_itinerary_students cis ON cis.dni_nie = s.dni_nie
            WHERE s.id = ec.student_id
            ORDER BY COALESCE(cis.effective_start_date, '1000-01-01') DESC, cis.expediente DESC
            LIMIT 1
          )
        )
        WHERE ec.student_id IS NOT NULL
      `);
    }

    const studentForeignKeys = await listForeignKeysForColumn('employment_contracts', 'student_id');
    for (const constraintName of studentForeignKeys) {
      await pool.query(`ALTER TABLE employment_contracts DROP FOREIGN KEY ${constraintName}`);
    }
    await dropIndexIfExists('employment_contracts', 'idx_employment_contracts_student_id');
    await dropForeignKeyIfExists('employment_contracts', 'fk_employment_contracts_student_id');
    await dropColumnIfExists('employment_contracts', 'student_id');

    await pool.query(`
      UPDATE employment_contracts
      SET
        expediente = UPPER(TRIM(COALESCE(expediente, ''))),
        is_itinerary_company_contract = CASE
          WHEN UPPER(TRIM(COALESCE(is_itinerary_company_contract, ''))) IN ('SI', 'SÍ', 'S', '1', 'TRUE', 'YES') THEN 'SI'
          WHEN UPPER(TRIM(COALESCE(is_itinerary_company_contract, ''))) IN ('NO', 'N', '0', 'FALSE') THEN 'NO'
          ELSE 'NO'
        END,
        attached_contract = CASE
          WHEN UPPER(TRIM(COALESCE(attached_contract, ''))) IN ('SI', 'SÍ', 'S', '1', 'TRUE', 'YES') THEN 'SI'
          WHEN UPPER(TRIM(COALESCE(attached_contract, ''))) IN ('NO', 'N', '0', 'FALSE') THEN 'NO'
          WHEN TRIM(COALESCE(attached_contract, '')) = '' THEN 'NO'
          ELSE 'SI'
        END,
        attached_work_life = CASE
          WHEN UPPER(TRIM(COALESCE(attached_work_life, ''))) IN ('SI', 'SÍ', 'S', '1', 'TRUE', 'YES') THEN 'SI'
          WHEN UPPER(TRIM(COALESCE(attached_work_life, ''))) IN ('NO', 'N', '0', 'FALSE') THEN 'NO'
          ELSE 'NO'
        END
    `);

    await dropColumnIfExists('employment_contracts', 'sector');
    await dropColumnIfExists('employment_contracts', 'employer');
    await dropColumnIfExists('employment_contracts', 'contract_type');
    await dropColumnIfExists('employment_contracts', 'workday');
    await dropColumnIfExists('employment_contracts', 'worked_days');

    const hasHiringContractsTable = await hasTable('hiring_contracts');
    if (hasHiringContractsTable) {
      const [ecCountRows] = await pool.query('SELECT COUNT(*) AS c FROM employment_contracts');
      const employmentContractsCount = Number((ecCountRows as Array<{ c: number }>)[0]?.c || 0);

      if (employmentContractsCount === 0) {
        await pool.query(`
          INSERT INTO employment_contracts (
            expediente,
            sector_id,
            position,
            company_id,
            is_itinerary_company_contract,
            contract_code,
            attached_contract,
            attached_work_life,
            observations,
            start_date,
            end_date
          )
          SELECT
            migrated.expediente,
            migrated.sector_id,
            migrated.position,
            migrated.company_id,
            migrated.is_itinerary_company_contract,
            migrated.contract_code,
            migrated.attached_contract,
            migrated.attached_work_life,
            migrated.observations,
            migrated.start_date,
            migrated.end_date
          FROM (
            SELECT
              (
                SELECT cis.expediente
                FROM students s
                INNER JOIN course_itinerary_students cis ON cis.dni_nie = s.dni_nie
                WHERE s.id = hc.student_id
                ORDER BY COALESCE(cis.effective_start_date, '1000-01-01') DESC, cis.expediente DESC
                LIMIT 1
              ) AS expediente,
              sec.id AS sector_id,
              NULL AS position,
              COALESCE(company_by_cif.id, company_by_name.id) AS company_id,
              'NO' AS is_itinerary_company_contract,
              CASE
                WHEN TRIM(COALESCE(hc.sector, '')) REGEXP '^[0-9]+$'
                  THEN CAST(TRIM(hc.sector) AS UNSIGNED)
                ELSE NULL
              END AS contract_code,
              'NO' AS attached_contract,
              'NO' AS attached_work_life,
              hc.notes AS observations,
              hc.start_date,
              hc.end_date
            FROM hiring_contracts hc
            LEFT JOIN sectors sec
              ON UPPER(TRIM(sec.sector_name)) = UPPER(TRIM(COALESCE(hc.sector, '')))
            LEFT JOIN companies company_by_cif
              ON UPPER(TRIM(COALESCE(company_by_cif.cif, ''))) = UPPER(TRIM(COALESCE(hc.company_nif, '')))
            LEFT JOIN companies company_by_name
              ON UPPER(TRIM(company_by_name.name)) = UPPER(TRIM(COALESCE(hc.company_name, '')))
          ) AS migrated
          WHERE migrated.expediente IS NOT NULL
            AND TRIM(migrated.expediente) <> ''
        `);
      }
    }

    await pool.query(`
      DELETE ec
      FROM employment_contracts ec
      LEFT JOIN course_itinerary_students cis ON cis.expediente = ec.expediente
      WHERE ec.expediente IS NULL
         OR TRIM(COALESCE(ec.expediente, '')) = ''
         OR cis.expediente IS NULL
    `);

    await pool.query(`
      UPDATE employment_contracts ec
      LEFT JOIN sectors sec ON sec.id = ec.sector_id
      SET ec.sector_id = NULL
      WHERE ec.sector_id IS NOT NULL
        AND sec.id IS NULL
    `);

    await pool.query(`
      UPDATE employment_contracts ec
      LEFT JOIN companies c ON c.id = ec.company_id
      SET ec.company_id = NULL
      WHERE ec.company_id IS NOT NULL
        AND c.id IS NULL
    `);

    await pool.query(`
      UPDATE employment_contracts ec
      LEFT JOIN contract_codes cc ON cc.code = ec.contract_code
      SET ec.contract_code = NULL
      WHERE ec.contract_code IS NOT NULL
        AND cc.code IS NULL
    `);

    await pool.query(`
      UPDATE employment_contracts
      SET expediente = UPPER(TRIM(expediente))
      WHERE expediente IS NOT NULL
    `);

    await pool.query('ALTER TABLE employment_contracts MODIFY COLUMN expediente VARCHAR(64) NOT NULL');

    const hasExpedienteIdx = await hasIndex('employment_contracts', 'idx_employment_contracts_expediente');
    if (!hasExpedienteIdx) {
      await pool.query('ALTER TABLE employment_contracts ADD INDEX idx_employment_contracts_expediente (expediente)');
    }
    const hasSectorIdx = await hasIndex('employment_contracts', 'idx_employment_contracts_sector_id');
    if (!hasSectorIdx) {
      await pool.query('ALTER TABLE employment_contracts ADD INDEX idx_employment_contracts_sector_id (sector_id)');
    }
    const hasCompanyIdx = await hasIndex('employment_contracts', 'idx_employment_contracts_company_id');
    if (!hasCompanyIdx) {
      await pool.query('ALTER TABLE employment_contracts ADD INDEX idx_employment_contracts_company_id (company_id)');
    }
    const hasContractCodeIdx = await hasIndex('employment_contracts', 'idx_employment_contracts_contract_code');
    if (!hasContractCodeIdx) {
      await pool.query('ALTER TABLE employment_contracts ADD INDEX idx_employment_contracts_contract_code (contract_code)');
    }
    const hasStartDateIdx = await hasIndex('employment_contracts', 'idx_employment_contracts_start_date');
    if (!hasStartDateIdx) {
      await pool.query('ALTER TABLE employment_contracts ADD INDEX idx_employment_contracts_start_date (start_date)');
    }
    const hasEndDateIdx = await hasIndex('employment_contracts', 'idx_employment_contracts_end_date');
    if (!hasEndDateIdx) {
      await pool.query('ALTER TABLE employment_contracts ADD INDEX idx_employment_contracts_end_date (end_date)');
    }

    const fkNamesToDrop = new Set<string>([
      'fk_employment_contracts_expediente',
      'fk_employment_contracts_sector_id',
      'fk_employment_contracts_company_id',
      'fk_employment_contracts_contract_code',
    ]);
    for (const name of await listForeignKeysForColumn('employment_contracts', 'expediente')) fkNamesToDrop.add(name);
    for (const name of await listForeignKeysForColumn('employment_contracts', 'sector_id')) fkNamesToDrop.add(name);
    for (const name of await listForeignKeysForColumn('employment_contracts', 'company_id')) fkNamesToDrop.add(name);
    for (const name of await listForeignKeysForColumn('employment_contracts', 'contract_code')) fkNamesToDrop.add(name);
    for (const constraintName of fkNamesToDrop) {
      await dropForeignKeyIfExists('employment_contracts', constraintName);
    }

    if (!(await hasForeignKeyConstraint('employment_contracts', 'fk_employment_contracts_expediente'))) {
      await pool.query(`
        ALTER TABLE employment_contracts
        ADD CONSTRAINT fk_employment_contracts_expediente
        FOREIGN KEY (expediente) REFERENCES course_itinerary_students(expediente)
        ON UPDATE CASCADE
        ON DELETE CASCADE
      `);
    }
    if (!(await hasForeignKeyConstraint('employment_contracts', 'fk_employment_contracts_sector_id'))) {
      await pool.query(`
        ALTER TABLE employment_contracts
        ADD CONSTRAINT fk_employment_contracts_sector_id
        FOREIGN KEY (sector_id) REFERENCES sectors(id)
        ON UPDATE CASCADE
        ON DELETE SET NULL
      `);
    }
    if (!(await hasForeignKeyConstraint('employment_contracts', 'fk_employment_contracts_company_id'))) {
      await pool.query(`
        ALTER TABLE employment_contracts
        ADD CONSTRAINT fk_employment_contracts_company_id
        FOREIGN KEY (company_id) REFERENCES companies(id)
        ON UPDATE CASCADE
        ON DELETE SET NULL
      `);
    }
    if (!(await hasForeignKeyConstraint('employment_contracts', 'fk_employment_contracts_contract_code'))) {
      await pool.query(`
        ALTER TABLE employment_contracts
        ADD CONSTRAINT fk_employment_contracts_contract_code
        FOREIGN KEY (contract_code) REFERENCES contract_codes(code)
        ON UPDATE CASCADE
        ON DELETE SET NULL
      `);
    }
  })();

  try {
    await ensureEmploymentContractsSchemaPromise;
  } catch (error) {
    ensureEmploymentContractsSchemaPromise = null;
    throw error;
  }
}

async function assertExpedienteBelongsToStudent(studentId: number, expediente: string) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS c
     FROM students s
     INNER JOIN course_itinerary_students cis ON cis.dni_nie = s.dni_nie
     WHERE s.id = ?
       AND cis.expediente = ?`,
    [studentId, expediente]
  );
  const count = Number((rows as Array<{ c: number }>)[0]?.c || 0);
  return count > 0;
}

router.use(async (req, res, next) => {
  if (req.method === 'OPTIONS') {
    return next();
  }
  try {
    await ensureEmploymentContractsSchema();
    return next();
  } catch (e) {
    return res
      .status(500)
      .json({ error: 'Error al preparar esquema de contrataciones', details: (e as Error).message });
  }
});

// GET /hiring-contracts?student_id=1
router.get('/', async (req, res) => {
  try {
    const studentId = req.query.student_id ? toPositiveInt(req.query.student_id) : null;
    if (req.query.student_id && !studentId) {
      return res.status(400).json({ error: 'student_id must be a positive integer' });
    }

    const sql = `
      SELECT
        ec.id,
        sm.student_id,
        ec.expediente,
        ec.sector_id,
        sct.sector_name AS sector_name,
        ec.position,
        ec.company_id,
        c.name AS company_name,
        c.fiscal_name AS company_fiscal_name,
        c.cif AS company_cif,
        ec.is_itinerary_company_contract,
        ec.contract_code,
        ec.attached_contract,
        ec.attached_work_life,
        ec.observations,
        ec.start_date,
        ec.end_date
      FROM employment_contracts ec
      LEFT JOIN sectors sct ON sct.id = ec.sector_id
      LEFT JOIN companies c ON c.id = ec.company_id
      LEFT JOIN (
        SELECT cis.expediente, MIN(s.id) AS student_id
        FROM course_itinerary_students cis
        INNER JOIN students s ON s.dni_nie = cis.dni_nie
        GROUP BY cis.expediente
      ) sm ON sm.expediente = ec.expediente
      ${studentId ? 'WHERE sm.student_id = ?' : ''}
      ORDER BY ec.start_date DESC, ec.id DESC
    `;

    const params = studentId ? [studentId] : [];
    const [rows] = await pool.query(sql, params);
    return res.json(rows);
  } catch (e) {
    return res.status(500).json({ error: 'Error al consultar contrataciones', details: (e as Error).message });
  }
});

// POST /hiring-contracts
router.post('/', async (req, res) => {
  const sid = toPositiveInt(req.body?.student_id);
  const normalizedExpediente = normalizeExpediente(req.body?.expediente);
  const resolvedSectorId = toPositiveInt(req.body?.sector_id ?? req.body?.sector);
  const resolvedCompanyId = toPositiveInt(req.body?.company_id ?? req.body?.empresa);
  const resolvedContractCode = toPositiveInt(req.body?.contract_code ?? req.body?.codigo_contrato_laboral);
  const resolvedStartDate = normalizeDate(req.body?.start_date ?? req.body?.fecha_inicio);
  const resolvedEndDate = normalizeDate(req.body?.end_date ?? req.body?.fecha_fin);
  const resolvedPosition = toNull(req.body?.position ?? req.body?.puesto);
  const resolvedItineraryContract = normalizeSiNo(
    req.body?.is_itinerary_company_contract ?? req.body?.contrato_empresa_itinerario,
    'NO'
  );
  const resolvedAttachedContract = normalizeSiNo(req.body?.attached_contract ?? req.body?.adjunta_contrato, 'NO');
  const resolvedAttachedWorkLife = normalizeSiNo(req.body?.attached_work_life ?? req.body?.adjunta_vida_laboral, 'NO');
  const resolvedObservations = toNull(req.body?.observations ?? req.body?.observaciones ?? req.body?.notes);

  if (
    !normalizedExpediente ||
    !resolvedSectorId ||
    !resolvedPosition ||
    !resolvedCompanyId ||
    !resolvedContractCode ||
    !resolvedStartDate
  ) {
    return res.status(400).json({
      error: 'expediente, sector_id, position, company_id, contract_code y start_date son obligatorios',
    });
  }

  try {
    const [expRows] = await pool.query(
      'SELECT expediente FROM course_itinerary_students WHERE expediente = ? LIMIT 1',
      [normalizedExpediente]
    );
    if ((expRows as any[]).length === 0) {
      return res.status(400).json({ error: 'expediente no existe en course_itinerary_students' });
    }

    if (sid) {
      const belongs = await assertExpedienteBelongsToStudent(sid, normalizedExpediente);
      if (!belongs) {
        return res.status(400).json({ error: 'expediente no pertenece al alumno seleccionado' });
      }
    }

    const [companyRows] = await pool.query('SELECT id FROM companies WHERE id = ? LIMIT 1', [resolvedCompanyId]);
    if ((companyRows as any[]).length === 0) {
      return res.status(400).json({ error: 'company_id no existe' });
    }

    const [sectorRows] = await pool.query('SELECT id FROM sectors WHERE id = ? LIMIT 1', [resolvedSectorId]);
    if ((sectorRows as any[]).length === 0) {
      return res.status(400).json({ error: 'sector_id no existe' });
    }

    const [contractCodeRows] = await pool.query('SELECT code FROM contract_codes WHERE code = ? LIMIT 1', [resolvedContractCode]);
    if ((contractCodeRows as any[]).length === 0) {
      return res.status(400).json({ error: 'contract_code no existe en contract_codes' });
    }

    const [result] = await pool.query(
      `
        INSERT INTO employment_contracts
        (
          expediente,
          sector_id,
          position,
          company_id,
          is_itinerary_company_contract,
          contract_code,
          attached_contract,
          attached_work_life,
          observations,
          start_date,
          end_date
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        normalizedExpediente,
        resolvedSectorId,
        resolvedPosition,
        resolvedCompanyId,
        resolvedItineraryContract,
        resolvedContractCode,
        resolvedAttachedContract,
        resolvedAttachedWorkLife,
        resolvedObservations,
        resolvedStartDate,
        resolvedEndDate,
      ]
    );

    return res.status(201).json({ id: (result as any).insertId });
  } catch (e) {
    return res.status(500).json({ error: 'Error al crear contratación', details: (e as Error).message });
  }
});

// PUT /hiring-contracts/:id
router.put('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'id must be a number' });

  const sid = toPositiveInt(req.body?.student_id);
  const normalizedExpediente = normalizeExpediente(req.body?.expediente);
  const resolvedSectorId = toPositiveInt(req.body?.sector_id ?? req.body?.sector);
  const resolvedCompanyId = toPositiveInt(req.body?.company_id ?? req.body?.empresa);
  const resolvedContractCode = toPositiveInt(req.body?.contract_code ?? req.body?.codigo_contrato_laboral);
  const resolvedStartDate = normalizeDate(req.body?.start_date ?? req.body?.fecha_inicio);
  const resolvedEndDate = normalizeDate(req.body?.end_date ?? req.body?.fecha_fin);
  const resolvedPosition = toNull(req.body?.position ?? req.body?.puesto);
  const resolvedItineraryContract = normalizeSiNo(
    req.body?.is_itinerary_company_contract ?? req.body?.contrato_empresa_itinerario,
    'NO'
  );
  const resolvedAttachedContract = normalizeSiNo(req.body?.attached_contract ?? req.body?.adjunta_contrato, 'NO');
  const resolvedAttachedWorkLife = normalizeSiNo(req.body?.attached_work_life ?? req.body?.adjunta_vida_laboral, 'NO');
  const resolvedObservations = toNull(req.body?.observations ?? req.body?.observaciones ?? req.body?.notes);

  if (
    !normalizedExpediente ||
    !resolvedSectorId ||
    !resolvedPosition ||
    !resolvedCompanyId ||
    !resolvedContractCode ||
    !resolvedStartDate
  ) {
    return res.status(400).json({
      error: 'expediente, sector_id, position, company_id, contract_code y start_date son obligatorios',
    });
  }

  try {
    const [expRows] = await pool.query(
      'SELECT expediente FROM course_itinerary_students WHERE expediente = ? LIMIT 1',
      [normalizedExpediente]
    );
    if ((expRows as any[]).length === 0) {
      return res.status(400).json({ error: 'expediente no existe en course_itinerary_students' });
    }

    if (sid) {
      const belongs = await assertExpedienteBelongsToStudent(sid, normalizedExpediente);
      if (!belongs) {
        return res.status(400).json({ error: 'expediente no pertenece al alumno seleccionado' });
      }
    }

    const [companyRows] = await pool.query('SELECT id FROM companies WHERE id = ? LIMIT 1', [resolvedCompanyId]);
    if ((companyRows as any[]).length === 0) {
      return res.status(400).json({ error: 'company_id no existe' });
    }

    const [sectorRows] = await pool.query('SELECT id FROM sectors WHERE id = ? LIMIT 1', [resolvedSectorId]);
    if ((sectorRows as any[]).length === 0) {
      return res.status(400).json({ error: 'sector_id no existe' });
    }

    const [contractCodeRows] = await pool.query('SELECT code FROM contract_codes WHERE code = ? LIMIT 1', [resolvedContractCode]);
    if ((contractCodeRows as any[]).length === 0) {
      return res.status(400).json({ error: 'contract_code no existe en contract_codes' });
    }

    const [result] = await pool.query(
      `
        UPDATE employment_contracts
        SET
          expediente = ?,
          sector_id = ?,
          position = ?,
          company_id = ?,
          is_itinerary_company_contract = ?,
          contract_code = ?,
          attached_contract = ?,
          attached_work_life = ?,
          observations = ?,
          start_date = ?,
          end_date = ?
        WHERE id = ?
      `,
      [
        normalizedExpediente,
        resolvedSectorId,
        resolvedPosition,
        resolvedCompanyId,
        resolvedItineraryContract,
        resolvedContractCode,
        resolvedAttachedContract,
        resolvedAttachedWorkLife,
        resolvedObservations,
        resolvedStartDate,
        resolvedEndDate,
        id,
      ]
    );

    if (Number((result as any)?.affectedRows || 0) === 0) {
      return res.status(404).json({ error: 'Contratación no encontrada' });
    }

    return res.json({ message: 'Contratación actualizada' });
  } catch (e) {
    return res.status(500).json({ error: 'Error al actualizar contratación', details: (e as Error).message });
  }
});

// DELETE /hiring-contracts/:id
router.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'id must be a number' });

  try {
    await pool.query('DELETE FROM employment_contracts WHERE id = ?', [id]);
    return res.json({ message: 'Contratación eliminada' });
  } catch (e) {
    return res.status(500).json({ error: 'Error al eliminar contratación', details: (e as Error).message });
  }
});

export default router;