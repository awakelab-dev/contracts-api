import { Router } from 'express';
import { pool } from '../db/pool.js';

const router = Router();
type SexValue = 'mujer' | 'hombre' | 'other' | 'unknown';
type TicValue = 'SI' | 'NO';
type StatusLaboralValue = 'Buscando empleo' | 'Buscando mejorar empleo' | 'Sin buscar empleo' | null;

let ensureStudentsSchemaPromise: Promise<void> | null = null;

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

async function ensureStudentsSchema() {
  if (ensureStudentsSchemaPromise) {
    await ensureStudentsSchemaPromise;
    return;
  }

  ensureStudentsSchemaPromise = (async () => {
    await ensureColumn('students', 'tic', "VARCHAR(3) NOT NULL DEFAULT 'NO' AFTER email");
    await ensureColumn('students', 'status_laboral', 'VARCHAR(40) NULL AFTER tic');
    await ensureColumn(
      'course_itinerary_students',
      'effective_start_date',
      'DATE NULL AFTER dni_nie'
    );
  })();

  try {
    await ensureStudentsSchemaPromise;
  } catch (error) {
    ensureStudentsSchemaPromise = null;
    throw error;
  }
}

router.use(async (req, res, next) => {
  if (req.method === 'OPTIONS') {
    return next();
  }
  try {
    await ensureStudentsSchema();
    return next();
  } catch (e) {
    return res.status(500).json({ error: 'Error al preparar esquema de alumnos', details: (e as Error).message });
  }
});

type StudentPayload = {
  first_names: string;
  last_names: string;
  dni_nie: string;
  social_security_number: string | null;
  birth_date: string | null;
  sex: SexValue;
  district_code: number | null;
  municipality_code: number | null;
  district_name: string | null;
  municipality_name: string | null;
  phone: string | null;
  email: string | null;
  tic: TicValue;
  status_laboral: StatusLaboralValue;
  notes: string | null;
};

type DistrictRow = {
  code: number;
  municipality_code: number;
  name: string;
};

type MunicipalityRow = {
  code: number;
  name: string;
};

type LocationCatalog = {
  municipalitiesByCode: Map<number, MunicipalityRow>;
  municipalitiesByNameKey: Map<string, MunicipalityRow>;
  districtsByCode: Map<number, DistrictRow>;
  districtsByMunicipalityAndKey: Map<string, DistrictRow>;
  districtsByNameKey: Map<string, DistrictRow[]>;
  maxMunicipalityCode: number;
  maxDistrictCode: number;
};

const STUDENT_SELECT = `
  SELECT
    s.id,
    s.first_names,
    s.last_names,
    s.dni_nie,
    s.social_security_number,
    s.birth_date,
    s.sex,
    s.district_code,
    s.municipality_code,
    d.name AS district,
    m.name AS municipality,
    s.phone,
    s.email,
    COALESCE(s.tic, 'NO') AS tic,
    s.status_laboral,
    s.notes
  FROM students s
  LEFT JOIN districts d ON d.code = s.district_code
  LEFT JOIN municipalities m ON m.code = s.municipality_code
`;

