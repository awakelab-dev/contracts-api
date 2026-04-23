import { Router } from 'express';
import type { ResultSetHeader } from 'mysql2';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);
let ensureCompaniesSchemaPromise: Promise<void> | null = null;
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

async function dropIndexIfExists(tableName: string, indexName: string) {
  const exists = await hasIndex(tableName, indexName);
  if (!exists) return;
  await pool.query(`ALTER TABLE ${tableName} DROP INDEX ${indexName}`);
}

async function dropColumnIfExists(tableName: string, columnName: string) {
  const exists = await hasColumn(tableName, columnName);
  if (!exists) return;
  await pool.query(`ALTER TABLE ${tableName} DROP COLUMN ${columnName}`);
}

async function ensureColumn(tableName: string, columnName: string, definitionSql: string) {
  const exists = await hasColumn(tableName, columnName);
  if (exists) return;
  await pool.query(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definitionSql}`);
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

async function ensureCompaniesSchema() {
  if (ensureCompaniesSchemaPromise) {
    await ensureCompaniesSchemaPromise;
    return;
  }

  ensureCompaniesSchemaPromise = (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sectors (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        sector_name VARCHAR(120) NOT NULL,
        UNIQUE KEY uq_sectors_name (sector_name)
      ) ENGINE=InnoDB
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS companies (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        cif VARCHAR(50) NULL,
        name VARCHAR(190) NOT NULL,
        fiscal_name VARCHAR(255) NULL,
        sector_id BIGINT NULL,
        company_email VARCHAR(190) NULL,
        company_phone VARCHAR(50) NULL,
        contact_name VARCHAR(190) NULL,
        contact_email VARCHAR(190) NULL,
        contact_phone VARCHAR(50) NULL,
        contact_date DATE NULL,
        agreement_signed VARCHAR(10) NULL,
        agreement_date DATE NULL,
        agreement_code VARCHAR(64) NULL,
        codigo_convenio VARCHAR(64) NULL,
        required_position VARCHAR(255) NULL,
        has_complex_practice_centers TINYINT(1) NOT NULL DEFAULT 0,
        notes TEXT NULL,
        UNIQUE KEY uq_company_fiscal_name (fiscal_name)
      ) ENGINE=InnoDB
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS company_practice_centers (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        company_id BIGINT NOT NULL,
        address VARCHAR(255) NULL,
        sector VARCHAR(120) NULL,
        center VARCHAR(190) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_company_practice_centers_company_id (company_id),
        CONSTRAINT fk_company_practice_centers_company
          FOREIGN KEY (company_id) REFERENCES companies(id)
          ON UPDATE CASCADE
          ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);

    await ensureColumn('companies', 'cif', 'VARCHAR(50) NULL AFTER id');
    await ensureColumn('companies', 'fiscal_name', 'VARCHAR(255) NULL AFTER name');
    await ensureColumn('companies', 'sector_id', 'BIGINT NULL AFTER fiscal_name');
    await ensureColumn('companies', 'company_email', 'VARCHAR(190) NULL AFTER sector_id');
    await ensureColumn('companies', 'company_phone', 'VARCHAR(50) NULL AFTER company_email');
    await ensureColumn('companies', 'contact_name', 'VARCHAR(190) NULL AFTER company_phone');
    await ensureColumn('companies', 'contact_email', 'VARCHAR(190) NULL AFTER contact_name');
    await ensureColumn('companies', 'contact_phone', 'VARCHAR(50) NULL AFTER contact_email');
    await ensureColumn('companies', 'contact_date', 'DATE NULL AFTER contact_phone');
    await ensureColumn('companies', 'agreement_signed', 'VARCHAR(10) NULL AFTER contact_date');
    await ensureColumn('companies', 'agreement_date', 'DATE NULL AFTER agreement_signed');
    await ensureColumn('companies', 'agreement_code', 'VARCHAR(64) NULL AFTER agreement_date');
    await ensureColumn('companies', 'codigo_convenio', 'VARCHAR(64) NULL AFTER agreement_code');
    await ensureColumn('companies', 'required_position', 'VARCHAR(255) NULL AFTER codigo_convenio');
    await ensureColumn('companies', 'has_complex_practice_centers', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER required_position');
    await ensureColumn('companies', 'notes', 'TEXT NULL AFTER has_complex_practice_centers');

    const hasLegacyNif = await hasColumn('companies', 'nif');
    if (hasLegacyNif) {
      await pool.query(`
        UPDATE companies
        SET cif = nif
        WHERE (cif IS NULL OR TRIM(cif) = '')
          AND nif IS NOT NULL
          AND TRIM(nif) <> ''
      `);
    }

    await dropIndexIfExists('companies', 'uq_company_name');
    await dropIndexIfExists('companies', 'uq_company_nif');
    await dropColumnIfExists('companies', 'nif');

    const hasFiscalNameUq = await hasIndex('companies', 'uq_company_fiscal_name');
    if (!hasFiscalNameUq) {
      const [duplicateFiscalRows] = await pool.query(
        `SELECT TRIM(fiscal_name) AS fiscal_name, COUNT(*) AS c
         FROM companies
         WHERE fiscal_name IS NOT NULL AND TRIM(fiscal_name) <> ''
         GROUP BY TRIM(fiscal_name)
         HAVING COUNT(*) > 1
         LIMIT 1`
      );
      if ((duplicateFiscalRows as Array<{ fiscal_name: string; c: number }>).length === 0) {
        await pool.query('ALTER TABLE companies ADD UNIQUE INDEX uq_company_fiscal_name (fiscal_name)');
      }
    }

    const idxExists = await hasIndex('companies', 'idx_companies_sector_id');
    if (!idxExists) {
      await pool.query('ALTER TABLE companies ADD INDEX idx_companies_sector_id (sector_id)');
    }
    const hasLegacySector = await hasColumn('companies', 'sector');

    if (hasLegacySector) {
      await pool.query(`
        INSERT INTO sectors (sector_name)
        SELECT DISTINCT UPPER(TRIM(sector))
        FROM companies
        WHERE sector IS NOT NULL AND TRIM(sector) <> ''
        ON DUPLICATE KEY UPDATE sector_name = VALUES(sector_name)
      `);

      await pool.query(`
        UPDATE companies c
        INNER JOIN sectors s ON s.sector_name = UPPER(TRIM(c.sector))
        SET c.sector_id = s.id
        WHERE c.sector_id IS NULL
          AND c.sector IS NOT NULL
          AND TRIM(c.sector) <> ''
      `);

      await dropColumnIfExists('companies', 'sector');
    }


    await pool.query(`
      UPDATE companies
      SET codigo_convenio = agreement_code
      WHERE (codigo_convenio IS NULL OR TRIM(codigo_convenio) = '')
        AND agreement_code IS NOT NULL
        AND TRIM(agreement_code) <> ''
    `);

    const fkExists = await hasForeignKey('companies', 'fk_companies_sector');
    if (!fkExists) {
      await pool.query(
        `ALTER TABLE companies
         ADD CONSTRAINT fk_companies_sector
         FOREIGN KEY (sector_id) REFERENCES sectors(id)
         ON UPDATE CASCADE
         ON DELETE SET NULL`
      );
    }
  })();

  try {
    await ensureCompaniesSchemaPromise;
  } catch (error) {
    ensureCompaniesSchemaPromise = null;
    throw error;
  }
}

router.use(async (req, res, next) => {
  if (req.method === 'OPTIONS') {
    return next();
  }
  try {
    await ensureCompaniesSchema();
    return next();
  } catch (e) {
    return res.status(500).json({ error: 'Error al preparar esquema de empresas', details: (e as Error).message });
  }
});

const COMPANY_SELECT = `
  SELECT
    c.id,
    c.cif,
    c.name,
    c.fiscal_name,
    c.sector_id,
    s.sector_name,
    s.sector_name AS sector,
    c.company_email,
    c.company_phone,
    c.contact_name,
    c.contact_email,
    c.contact_phone,
    c.contact_date,
    c.agreement_signed,
    c.agreement_date,
    COALESCE(c.codigo_convenio, c.agreement_code) AS agreement_code,
    COALESCE(c.codigo_convenio, c.agreement_code) AS codigo_convenio,
    c.required_position,
    c.has_complex_practice_centers,
    c.notes
  FROM companies c
  LEFT JOIN sectors s ON s.id = c.sector_id
`;

const norm = (value: unknown) => (value ?? '').toString().trim();

const compactSpaces = (value: string) => value.replace(/\s+/g, ' ').trim();

const toNull = (value: unknown) => {
  const cleaned = compactSpaces(norm(value));
  return cleaned ? cleaned : null;
};

const normalizePhone = (value: unknown) => {
  const cleaned = compactSpaces(norm(value));
  return cleaned ? cleaned : null;
};

const normalizeDate = (value: unknown) => {
  const cleaned = norm(value);
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

  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return date.toISOString().slice(0, 10);
};

const normalizeAgreementSigned = (value: unknown) => {
  if (typeof value === 'boolean') {
    return value ? 'SI' : 'NO';
  }
  if (typeof value === 'number') {
    return value !== 0 ? 'SI' : 'NO';
  }
  const cleaned = norm(value).toUpperCase();
  if (!cleaned) return null;
  if (['TRUE', 'YES', '1'].includes(cleaned)) return 'SI';
  if (['FALSE', '0'].includes(cleaned)) return 'NO';
  if (cleaned.startsWith('SI') || cleaned === 'SÍ') return 'SI';
  if (cleaned.startsWith('NO')) return 'NO';
  return null;
};

const normalizeSectorName = (value: unknown) => {
  const cleaned = compactSpaces(norm(value)).toUpperCase();
  return cleaned ? cleaned : null;
};

const extractEmail = (value: unknown) => {
  const cleaned = norm(value);
  if (!cleaned) return null;
  const match = cleaned.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  if (!match) return null;
  return match[0].toLowerCase();
};

const toPositiveInt = (value: unknown) => {
  const cleaned = norm(value);
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.trunc(parsed);
};

const toBool = (value: unknown) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const cleaned = norm(value).toLowerCase();
  if (!cleaned) return false;
  return ['1', 'true', 'si', 'sí', 'yes'].includes(cleaned);
};

const pick = (obj: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    if (obj[key] !== undefined) return obj[key];
  }
  return undefined;
};

const isDuplicateEntryError = (error: unknown) =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { code?: string }).code === 'ER_DUP_ENTRY';

async function resolveSectorId(inputSectorId: unknown, inputSectorName: unknown): Promise<number | null> {
  const explicitId = toPositiveInt(inputSectorId);
  if (explicitId) {
    const [rows] = await pool.query('SELECT id FROM sectors WHERE id = ? LIMIT 1', [explicitId]);
    const sector = (rows as any[])[0];
    if (sector?.id) return Number(sector.id);
  }

  const sectorName = normalizeSectorName(inputSectorName);
  if (!sectorName) return null;

  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO sectors (sector_name)
     VALUES (?)
     ON DUPLICATE KEY UPDATE
       id = LAST_INSERT_ID(id),
       sector_name = VALUES(sector_name)`,
    [sectorName]
  );

  return Number((result as ResultSetHeader).insertId || 0) || null;
}