const compactSpaces = (value: string) => value.replace(/\s+/g, ' ').trim();
const norm = (value: unknown) => compactSpaces((value ?? '').toString().replace(/\u00A0/g, ' '));
const toNull = (value: unknown) => {
  const cleaned = norm(value);
  return cleaned ? cleaned : null;
};
const normalizeCode = (value: unknown) => {
  const cleaned = norm(value);
  if (!cleaned) return null;
  if (!/^\d+$/.test(cleaned)) return null;
  const parsed = Number.parseInt(cleaned, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
};
const normalizeLocationKey = (value: string) =>
  compactSpaces(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

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

const normalizeTic = (value: unknown, fallback: TicValue = 'NO'): TicValue => {
  const cleaned = norm(value).toLowerCase();
  if (!cleaned) return fallback;
  if (['si', 'sí', 's', '1', 'true', 'yes'].includes(cleaned)) return 'SI';
  if (['no', 'n', '0', 'false'].includes(cleaned)) return 'NO';
  return fallback;
};

const normalizeStatusLaboral = (value: unknown): StatusLaboralValue => {
  const cleaned = norm(value);
  if (!cleaned) return null;
  const key = cleaned
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  if (key === 'buscando empleo') return 'Buscando empleo';
  if (key === 'buscando mejorar empleo') return 'Buscando mejorar empleo';
  if (key === 'sin buscar empleo') return 'Sin buscar empleo';
  return null;
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

const normalizeAsciiUpper = (value: unknown) =>
  norm(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();

const normalizeCourseCodeInput = (value: unknown) => normalizeAsciiUpper(value).replace(/\s+/g, '');

const normalizeExpedienteInput = (value: unknown) => normalizeAsciiUpper(value).replace(/\s+/g, '');

const normalizeOptionalDate = (value: unknown) => {
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
  return toIsoDate(year, month, day);
};

function normalizeCourseStatusInput(value: unknown): 'APTO' | 'NO APTO' | 'INSERCION' {
  const key = normalizeAsciiUpper(value).replace(/\s+/g, '');
  if (!key || key === 'APTO') return 'APTO';
  if (key === 'NOAPTO') return 'NO APTO';
  if (key === 'INSERCION') return 'INSERCION';
  throw new Error('course_status must be APTO, NO APTO or INSERCION');
}

function normalizeLeaveReasonInput(value: unknown) {
  const key = normalizeAsciiUpper(value).replace(/\s+/g, '');
  if (!key) return null;
  if (['ABANDONO', 'INSERCION', 'EXPULSION', 'ENFERMEDAD', 'OTROS'].includes(key)) return key;
  throw new Error('leave_reason inválido');
}

function normalizeLeaveNotificationInput(value: unknown) {
  const key = normalizeAsciiUpper(value).replace(/\s+/g, '');
  if (!key) return null;
  if (['NOTIFICADA', 'FIRMADA', 'EXPULSION'].includes(key)) return key;
  throw new Error('leave_notification inválido');
}

const isDuplicateEntryError = (error: unknown) =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { code?: string }).code === 'ER_DUP_ENTRY';

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
    sex: normalizeSex(
      pickValue(raw, ['sex', 'sexo', 'SEXO'])
    ),
    district_code: normalizeCode(
      pickValue(raw, ['district_code', 'codigo_distrito', 'DISTRICT_CODE'])
    ),
    municipality_code: normalizeCode(
      pickValue(raw, ['municipality_code', 'codigo_municipio', 'MUNICIPALITY_CODE'])
    ),
    district_name: toNull(
      pickValue(raw, ['district', 'distrito', 'DISTRITO'])
    ),
    municipality_name: toNull(
      pickValue(raw, ['municipality', 'municipio', 'MUNICIPIO COMUNIDAD DE MADRID'])
    ),
    phone: toNull(
      pickValue(raw, ['phone', 'telefono', 'teléfono', 'TLF CONTACTO'])
    ),
    email: normalizeEmail(
      pickValue(raw, ['email', 'correo', 'E-MAIL'])
    ),
    tic: normalizeTic(
      pickValue(raw, ['tic', 'TIC']),
      'NO'
    ),
    status_laboral: normalizeStatusLaboral(
      pickValue(raw, ['status_laboral', 'status laboral', 'STATUS LABORAL'])
    ),
    notes: toNull(
      pickValue(raw, ['notes', 'observaciones', 'OBSERVACIONES'])
    ),
  };
}

function districtMunicipalityKey(municipalityCode: number, districtName: string) {
  return `${municipalityCode}::${normalizeLocationKey(districtName)}`;
}

function registerMunicipality(catalog: LocationCatalog, municipality: MunicipalityRow) {
  catalog.municipalitiesByCode.set(municipality.code, municipality);
  catalog.municipalitiesByNameKey.set(normalizeLocationKey(municipality.name), municipality);
  catalog.maxMunicipalityCode = Math.max(catalog.maxMunicipalityCode, municipality.code);
}

function registerDistrict(catalog: LocationCatalog, district: DistrictRow) {
  catalog.districtsByCode.set(district.code, district);
  catalog.districtsByMunicipalityAndKey.set(
    districtMunicipalityKey(district.municipality_code, district.name),
    district
  );
  const nameKey = normalizeLocationKey(district.name);
  const list = catalog.districtsByNameKey.get(nameKey) ?? [];
  list.push(district);
  catalog.districtsByNameKey.set(nameKey, list);
  catalog.maxDistrictCode = Math.max(catalog.maxDistrictCode, district.code);
}

function nextMunicipalityCode(catalog: LocationCatalog) {
  catalog.maxMunicipalityCode += 1;
  return catalog.maxMunicipalityCode;
}

function nextDistrictCode(catalog: LocationCatalog) {
  catalog.maxDistrictCode += 1;
  return catalog.maxDistrictCode;
}

async function loadLocationCatalog(): Promise<LocationCatalog> {
  const [municipalityRowsRaw] = await pool.query('SELECT code, name FROM municipalities ORDER BY code ASC');
  const [districtRowsRaw] = await pool.query(
    'SELECT code, municipality_code, name FROM districts ORDER BY code ASC'
  );

  const catalog: LocationCatalog = {
    municipalitiesByCode: new Map<number, MunicipalityRow>(),
    municipalitiesByNameKey: new Map<string, MunicipalityRow>(),
    districtsByCode: new Map<number, DistrictRow>(),
    districtsByMunicipalityAndKey: new Map<string, DistrictRow>(),
    districtsByNameKey: new Map<string, DistrictRow[]>(),
    maxMunicipalityCode: 0,
    maxDistrictCode: 0,
  };

  for (const row of municipalityRowsRaw as MunicipalityRow[]) {
    registerMunicipality(catalog, row);
  }

  for (const row of districtRowsRaw as DistrictRow[]) {
    registerDistrict(catalog, row);
  }

  return catalog;
}

async function insertMunicipalities(rows: MunicipalityRow[]) {
  if (!rows.length) return;
  const placeholders = rows.map(() => '(?, ?)').join(',');
  await pool.query(
    `INSERT INTO municipalities (code, name) VALUES ${placeholders}
     ON DUPLICATE KEY UPDATE name = VALUES(name)`,
    rows.flatMap((r) => [r.code, r.name])
  );
}

async function insertDistricts(rows: DistrictRow[]) {
  if (!rows.length) return;
  const placeholders = rows.map(() => '(?, ?, ?)').join(',');
  await pool.query(
    `INSERT INTO districts (code, municipality_code, name) VALUES ${placeholders}
     ON DUPLICATE KEY UPDATE municipality_code = VALUES(municipality_code), name = VALUES(name)`,
    rows.flatMap((r) => [r.code, r.municipality_code, r.name])
  );
}

async function hydrateLocationCodes(rows: StudentPayload[], allowCreate: boolean) {
  if (!rows.length) return;

  const catalog = await loadLocationCatalog();
  const newMunicipalities: MunicipalityRow[] = [];
  const newDistricts: DistrictRow[] = [];

  for (const row of rows) {
    let municipalityCode = row.municipality_code;
    let districtCode = row.district_code;
    const municipalityName = row.municipality_name ? compactSpaces(row.municipality_name) : null;
    const districtName = row.district_name ? compactSpaces(row.district_name) : null;

    if (municipalityCode) {
      const existing = catalog.municipalitiesByCode.get(municipalityCode);
      if (existing) {
        if (
          municipalityName &&
          normalizeLocationKey(existing.name) !== normalizeLocationKey(municipalityName)
        ) {
          throw new Error('El código de municipio no coincide con el nombre indicado');
        }
      } else {
        if (!allowCreate || !municipalityName) {
          throw new Error(`Municipio no válido: ${municipalityCode}`);
        }
        const byName = catalog.municipalitiesByNameKey.get(normalizeLocationKey(municipalityName));
        if (byName) {
          municipalityCode = byName.code;
        } else {
          const created: MunicipalityRow = { code: municipalityCode, name: municipalityName };
          registerMunicipality(catalog, created);
          newMunicipalities.push(created);
        }
      }
    } else if (municipalityName) {
      const existing = catalog.municipalitiesByNameKey.get(normalizeLocationKey(municipalityName));
      if (existing) {
        municipalityCode = existing.code;
      } else {
        if (!allowCreate) {
          throw new Error(`Municipio no encontrado: ${municipalityName}`);
        }
        municipalityCode = nextMunicipalityCode(catalog);
        const created: MunicipalityRow = { code: municipalityCode, name: municipalityName };
        registerMunicipality(catalog, created);
        newMunicipalities.push(created);
      }
    }

    if (districtCode) {
      const existing = catalog.districtsByCode.get(districtCode);
      if (existing) {
        if (
          districtName &&
          normalizeLocationKey(existing.name) !== normalizeLocationKey(districtName)
        ) {
          throw new Error('El código de distrito no coincide con el nombre indicado');
        }
        if (municipalityCode && existing.municipality_code !== municipalityCode) {
          throw new Error('El distrito no pertenece al municipio seleccionado');
        }
        municipalityCode = municipalityCode ?? existing.municipality_code;
      } else {
        if (!allowCreate || !districtName || !municipalityCode) {
          throw new Error(`Distrito no válido: ${districtCode}`);
        }
        const existingByPair = catalog.districtsByMunicipalityAndKey.get(
          districtMunicipalityKey(municipalityCode, districtName)
        );
        if (existingByPair) {
          districtCode = existingByPair.code;
        } else {
          const created: DistrictRow = {
            code: districtCode,
            municipality_code: municipalityCode,
            name: districtName,
          };
          registerDistrict(catalog, created);
          newDistricts.push(created);
        }
      }
    } else if (districtName) {
      if (!municipalityCode) {
        const candidates = catalog.districtsByNameKey.get(normalizeLocationKey(districtName)) ?? [];
        const [candidate] = candidates;
        if (candidates.length === 1 && candidate) {
          districtCode = candidate.code;
          municipalityCode = candidate.municipality_code;
        } else if (!allowCreate) {
          throw new Error(`Distrito no encontrado o ambiguo: ${districtName}`);
        } else {
          throw new Error(`No se puede crear distrito sin municipio: ${districtName}`);
        }
      }

      if (municipalityCode && !districtCode) {
        const existing = catalog.districtsByMunicipalityAndKey.get(
          districtMunicipalityKey(municipalityCode, districtName)
        );
        if (existing) {
          districtCode = existing.code;
        } else {
          if (!allowCreate) {
            throw new Error(`Distrito no encontrado: ${districtName}`);
          }
          districtCode = nextDistrictCode(catalog);
          const created: DistrictRow = {
            code: districtCode,
            municipality_code: municipalityCode,
            name: districtName,
          };
          registerDistrict(catalog, created);
          newDistricts.push(created);
        }
      }
    }

    if (districtCode) {
      const district = catalog.districtsByCode.get(districtCode);
      if (!district) {
        throw new Error(`Distrito no válido: ${districtCode}`);
      }
      if (municipalityCode && district.municipality_code !== municipalityCode) {
        throw new Error('El distrito no pertenece al municipio seleccionado');
      }
      municipalityCode = municipalityCode ?? district.municipality_code;
    }

    if (municipalityCode && !catalog.municipalitiesByCode.has(municipalityCode)) {
      throw new Error(`Municipio no válido: ${municipalityCode}`);
    }

    row.district_code = districtCode;
    row.municipality_code = municipalityCode;
  }

  await insertMunicipalities(newMunicipalities);
  await insertDistricts(newDistricts);
}

router.post('/import', async (req, res) => {
  const rawRows = req.body?.rows;
  if (!Array.isArray(rawRows) || rawRows.length === 0) {
    return res.status(400).json({ error: 'rows must be a non-empty array' });
  }

  const byDocument = new Map<string, StudentPayload>();
  for (const row of rawRows as Record<string, unknown>[]) {
    const normalized = normalizeStudentInput(row);
    const isValid = !!normalized.first_names && !!normalized.last_names && !!normalized.dni_nie;
    if (!isValid) continue;
    byDocument.set(normalized.dni_nie, normalized);
  }

  const validRows = Array.from(byDocument.values());
  if (validRows.length === 0) {
    return res.status(400).json({ error: 'no valid rows' });
  }

  try {
    await hydrateLocationCodes(validRows, true);

    const dniValues = validRows.map((r) => r.dni_nie);
    const dniPlaceholders = dniValues.map(() => '?').join(',');

    const [existingRows] = await pool.query(
      `SELECT dni_nie FROM students WHERE dni_nie IN (${dniPlaceholders})`,
      dniValues
    );

    const existingDni = new Set<string>();
    for (const row of existingRows as Array<{ dni_nie: string }>) {
      existingDni.add(row.dni_nie);
    }

    const inserted = validRows.filter((r) => !existingDni.has(r.dni_nie)).length;
    const updated = validRows.length - inserted;

    const placeholders = validRows.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(',');
    const sql = `
      INSERT INTO students
      (
        first_names,
        last_names,
        dni_nie,
        social_security_number,
        birth_date,
        sex,
        district_code,
        municipality_code,
        phone,
        email,
        tic,
        status_laboral,
        notes
      )
      VALUES ${placeholders}
      ON DUPLICATE KEY UPDATE
        first_names = VALUES(first_names),
        last_names = VALUES(last_names),
        social_security_number = VALUES(social_security_number),
        birth_date = VALUES(birth_date),
        sex = VALUES(sex),
        district_code = VALUES(district_code),
        municipality_code = VALUES(municipality_code),
        phone = VALUES(phone),
        email = VALUES(email),
        tic = VALUES(tic),
        status_laboral = VALUES(status_laboral),
        notes = VALUES(notes)
    `;

    await pool.query(
      sql,
      validRows.flatMap((r) => [
        r.first_names,
        r.last_names,
        r.dni_nie,
        r.social_security_number,
        r.birth_date,
        r.sex,
        r.district_code,
        r.municipality_code,
        r.phone,
        r.email,
        r.tic,
        r.status_laboral,
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

router.post('/', async (req, res) => {
  const payload = normalizeStudentInput(req.body ?? {});
  if (!payload.first_names || !payload.last_names || !payload.dni_nie) {
    return res.status(400).json({
      error: 'Nombres, apellidos y DNI/NIE/Pasaporte son obligatorios',
    });
  }

  try {
    await hydrateLocationCodes([payload], true);

    const query = `
      INSERT INTO students
      (
        first_names,
        last_names,
        dni_nie,
        social_security_number,
        birth_date,
        sex,
        district_code,
        municipality_code,
        phone,
        email,
        tic,
        status_laboral,
        notes
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const [result] = await pool.query(query, [
      payload.first_names,
      payload.last_names,
      payload.dni_nie,
      payload.social_security_number,
      payload.birth_date,
      payload.sex,
      payload.district_code,
      payload.municipality_code,
      payload.phone,
      payload.email,
      payload.tic,
      payload.status_laboral,
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

router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const payload = normalizeStudentInput(req.body ?? {});

  if (!payload.first_names || !payload.last_names || !payload.dni_nie) {
    return res.status(400).json({
      error: 'Nombres, apellidos y DNI/NIE/Pasaporte son obligatorios',
    });
  }

  try {
    await hydrateLocationCodes([payload], true);

    const query = `
      UPDATE students
      SET
        first_names = ?,
        last_names = ?,
        dni_nie = ?,
        social_security_number = ?,
        birth_date = ?,
        sex = ?,
        district_code = ?,
        municipality_code = ?,
        phone = ?,
        email = ?,
        tic = ?,
        status_laboral = ?,
        notes = ?
      WHERE id = ?
    `;

    await pool.query(query, [
      payload.first_names,
      payload.last_names,
      payload.dni_nie,
      payload.social_security_number,
      payload.birth_date,
      payload.sex,
      payload.district_code,
      payload.municipality_code,
      payload.phone,
      payload.email,
      payload.tic,
      payload.status_laboral,
      payload.notes,
      id,
    ]);

    return res.json({ message: 'Alumno actualizado con éxito' });
  } catch (e) {
    return res.status(500).json({ error: 'Error al actualizar alumno', details: (e as Error).message });
  }
});

router.get('/', async (_req, res) => {
  try {
    const [rows] = await pool.query(`${STUDENT_SELECT} ORDER BY s.last_names ASC, s.first_names ASC, s.id DESC`);
    return res.json(rows);
  } catch (e) {
    return res.status(500).json({ error: 'Error al consultar alumnos', details: (e as Error).message });
  }
});

router.get('/:id/enrolled-courses', async (req, res) => {
  const studentId = Number(req.params.id);
  if (!Number.isFinite(studentId)) {
    return res.status(400).json({ error: 'id must be a number' });
  }

  try {
    const [studentRows] = await pool.query('SELECT dni_nie FROM students WHERE id = ?', [studentId]);
    const student = (studentRows as Array<{ dni_nie: string }>)[0];
    if (!student) {
      return res.status(404).json({ error: 'No encontrado' });
    }

    const [rows] = await pool.query(
      `
        SELECT
          cis.expediente,
          cis.course_code,
          cis.dni_nie,
          cis.effective_start_date,
          cis.leave_date,
          cis.leave_reason,
          cis.leave_notification,
          cis.course_status,
          ci.itinerary_name,
          ci.formation_start_date,
          ci.formation_end_date,
          ci.formation_schedule,
          ci.company,
          ci.teacher
        FROM course_itinerary_students cis
        INNER JOIN course_itineraries ci ON ci.course_code = cis.course_code
        WHERE cis.dni_nie = ?
        ORDER BY cis.course_code ASC, cis.expediente ASC
      `,
      [student.dni_nie]
    );

    return res.json(rows);
  } catch (e) {
    return res.status(500).json({ error: 'Error', details: (e as Error).message });
  }
});

async function getStudentById(studentId: number): Promise<{ dni_nie: string } | null> {
  const [studentRows] = await pool.query('SELECT dni_nie FROM students WHERE id = ?', [studentId]);
  const student = (studentRows as Array<{ dni_nie: string }>)[0];
  return student ?? null;
}

async function getCourseItineraryMeta(courseCode: string): Promise<{ course_code: string; formation_start_date: unknown } | null> {
  const [rows] = await pool.query(
    `SELECT course_code, formation_start_date
     FROM course_itineraries
     WHERE course_code = ?
     LIMIT 1`,
    [courseCode]
  );
  const itinerary = (rows as Array<{ course_code: string; formation_start_date: unknown }>)[0];
  return itinerary ?? null;
}

function normalizeStoredDate(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const cleaned = norm(value);
  if (!cleaned) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) return cleaned;
  return normalizeOptionalDate(cleaned);
}

router.post('/:id/enrolled-courses', async (req, res) => {
  const studentId = Number(req.params.id);
  if (!Number.isFinite(studentId)) {
    return res.status(400).json({ error: 'id must be a number' });
  }

  const expediente = normalizeExpedienteInput(req.body?.expediente);
  const courseCode = normalizeCourseCodeInput(req.body?.course_code);
  if (!expediente || !courseCode) {
    return res.status(400).json({ error: 'course_code y expediente son obligatorios' });
  }

  let courseStatus: 'APTO' | 'NO APTO' | 'INSERCION';
  let leaveDate: string | null = null;
  let leaveReason: string | null = null;
  let leaveNotification: string | null = null;
  let effectiveStartDate: string | null = null;

  try {
    courseStatus = normalizeCourseStatusInput(req.body?.course_status);
    leaveDate = normalizeOptionalDate(req.body?.leave_date);
    leaveReason = normalizeLeaveReasonInput(req.body?.leave_reason);
    leaveNotification = normalizeLeaveNotificationInput(req.body?.leave_notification);
    effectiveStartDate = normalizeOptionalDate(req.body?.effective_start_date);
  } catch (e) {
    return res.status(400).json({ error: (e as Error).message });
  }

  if (courseStatus === 'APTO') {
    leaveDate = null;
    leaveReason = null;
    leaveNotification = null;
  }

  try {
    const student = await getStudentById(studentId);
    if (!student) {
      return res.status(404).json({ error: 'No encontrado' });
    }

    const courseItinerary = await getCourseItineraryMeta(courseCode);
    if (!courseItinerary) {
      return res.status(400).json({ error: 'course_code no existe en itinerarios' });
    }

    const fallbackEffectiveStartDate = normalizeStoredDate(courseItinerary.formation_start_date);
    const resolvedEffectiveStartDate = effectiveStartDate ?? fallbackEffectiveStartDate;

    await pool.query(
      `INSERT INTO course_itinerary_students
       (course_code, expediente, dni_nie, effective_start_date, leave_date, leave_reason, leave_notification, course_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        courseCode,
        expediente,
        student.dni_nie,
        resolvedEffectiveStartDate,
        leaveDate,
        leaveReason,
        leaveNotification,
        courseStatus,
      ]
    );

    return res.status(201).json({ message: 'Itinerario creado' });
  } catch (e) {
    if (isDuplicateEntryError(e)) {
      return res.status(409).json({ error: 'Ya existe un itinerario con ese expediente' });
    }
    return res.status(500).json({ error: 'Error', details: (e as Error).message });
  }
});

router.put('/:id/enrolled-courses/:expediente', async (req, res) => {
  const studentId = Number(req.params.id);
  if (!Number.isFinite(studentId)) {
    return res.status(400).json({ error: 'id must be a number' });
  }

  const currentExpediente = normalizeExpedienteInput(req.params.expediente);
  if (!currentExpediente) {
    return res.status(400).json({ error: 'expediente is required' });
  }

  let courseStatus: 'APTO' | 'NO APTO' | 'INSERCION';
  let leaveDate: string | null = null;
  let leaveReason: string | null = null;
  let leaveNotification: string | null = null;

  try {
    courseStatus = normalizeCourseStatusInput(req.body?.course_status);
    leaveDate = normalizeOptionalDate(req.body?.leave_date);
    leaveReason = normalizeLeaveReasonInput(req.body?.leave_reason);
    leaveNotification = normalizeLeaveNotificationInput(req.body?.leave_notification);
  } catch (e) {
    return res.status(400).json({ error: (e as Error).message });
  }

  if (courseStatus === 'APTO') {
    leaveDate = null;
    leaveReason = null;
    leaveNotification = null;
  }

  try {
    const student = await getStudentById(studentId);
    if (!student) {
      return res.status(404).json({ error: 'No encontrado' });
    }

    const [existingRows] = await pool.query(
      `SELECT expediente, course_code, effective_start_date
       FROM course_itinerary_students
       WHERE dni_nie = ? AND expediente = ?
       LIMIT 1`,
      [student.dni_nie, currentExpediente]
    );
    const existing = (existingRows as Array<{ expediente: string; course_code: string; effective_start_date: unknown }>)[0];
    if (!existing) {
      return res.status(404).json({ error: 'Itinerario no encontrado para este alumno' });
    }

    const nextExpediente = normalizeExpedienteInput(req.body?.expediente ?? currentExpediente);
    const requestedCourseCode = normalizeCourseCodeInput(req.body?.course_code);
    const nextCourseCode = requestedCourseCode || normalizeCourseCodeInput(existing.course_code);

    if (!nextExpediente || !nextCourseCode) {
      return res.status(400).json({ error: 'course_code y expediente son obligatorios' });
    }

    const courseItinerary = await getCourseItineraryMeta(nextCourseCode);
    if (!courseItinerary) {
      return res.status(400).json({ error: 'course_code no existe en itinerarios' });
    }

    const hasEffectiveStartDateInBody =
      req.body != null && Object.prototype.hasOwnProperty.call(req.body, 'effective_start_date');
    const effectiveStartDateFromBody = hasEffectiveStartDateInBody
      ? normalizeOptionalDate(req.body?.effective_start_date)
      : null;
    const fallbackEffectiveStartDate =
      normalizeStoredDate(existing.effective_start_date) ??
      normalizeStoredDate(courseItinerary.formation_start_date);
    const resolvedEffectiveStartDate = hasEffectiveStartDateInBody
      ? effectiveStartDateFromBody
      : fallbackEffectiveStartDate;

    const [result] = await pool.query(
      `UPDATE course_itinerary_students
       SET
         expediente = ?,
         course_code = ?,
         effective_start_date = ?,
         course_status = ?,
         leave_date = ?,
         leave_reason = ?,
         leave_notification = ?
       WHERE dni_nie = ? AND expediente = ?`,
      [
        nextExpediente,
        nextCourseCode,
        resolvedEffectiveStartDate,
        courseStatus,
        leaveDate,
        leaveReason,
        leaveNotification,
        student.dni_nie,
        currentExpediente,
      ]
    );

    if ((result as any).affectedRows === 0) {
      return res.status(404).json({ error: 'Itinerario no encontrado para este alumno' });
    }

    return res.json({ message: 'Itinerario actualizado' });
  } catch (e) {
    if (isDuplicateEntryError(e)) {
      return res.status(409).json({ error: 'Ya existe un itinerario con ese expediente' });
    }
    return res.status(500).json({ error: 'Error', details: (e as Error).message });
  }
});

router.delete('/:id/enrolled-courses/:expediente', async (req, res) => {
  const studentId = Number(req.params.id);
  if (!Number.isFinite(studentId)) {
    return res.status(400).json({ error: 'id must be a number' });
  }

  const expediente = normalizeExpedienteInput(req.params.expediente);
  if (!expediente) {
    return res.status(400).json({ error: 'expediente is required' });
  }

  try {
    const student = await getStudentById(studentId);
    if (!student) {
      return res.status(404).json({ error: 'No encontrado' });
    }

    const [result] = await pool.query(
      `DELETE FROM course_itinerary_students
       WHERE dni_nie = ? AND expediente = ?`,
      [student.dni_nie, expediente]
    );

    if ((result as any).affectedRows === 0) {
      return res.status(404).json({ error: 'Itinerario no encontrado para este alumno' });
    }

    return res.json({ message: 'Itinerario eliminado' });
  } catch (e) {
    return res.status(500).json({ error: 'Error', details: (e as Error).message });
  }
});
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await pool.query(`${STUDENT_SELECT} WHERE s.id = ?`, [req.params.id]);
    if ((rows as any[]).length === 0) return res.status(404).json({ error: 'No encontrado' });
    return res.json((rows as any[])[0]);
  } catch (e) {
    return res.status(500).json({ error: 'Error', details: (e as Error).message });
  }
});

router.delete('/:id', async (req, res) => {
  const studentId = Number(req.params.id);
  if (!Number.isFinite(studentId)) {
    return res.status(400).json({ error: 'id must be a number' });
  }
  try {
    const [studentRows] = await pool.query(
      'SELECT id, dni_nie FROM students WHERE id = ? LIMIT 1',
      [studentId]
    );
    const student = (studentRows as Array<{ id: number; dni_nie: string }>)[0];
    if (!student) {
      return res.status(404).json({ error: 'No encontrado' });
    }

    const [associatedRows] = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM invitations WHERE student_id = ?) AS invitations_count,
         (SELECT COUNT(*) FROM interviews WHERE student_id = ?) AS interviews_count,
         (SELECT COUNT(*) FROM course_itinerary_students WHERE dni_nie = ?) AS courses_count,
         (
           SELECT COUNT(*)
           FROM practices p
           INNER JOIN course_itinerary_students cis ON cis.expediente = p.expediente
           WHERE cis.dni_nie = ?
         ) AS practices_count,
         (
           SELECT COUNT(*)
           FROM employment_contracts ec
           INNER JOIN course_itinerary_students cis ON cis.expediente = ec.expediente
           WHERE cis.dni_nie = ?
         ) AS contracts_count`,
      [student.id, student.id, student.dni_nie, student.dni_nie, student.dni_nie]
    );

    const counts = (associatedRows as Array<{
      invitations_count: number;
      interviews_count: number;
      courses_count: number;
      practices_count: number;
      contracts_count: number;
    }>)[0];

    const hasAssociatedData =
      Number(counts?.invitations_count || 0) > 0 ||
      Number(counts?.interviews_count || 0) > 0 ||
      Number(counts?.courses_count || 0) > 0 ||
      Number(counts?.practices_count || 0) > 0 ||
      Number(counts?.contracts_count || 0) > 0;

    if (hasAssociatedData) {
      return res.status(409).json({
        error:
          'No se puede eliminar el alumno porque tiene datos asociados. Elimina manualmente invitaciones, entrevistas, cursos, prácticas y contrataciones primero.',
        associated_data: {
          invitations: Number(counts?.invitations_count || 0),
          interviews: Number(counts?.interviews_count || 0),
          enrolled_courses: Number(counts?.courses_count || 0),
          practices: Number(counts?.practices_count || 0),
          contracts: Number(counts?.contracts_count || 0),
        },
      });
    }

    await pool.query('DELETE FROM students WHERE id = ?', [studentId]);
    return res.json({ message: 'Eliminado correctamente' });
  } catch (e) {
    return res.status(500).json({ error: 'Error al eliminar', details: (e as Error).message });
  }
});

export default router;