async function getCompanyMeta(companyId: number): Promise<{ id: number; hasComplexPracticeCenters: boolean } | null> {
  const [rows] = await pool.query(
    'SELECT id, has_complex_practice_centers FROM companies WHERE id = ? LIMIT 1',
    [companyId]
  );
  const company = (rows as any[])[0];
  if (!company?.id) return null;
  return {
    id: Number(company.id),
    hasComplexPracticeCenters: Number(company.has_complex_practice_centers || 0) === 1,
  };
}

/**
 * GET / - Listar todas las empresas
 */
router.get('/', async (_req, res) => {
  try {
    const [rows] = await pool.query(`${COMPANY_SELECT} ORDER BY c.name ASC`);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'Error al consultar empresas', details: (e as Error).message });
  }
});

/**
 * GET /sectors - catálogo de sectores
 */
router.get('/sectors', async (_req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, sector_name FROM sectors ORDER BY sector_name ASC');
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'Error al consultar sectores', details: (e as Error).message });
  }
});

/**
 * POST / - Crear una nueva empresa
 */
router.post('/', async (req, res) => {
  const {
    cif,
    name,
    fiscal_name,
    sector_id,
    sector_name,
    sector,
    company_email,
    company_phone,
    contact_name,
    contact_email,
    contact_phone,
    contact_date,
    agreement_signed,
    agreement_date,
    agreement_code,
    codigo_convenio,
    required_position,
    has_complex_practice_centers,
    notes,
  } = req.body ?? {};

  const companyName = toNull(name);
  if (!companyName) {
    return res.status(400).json({ error: 'El nombre de la empresa es obligatorio' });
  }

  try {
    const resolvedSectorId = await resolveSectorId(sector_id, sector_name ?? sector);
    const resolvedCompanyEmail = extractEmail(company_email ?? contact_email);
    const resolvedContactEmail = extractEmail(contact_email ?? company_email);
    const resolvedCif = toNull(cif);
    const resolvedAgreementCode = toNull(codigo_convenio ?? agreement_code);
    const hasComplexPracticeCenters = toBool(has_complex_practice_centers);

    const query = `
      INSERT INTO companies
      (
        cif,
        name,
        fiscal_name,
        sector_id,
        company_email,
        company_phone,
        contact_name,
        contact_email,
        contact_phone,
        contact_date,
        agreement_signed,
        agreement_date,
        agreement_code,
        codigo_convenio,
        required_position,
        has_complex_practice_centers,
        notes
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const [result] = await pool.query(query, [
      resolvedCif,
      companyName,
      toNull(fiscal_name),
      resolvedSectorId,
      resolvedCompanyEmail,
      normalizePhone(company_phone),
      toNull(contact_name),
      resolvedContactEmail,
      normalizePhone(contact_phone),
      normalizeDate(contact_date),
      normalizeAgreementSigned(agreement_signed),
      normalizeDate(agreement_date),
      resolvedAgreementCode,
      resolvedAgreementCode,
      toNull(required_position),
      hasComplexPracticeCenters ? 1 : 0,
      toNull(notes),
    ]);

    res.status(201).json({ message: 'Empresa creada', id: (result as ResultSetHeader).insertId });
  } catch (e) {
    if (isDuplicateEntryError(e)) {
      return res.status(409).json({ error: 'El nombre fiscal debe ser único' });
    }
    res.status(500).json({ error: 'Error al crear empresa', details: (e as Error).message });
  }
});

/**
 * POST /companies/import - importación masiva de empresas
 */
router.post('/import', async (req, res) => {
  const rows = (req.body?.rows || []) as Array<Record<string, unknown>>;
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'rows must be a non-empty array' });
  }

  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  try {
    for (const row of rows) {
      const companyIdFromCsv = toPositiveInt(
        pick(row, ['id', 'company_id', 'code', 'codigo', 'CÓDIGO', 'CODIGO'])
      );
      const companyName = toNull(
        pick(row, ['name', 'company_name', 'NOMBRE COMERCIAL', 'commercial_name'])
      );
      const fiscalName = toNull(
        pick(row, ['fiscal_name', 'NOMBRE FISCAL', 'legal_name'])
      );

      if (!companyName) {
        skipped += 1;
        continue;
      }
      const resolvedCif = toNull(pick(row, ['cif', 'CIF']));
      const resolvedAgreementCode = toNull(
        pick(row, ['agreement_code', 'codigo_convenio', 'CODIGO CONVENIO', 'CODIGO CONVENIO ', 'CODIGO_CONVENIO'])
      );
      const contactName = toNull(pick(row, ['contact_name', 'PERSONA CONTACTO', 'contacto']));
      const companyEmail = extractEmail(
        pick(row, ['company_email', 'EMAIL', 'email', 'contact_email'])
      );
      const contactEmail = extractEmail(
        pick(row, ['contact_email', 'EMAIL', 'email', 'company_email'])
      );
      const companyPhone = normalizePhone(
        pick(row, ['company_phone', 'TELEFONO', 'telefono', 'phone', 'contact_phone'])
      );
      const contactPhone = normalizePhone(
        pick(row, ['contact_phone', 'TELEFONO', 'telefono', 'phone', 'company_phone'])
      );
      const contactDate = normalizeDate(
        pick(row, ['contact_date', 'FECHA DE CONTACTO CON EMPRESA', 'FECHA DE CONTACTO CON EMPRESA '])
      );
      const agreementSigned = normalizeAgreementSigned(
        pick(row, ['agreement_signed', 'FIRMADO CONVENIO (SI/NO)'])
      );
      const agreementDate = normalizeDate(
        pick(row, ['agreement_date', 'FECHA FIRMA CONVENIO'])
      );
      const requiredPosition = toNull(
        pick(row, ['required_position', 'PUESTO REQUIERE'])
      );
      const notes = toNull(
        pick(row, ['notes', 'OBSERVACIONES', 'OBSERVACIONES ', 'observaciones', 'location'])
      );
      const resolvedSectorId = await resolveSectorId(
        pick(row, ['sector_id']),
        pick(row, ['sector_name', 'sector', 'SECTOR'])
      );

      let existingId: number | null = null;
      if (companyIdFromCsv) {
        const [existingByIdRows] = await pool.query('SELECT id FROM companies WHERE id = ? LIMIT 1', [
          companyIdFromCsv,
        ]);
        const rowById = (existingByIdRows as any[])[0];
        existingId = rowById?.id ? Number(rowById.id) : null;
      }

      if (!existingId && fiscalName) {
        const [existingByFiscalRows] = await pool.query(
          `SELECT id
           FROM companies
           WHERE TRIM(fiscal_name) COLLATE utf8mb4_unicode_ci = TRIM(?) COLLATE utf8mb4_unicode_ci
           LIMIT 1`,
          [fiscalName]
        );
        const rowByFiscal = (existingByFiscalRows as any[])[0];
        existingId = rowByFiscal?.id ? Number(rowByFiscal.id) : null;
      }

      if (!existingId && resolvedCif) {
        const [existingByCifRows] = await pool.query(
          `SELECT id
           FROM companies
           WHERE TRIM(cif) COLLATE utf8mb4_unicode_ci = TRIM(?) COLLATE utf8mb4_unicode_ci
           LIMIT 1`,
          [resolvedCif]
        );
        const rowByCif = (existingByCifRows as any[])[0];
        existingId = rowByCif?.id ? Number(rowByCif.id) : null;
      }

      if (existingId) {
        await pool.query(
          `UPDATE companies
           SET
             cif = ?,
             name = ?,
             fiscal_name = ?,
             sector_id = ?,
             company_email = ?,
             company_phone = ?,
             contact_name = ?,
             contact_email = ?,
             contact_phone = ?,
             contact_date = ?,
             agreement_signed = ?,
             agreement_date = ?,
             agreement_code = ?,
             codigo_convenio = ?,
             required_position = ?,
             notes = ?
           WHERE id = ?`,
          [
            resolvedCif,
            companyName,
            fiscalName,
            resolvedSectorId,
            companyEmail,
            companyPhone,
            contactName,
            contactEmail,
            contactPhone,
            contactDate,
            agreementSigned,
            agreementDate,
            resolvedAgreementCode,
            resolvedAgreementCode,
            requiredPosition,
            notes,
            existingId,
          ]
        );
        updated += 1;
        continue;
      }

      if (companyIdFromCsv) {
        await pool.query(
          `INSERT INTO companies
           (id, cif, name, fiscal_name, sector_id, company_email, company_phone, contact_name, contact_email, contact_phone, contact_date, agreement_signed, agreement_date, agreement_code, codigo_convenio, required_position, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            companyIdFromCsv,
            resolvedCif,
            companyName,
            fiscalName,
            resolvedSectorId,
            companyEmail,
            companyPhone,
            contactName,
            contactEmail,
            contactPhone,
            contactDate,
            agreementSigned,
            agreementDate,
            resolvedAgreementCode,
            resolvedAgreementCode,
            requiredPosition,
            notes,
          ]
        );
      } else {
        await pool.query(
          `INSERT INTO companies
           (cif, name, fiscal_name, sector_id, company_email, company_phone, contact_name, contact_email, contact_phone, contact_date, agreement_signed, agreement_date, agreement_code, codigo_convenio, required_position, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            resolvedCif,
            companyName,
            fiscalName,
            resolvedSectorId,
            companyEmail,
            companyPhone,
            contactName,
            contactEmail,
            contactPhone,
            contactDate,
            agreementSigned,
            agreementDate,
            resolvedAgreementCode,
            resolvedAgreementCode,
            requiredPosition,
            notes,
          ]
        );
      }

      inserted += 1;
    }

    return res.json({ inserted, updated, skipped, total: rows.length });
  } catch (e) {
    if (isDuplicateEntryError(e)) {
      return res.status(409).json({ error: 'El nombre fiscal debe ser único' });
    }
    return res.status(500).json({ error: 'Error en importación', details: (e as Error).message });
  }
});

/**
 * PUT /:id - Actualizar una empresa
 */
router.put('/:id', async (req, res) => {
  const companyId = toPositiveInt(req.params.id);
  if (!companyId) {
    return res.status(400).json({ error: 'id inválido' });
  }

  const {
    cif,
    name,
    fiscal_name,
    sector_id,
    sector_name,
    sector,
    company_email,
    company_phone,
    contact_name,
    contact_email,
    contact_phone,
    contact_date,
    agreement_signed,
    agreement_date,
    agreement_code,
    codigo_convenio,
    required_position,
    has_complex_practice_centers,
    notes,
  } = req.body ?? {};

  const companyName = toNull(name);
  if (!companyName) {
    return res.status(400).json({ error: 'El nombre de la empresa es obligatorio' });
  }

  try {
    const resolvedSectorId = await resolveSectorId(sector_id, sector_name ?? sector);
    const resolvedCompanyEmail = extractEmail(company_email ?? contact_email);
    const resolvedContactEmail = extractEmail(contact_email ?? company_email);
    const resolvedCif = toNull(cif);
    const resolvedAgreementCode = toNull(codigo_convenio ?? agreement_code);
    const hasComplexPracticeCenters = toBool(has_complex_practice_centers);

    const query = `
      UPDATE companies
      SET
        cif = ?,
        name = ?,
        fiscal_name = ?,
        sector_id = ?,
        company_email = ?,
        company_phone = ?,
        contact_name = ?,
        contact_email = ?,
        contact_phone = ?,
        contact_date = ?,
        agreement_signed = ?,
        agreement_date = ?,
        agreement_code = ?,
        codigo_convenio = ?,
        required_position = ?,
        has_complex_practice_centers = ?,
        notes = ?
      WHERE id = ?
    `;

    await pool.query(query, [
      resolvedCif,
      companyName,
      toNull(fiscal_name),
      resolvedSectorId,
      resolvedCompanyEmail,
      normalizePhone(company_phone),
      toNull(contact_name),
      resolvedContactEmail,
      normalizePhone(contact_phone),
      normalizeDate(contact_date),
      normalizeAgreementSigned(agreement_signed),
      normalizeDate(agreement_date),
      resolvedAgreementCode,
      resolvedAgreementCode,
      toNull(required_position),
      hasComplexPracticeCenters ? 1 : 0,
      toNull(notes),
      companyId,
    ]);

    res.json({ message: 'Empresa actualizada con éxito' });
  } catch (e) {
    if (isDuplicateEntryError(e)) {
      return res.status(409).json({ error: 'El nombre fiscal debe ser único' });
    }
    res.status(500).json({ error: 'Error al actualizar empresa', details: (e as Error).message });
  }
});

/**
 * GET /:id/practice-centers - direcciones/centros de prácticas por empresa
 */
router.get('/:id/practice-centers', async (req, res) => {
  const companyId = toPositiveInt(req.params.id);
  if (!companyId) {
    return res.status(400).json({ error: 'id inválido' });
  }
  try {
    const company = await getCompanyMeta(companyId);
    if (!company) return res.status(404).json({ error: 'Empresa no encontrada' });
    const [rows] = await pool.query(
      `SELECT id, company_id, address, sector, center, created_at, updated_at
       FROM company_practice_centers
       WHERE company_id = ?
       ORDER BY id ASC`,
      [companyId]
    );
    return res.json(rows);
  } catch (e) {
    return res.status(500).json({ error: 'Error al consultar direcciones de prácticas', details: (e as Error).message });
  }
});

/**
 * POST /:id/practice-centers - crear dirección/centro de prácticas
 */
router.post('/:id/practice-centers', async (req, res) => {
  const companyId = toPositiveInt(req.params.id);
  if (!companyId) {
    return res.status(400).json({ error: 'id inválido' });
  }
  try {
    const company = await getCompanyMeta(companyId);
    if (!company) return res.status(404).json({ error: 'Empresa no encontrada' });

    const address = toNull(req.body?.address);
    const sectorValue = toNull(req.body?.sector);
    const centerValue = toNull(req.body?.center);

    if (company.hasComplexPracticeCenters) {
      if (!sectorValue || !centerValue || !address) {
        return res.status(400).json({ error: 'Sector, Centro y Dirección son obligatorios para estructura compleja' });
      }
    } else if (!address) {
      return res.status(400).json({ error: 'La dirección es obligatoria' });
    }

    const [result] = await pool.query<ResultSetHeader>(
      `INSERT INTO company_practice_centers (company_id, address, sector, center)
       VALUES (?, ?, ?, ?)`,
      [
        companyId,
        address,
        sectorValue,
        centerValue,
      ]
    );

    return res.status(201).json({ message: 'Dirección de prácticas creada', id: (result as ResultSetHeader).insertId });
  } catch (e) {
    return res.status(500).json({ error: 'Error al crear dirección de prácticas', details: (e as Error).message });
  }
});

/**
 * PUT /:id/practice-centers/:centerId - actualizar dirección/centro de prácticas
 */
router.put('/:id/practice-centers/:centerId', async (req, res) => {
  const companyId = toPositiveInt(req.params.id);
  const practiceCenterId = toPositiveInt(req.params.centerId);
  if (!companyId || !practiceCenterId) {
    return res.status(400).json({ error: 'id inválido' });
  }
  try {
    const company = await getCompanyMeta(companyId);
    if (!company) return res.status(404).json({ error: 'Empresa no encontrada' });

    const address = toNull(req.body?.address);
    const sectorValue = toNull(req.body?.sector);
    const centerValue = toNull(req.body?.center);

    if (company.hasComplexPracticeCenters) {
      if (!sectorValue || !centerValue || !address) {
        return res.status(400).json({ error: 'Sector, Centro y Dirección son obligatorios para estructura compleja' });
      }
    } else if (!address) {
      return res.status(400).json({ error: 'La dirección es obligatoria' });
    }

    const [result] = await pool.query<ResultSetHeader>(
      `UPDATE company_practice_centers
       SET
         address = ?,
         sector = ?,
         center = ?
       WHERE id = ? AND company_id = ?`,
      [
        address,
        sectorValue,
        centerValue,
        practiceCenterId,
        companyId,
      ]
    );

    if ((result as ResultSetHeader).affectedRows === 0) {
      return res.status(404).json({ error: 'Dirección de prácticas no encontrada' });
    }

    return res.json({ message: 'Dirección de prácticas actualizada' });
  } catch (e) {
    return res.status(500).json({ error: 'Error al actualizar dirección de prácticas', details: (e as Error).message });
  }
});

/**
 * DELETE /:id/practice-centers/:centerId - eliminar dirección/centro de prácticas
 */
router.delete('/:id/practice-centers/:centerId', async (req, res) => {
  const companyId = toPositiveInt(req.params.id);
  const practiceCenterId = toPositiveInt(req.params.centerId);
  if (!companyId || !practiceCenterId) {
    return res.status(400).json({ error: 'id inválido' });
  }
  try {
    const [result] = await pool.query<ResultSetHeader>(
      'DELETE FROM company_practice_centers WHERE id = ? AND company_id = ?',
      [practiceCenterId, companyId]
    );
    if ((result as ResultSetHeader).affectedRows === 0) {
      return res.status(404).json({ error: 'Dirección de prácticas no encontrada' });
    }
    return res.json({ message: 'Dirección de prácticas eliminada' });
  } catch (e) {
    return res.status(500).json({ error: 'Error al eliminar dirección de prácticas', details: (e as Error).message });
  }
});

/**
 * GET by id
 */
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await pool.query(`${COMPANY_SELECT} WHERE c.id = ?`, [req.params.id]);
    if ((rows as any[]).length === 0) return res.status(404).json({ error: 'Empresa no encontrada' });
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
    await pool.query('DELETE FROM companies WHERE id = ?', [req.params.id]);
    res.json({ message: 'Eliminado correctamente' });
  } catch (e) {
    res.status(500).json({ error: 'Error al eliminar', details: (e as Error).message });
  }
});

export default router;
