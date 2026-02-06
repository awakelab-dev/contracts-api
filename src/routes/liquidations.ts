import { Router } from 'express';
import { pool } from '../db/pool';
import { requireAuth } from '../middleware/auth';

const router = Router();
router.use(requireAuth);

type Target = 'six_months' | 'one_year';
type Mode = 'individual' | 'pooled';

const FULL_TIME_HOURS_PER_WEEK = 40;
const TARGET_FTE_DAYS: Record<Target, number> = {
  // Basado en 5 días/semana. 1 año = 52*5 = 260. 6 meses = 26*5 = 130.
  six_months: 130,
  one_year: 260,
};

function norm(v: any) {
  return (v ?? '').toString().trim();
}

function parseISODateUTC(s: string): Date | null {
  const m = /^\d{4}-\d{2}-\d{2}$/.exec(s);
  if (!m) return null;

  const parts = s.split('-');
  const y = Number(parts[0]);
  const mo = Number(parts[1]);
  const d = Number(parts[2]);

  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  return new Date(Date.UTC(y, mo - 1, d));
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDaysUTC(d: Date, days: number): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  x.setUTCDate(x.getUTCDate() + days);
  return x;
}

function daysBetweenInclusive(a: Date, b: Date): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  const start = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate());
  const end = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate());
  return Math.floor((end - start) / msPerDay) + 1;
}

function maxDate(a: Date, b: Date): Date {
  return a.getTime() >= b.getTime() ? a : b;
}

function minDate(a: Date, b: Date): Date {
  return a.getTime() <= b.getTime() ? a : b;
}

function parsePct(v: any): number | null {
  const s = norm(v);
  if (!s) return null;
  const m = /^([0-9]+(?:\.[0-9]+)?)\s*%$/.exec(s);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  return n / 100;
}

function fullTimeFactor(workday_pct: any, weekly_hours: any): number {
  const wh = Number(weekly_hours);
  if (Number.isFinite(wh) && wh > 0) {
    return Math.max(0, Math.min(1, wh / FULL_TIME_HOURS_PER_WEEK));
  }

  const pct = parsePct(workday_pct);
  if (pct != null) return Math.max(0, Math.min(1, pct));

  const wd = norm(workday_pct).toLowerCase();
  if (!wd) return 1;
  if (wd === 'tiempo completo') return 1;
  if (wd === 'tiempo parcial') return 0.5;
  // Asumimos 1 por defecto: el valor real depende de horas/semana.
  if (wd === 'fijo discontínuo' || wd === 'fijo discontinuo') return 1;
  return 1;
}

function valueToISODateString(v: any): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v);
  return s.length >= 10 ? s.slice(0, 10) : null;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

async function getBalancesByStudentId(conn: any, studentIds?: number[]) {
  if (studentIds && studentIds.length) {
    const placeholders = studentIds.map(() => '?').join(',');
    const [rows] = await conn.query(
      `SELECT student_id, fte_days_balance FROM student_liquidation_balances WHERE student_id IN (${placeholders})`,
      studentIds
    );
    const map = new Map<number, number>();
    (rows as any[]).forEach((r) => map.set(Number(r.student_id), Number(r.fte_days_balance) || 0));
    return map;
  }

  const [rows] = await conn.query('SELECT student_id, fte_days_balance FROM student_liquidation_balances');
  const map = new Map<number, number>();
  (rows as any[]).forEach((r) => map.set(Number(r.student_id), Number(r.fte_days_balance) || 0));
  return map;
}

async function computeAddedFteDaysByStudentId(conn: any, start: Date, end: Date, studentIds?: number[]) {
  const startIso = toISODate(start);
  const endIso = toISODate(end);

  const params: any[] = [endIso, startIso];
  let studentFilterSql = '';
  if (studentIds && studentIds.length) {
    const placeholders = studentIds.map(() => '?').join(',');
    studentFilterSql = ` AND hc.student_id IN (${placeholders}) `;
    params.push(...studentIds);
  }

  const [rows] = await conn.query(
    `
      SELECT
        hc.id,
        hc.student_id,
        hc.start_date,
        hc.end_date,
        hc.weekly_hours,
        hc.workday_pct,
        hc.contributed_days,
        s.first_names,
        s.last_names
      FROM hiring_contracts hc
      JOIN students s ON s.id = hc.student_id
      WHERE
        hc.contributed_days IS NOT NULL
        AND hc.contributed_days > 0
        AND hc.start_date <= ?
        AND (hc.end_date IS NULL OR hc.end_date >= ?)
        ${studentFilterSql}
    `,
    params
  );

  const students = new Map<number, { student_id: number; first_names: string; last_names: string }>();
  const added = new Map<number, number>();

  for (const r of rows as any[]) {
    const student_id = Number(r.student_id);
    if (!Number.isFinite(student_id)) continue;

    students.set(student_id, {
      student_id,
      first_names: norm(r.first_names),
      last_names: norm(r.last_names),
    });

    const contributed_days = Number(r.contributed_days);
    if (!Number.isFinite(contributed_days) || contributed_days <= 0) continue;

    const startStr = valueToISODateString(r.start_date) || valueToISODateString(norm(r.start_date));
    const contractStart = startStr ? parseISODateUTC(startStr) : null;
    if (!contractStart) continue;

    const endStr = r.end_date ? valueToISODateString(r.end_date) || valueToISODateString(norm(r.end_date)) : null;
    const contractEnd = endStr ? parseISODateUTC(endStr) : end;
    if (!contractEnd) continue;

    if (contractEnd.getTime() < contractStart.getTime()) continue;

    const duration = daysBetweenInclusive(contractStart, contractEnd);
    if (duration <= 0) continue;

    const overlapStart = maxDate(contractStart, start);
    const overlapEnd = minDate(contractEnd, end);
    if (overlapEnd.getTime() < overlapStart.getTime()) continue;

    const overlapDays = daysBetweenInclusive(overlapStart, overlapEnd);
    const fraction = overlapDays / duration;

    const factor = fullTimeFactor(r.workday_pct, r.weekly_hours);
    const fteTotal = contributed_days * factor;
    const fteInRange = fteTotal * fraction;

    const prev = added.get(student_id) || 0;
    added.set(student_id, prev + fteInRange);
  }

  // redondeamos al final para evitar errores acumulados en UI
  const addedRounded = new Map<number, number>();
  for (const [sid, v] of added.entries()) {
    addedRounded.set(sid, round2(v));
  }

  return { students, added: addedRounded };
}

async function computeEligibleFromByStudentId(conn: any, minStart: Date | null, end: Date, studentIds?: number[]) {
  const endIso = toISODate(end);
  const lowerIso = toISODate(minStart || new Date(Date.UTC(1970, 0, 1)));

  const params: any[] = [endIso, lowerIso];
  let studentFilterSql = '';
  if (studentIds && studentIds.length) {
    const placeholders = studentIds.map(() => '?').join(',');
    studentFilterSql = ` AND hc.student_id IN (${placeholders}) `;
    params.push(...studentIds);
  }

  const [rows] = await conn.query(
    `
      SELECT
        hc.student_id,
        hc.start_date,
        hc.end_date
      FROM hiring_contracts hc
      WHERE
        hc.contributed_days IS NOT NULL
        AND hc.contributed_days > 0
        AND hc.start_date <= ?
        AND (hc.end_date IS NULL OR hc.end_date >= ?)
        ${studentFilterSql}
    `,
    params
  );

  const eligibleFrom = new Map<number, Date>();
  for (const r of rows as any[]) {
    const student_id = Number(r.student_id);
    if (!Number.isFinite(student_id)) continue;

    const startStr = valueToISODateString(r.start_date) || valueToISODateString(norm(r.start_date));
    const contractStart = startStr ? parseISODateUTC(startStr) : null;
    if (!contractStart) continue;

    const endStr = r.end_date ? valueToISODateString(r.end_date) || valueToISODateString(norm(r.end_date)) : null;
    const contractEnd = endStr ? parseISODateUTC(endStr) : end;
    if (!contractEnd) continue;

    if (contractEnd.getTime() < contractStart.getTime()) continue;
    if (minStart && contractEnd.getTime() < minStart.getTime()) continue;

    const firstEligible = minStart ? maxDate(contractStart, minStart) : contractStart;
    const prev = eligibleFrom.get(student_id);
    if (!prev || firstEligible.getTime() < prev.getTime()) {
      eligibleFrom.set(student_id, firstEligible);
    }
  }

  let minEligible: Date | null = null;
  for (const d of eligibleFrom.values()) {
    if (!minEligible || d.getTime() < minEligible.getTime()) minEligible = d;
  }

  const eligibleFromIso = new Map<number, string>();
  for (const [sid, d] of eligibleFrom.entries()) {
    eligibleFromIso.set(sid, toISODate(d));
  }

  return { eligibleFromByStudentId: eligibleFromIso, minEligibleDate: minEligible ? toISODate(minEligible) : null };
}

async function getStudentNames(conn: any, studentIds: number[]) {
  if (!studentIds.length) return new Map<number, { first_names: string; last_names: string }>();
  const placeholders = studentIds.map(() => '?').join(',');
  const [rows] = await conn.query(
    `SELECT id, first_names, last_names FROM students WHERE id IN (${placeholders})`,
    studentIds
  );
  const map = new Map<number, { first_names: string; last_names: string }>();
  (rows as any[]).forEach((r) => {
    const id = Number(r.id);
    if (!Number.isFinite(id)) return;
    map.set(id, { first_names: norm(r.first_names), last_names: norm(r.last_names) });
  });
  return map;
}

function parseStudentIdsParam(v: any): number[] {
  const s = norm(v);
  if (!s) return [];
  return s
    .split(',')
    .map((x: string) => Number(x.trim()))
    .filter((n: number) => Number.isFinite(n));
}

// GET /liquidations/preview?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD&target=six_months|one_year&mode=individual|pooled&student_ids=1,2,3
router.get('/preview', async (req, res) => {
  try {
    const target = (norm(req.query.target) as Target) || 'six_months';
    const mode = (norm(req.query.mode) as Mode) || 'individual';

    if (!['six_months', 'one_year'].includes(target)) {
      return res.status(400).json({ error: 'target must be six_months or one_year' });
    }
    if (!['individual', 'pooled'].includes(mode)) {
      return res.status(400).json({ error: 'mode must be individual or pooled' });
    }

    const today = new Date();
    const end =
      parseISODateUTC(norm(req.query.end_date)) ||
      new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));

    const userStart = parseISODateUTC(norm(req.query.start_date));

    const studentIds = parseStudentIdsParam(req.query.student_ids);

    // Procesamos días nuevos a partir del último cierre (permite rangos solapados sin duplicar días).
    const [lastRows] = await pool.query('SELECT MAX(end_date) AS last_end_date FROM liquidations');
    const lastEndStr = valueToISODateString((lastRows as any[])[0]?.last_end_date);
    const lastEnd = lastEndStr ? parseISODateUTC(lastEndStr) : null;
    const minStart = lastEnd ? addDaysUTC(lastEnd, 1) : null;

    // Fecha elegible más antigua por alumno (desde último cierre) y mínima global.
    const { eligibleFromByStudentId, minEligibleDate } = await computeEligibleFromByStudentId(
      pool,
      minStart,
      end,
      studentIds.length ? studentIds : undefined
    );

    // Start efectivo:
    // - si el usuario elige "Desde", respetamos su fecha, pero nunca antes del último cierre (para no duplicar días).
    // - si no elige "Desde", usamos la fecha elegible más antigua.
    // - si no hay elegibles, usamos minStart (si existe) o el mismo end.
    let start = userStart || (minEligibleDate ? parseISODateUTC(minEligibleDate) : null) || minStart || end;
    if (minStart) start = maxDate(start, minStart);

    if (end.getTime() < start.getTime()) {
      if (lastEndStr) {
        return res.status(400).json({
          error: `No hay días nuevos para liquidar. Último cierre: ${lastEndStr}.`,
        });
      }
      return res.status(400).json({ error: 'end_date must be >= start_date' });
    }

    const balances = await getBalancesByStudentId(pool, studentIds.length ? studentIds : undefined);
    const { students: studentsFromContracts, added } = await computeAddedFteDaysByStudentId(
      pool,
      start,
      end,
      studentIds.length ? studentIds : undefined
    );

    const allStudentIds = new Set<number>();
    for (const sid of balances.keys()) allStudentIds.add(sid);
    for (const sid of added.keys()) allStudentIds.add(sid);

    const missingIds: number[] = [];
    for (const sid of allStudentIds) {
      if (!studentsFromContracts.has(sid)) missingIds.push(sid);
    }
    const namesFromStudents = await getStudentNames(pool, missingIds);

    const target_fte_days = TARGET_FTE_DAYS[target];

    const students = Array.from(allStudentIds)
      .map((sid) => {
        const opening = round2(balances.get(sid) || 0);
        const addedDays = round2(added.get(sid) || 0);
        const available = round2(opening + addedDays);
        const info = studentsFromContracts.get(sid) || {
          student_id: sid,
          first_names: namesFromStudents.get(sid)?.first_names || '',
          last_names: namesFromStudents.get(sid)?.last_names || '',
        };

        return {
          student_id: sid,
          first_names: info.first_names,
          last_names: info.last_names,
          eligible_from_date: eligibleFromByStudentId.get(sid) || null,
          opening_fte_days: opening,
          added_fte_days: addedDays,
          available_fte_days: available,
          eligible: available >= target_fte_days,
          jornadas_possible: Math.floor(available / target_fte_days),
        };
      })
      .filter((x) => x.available_fte_days > 0)
      .sort((a, b) => b.available_fte_days - a.available_fte_days);

    const total_available_fte_days = round2(students.reduce((acc, s) => acc + s.available_fte_days, 0));

    const total_jornadas_individual = students.reduce((acc, s) => acc + (Number(s.jornadas_possible) || 0), 0);
    const total_used_individual = round2(total_jornadas_individual * target_fte_days);
    const total_remainder_individual = round2(total_available_fte_days - total_used_individual);

    const total_jornadas_pooled = Math.floor(total_available_fte_days / target_fte_days);
    const total_used_pooled = round2(total_jornadas_pooled * target_fte_days);
    const total_remainder_pooled = round2(total_available_fte_days - total_used_pooled);

    const total_jornadas = mode === 'individual' ? total_jornadas_individual : total_jornadas_pooled;
    const total_used_fte_days = mode === 'individual' ? total_used_individual : total_used_pooled;
    const total_remainder_fte_days = mode === 'individual' ? total_remainder_individual : total_remainder_pooled;

    return res.json({
      start_date: toISODate(start),
      end_date: toISODate(end),
      min_eligible_date: minEligibleDate,
      target,
      mode,
      target_fte_days,
      pool: {
        total_available_fte_days,
        total_jornadas,
        total_used_fte_days,
        total_remainder_fte_days,
      },
      students,
    });
  } catch (e) {
    return res.status(500).json({ error: 'Error al generar previsualización de liquidación', details: (e as Error).message });
  }
});

// GET /liquidations
router.get('/', async (_req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, start_date, end_date, target, mode, target_fte_days, total_students, total_fte_days_used, total_jornadas, created_at FROM liquidations ORDER BY created_at DESC, id DESC'
    );
    return res.json(rows);
  } catch (e) {
    return res.status(500).json({ error: 'Error al listar liquidaciones', details: (e as Error).message });
  }
});

// GET /liquidations/:id
router.get('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'id must be a number' });

  try {
    const [lRows] = await pool.query(
      'SELECT id, start_date, end_date, target, mode, target_fte_days, total_students, total_fte_days_used, total_jornadas, created_at FROM liquidations WHERE id = ?',
      [id]
    );
    const liquidation = (lRows as any[])[0];
    if (!liquidation) return res.status(404).json({ error: 'Liquidación no encontrada' });

    const [lines] = await pool.query(
      `
        SELECT
          ll.id,
          ll.student_id,
          s.first_names,
          s.last_names,
          ll.opening_fte_days,
          ll.added_fte_days,
          ll.used_fte_days,
          ll.closing_fte_days,
          ll.jornadas_generated
        FROM liquidation_lines ll
        JOIN students s ON s.id = ll.student_id
        WHERE ll.liquidation_id = ?
        ORDER BY ll.used_fte_days DESC, ll.added_fte_days DESC, ll.student_id ASC
      `,
      [id]
    );

    return res.json({ liquidation, lines });
  } catch (e) {
    return res.status(500).json({ error: 'Error al consultar liquidación', details: (e as Error).message });
  }
});

// POST /liquidations
router.post('/', async (req, res) => {
  const start_date = norm(req.body?.start_date);
  const end_date = norm(req.body?.end_date);
  const target = (norm(req.body?.target) as Target) || 'six_months';
  const mode = (norm(req.body?.mode) as Mode) || 'individual';
  const student_ids = Array.isArray(req.body?.student_ids) ? (req.body.student_ids as any[]) : [];
  const studentIds = student_ids.map((x) => Number(x)).filter((n) => Number.isFinite(n));

  if (!['six_months', 'one_year'].includes(target)) {
    return res.status(400).json({ error: 'target must be six_months or one_year' });
  }
  if (!['individual', 'pooled'].includes(mode)) {
    return res.status(400).json({ error: 'mode must be individual or pooled' });
  }

  const end = parseISODateUTC(end_date);
  if (!end) return res.status(400).json({ error: 'end_date is required (YYYY-MM-DD)' });

  const userStart = parseISODateUTC(start_date);
  const target_fte_days = TARGET_FTE_DAYS[target];

  const conn = await (pool as any).getConnection();
  try {
    await conn.beginTransaction();

    // Permitimos rangos solapados, pero solo computamos días nuevos a partir del último cierre (para no duplicar días ya liquidados).
    const [last] = await conn.query(
      'SELECT end_date FROM liquidations ORDER BY end_date DESC, id DESC LIMIT 1 FOR UPDATE'
    );
    const lastEndStr = valueToISODateString((last as any[])[0]?.end_date);
    const lastEnd = lastEndStr ? parseISODateUTC(lastEndStr) : null;
    const minStart = lastEnd ? addDaysUTC(lastEnd, 1) : null;

    // Fecha elegible más antigua por alumno (desde último cierre) y mínima global.
    const { minEligibleDate } = await computeEligibleFromByStudentId(
      conn,
      minStart,
      end,
      studentIds.length ? studentIds : undefined
    );

    // Start efectivo (ver preview): max(userStart, minStart) o por defecto minEligibleDate.
    let start = userStart || (minEligibleDate ? parseISODateUTC(minEligibleDate) : null) || minStart || end;
    if (minStart) start = maxDate(start, minStart);

    if (end.getTime() < start.getTime()) {
      await conn.rollback();
      if (lastEndStr) {
        return res.status(400).json({ error: `No hay días nuevos para liquidar. Último cierre: ${lastEndStr}.` });
      }
      return res.status(400).json({ error: 'end_date must be >= start_date' });
    }

    const balances = await getBalancesByStudentId(conn, studentIds.length ? studentIds : undefined);
    const { added } = await computeAddedFteDaysByStudentId(conn, start, end, studentIds.length ? studentIds : undefined);

    const allStudentIds = new Set<number>();
    for (const sid of balances.keys()) allStudentIds.add(sid);
    for (const sid of added.keys()) allStudentIds.add(sid);

    const candidates = Array.from(allStudentIds)
      .map((sid) => {
        const opening = round2(balances.get(sid) || 0);
        const addedDays = round2(added.get(sid) || 0);
        const available = round2(opening + addedDays);
        return { sid, opening, added: addedDays, available };
      })
      .filter((x) => x.available > 0);

    if (!candidates.length) {
      await conn.rollback();
      return res.status(400).json({ error: 'No hay alumnos con días cotizados para liquidar en el rango seleccionado' });
    }

    // Allocations
    const sorted = mode === 'pooled'
      ? [...candidates].sort((a, b) => b.available - a.available)
      : [...candidates].sort((a, b) => a.sid - b.sid);

    const totalJornadasPossible =
      mode === 'pooled'
        ? Math.floor(round2(sorted.reduce((acc, s) => acc + s.available, 0)) / target_fte_days)
        : sorted.reduce((acc, s) => acc + Math.floor(s.available / target_fte_days), 0);

    if (totalJornadasPossible < 1) {
      await conn.rollback();
      return res.status(400).json({
        error:
          mode === 'individual'
            ? 'No se puede ejecutar la liquidación: ningún alumno alcanza el mínimo para 1 jornada completa.'
            : 'No se puede ejecutar la liquidación: el total combinado no alcanza el mínimo para 1 jornada completa.',
      });
    }

    // Inserta la cabecera de liquidación (totales se actualizan al final)
    const [ins] = await conn.query(
      `
        INSERT INTO liquidations
        (start_date, end_date, target, mode, target_fte_days, total_students, total_fte_days_used, total_jornadas)
        VALUES (?, ?, ?, ?, ?, 0, 0, 0)
      `,
      [toISODate(start), toISODate(end), target, mode, target_fte_days]
    );
    const liquidationId = (ins as any).insertId as number;

    let totalJornadas = 0;
    let totalUsed = 0;

    let poolRemainingToUse = 0;
    if (mode === 'pooled') {
      totalJornadas = totalJornadasPossible;
      poolRemainingToUse = round2(totalJornadas * target_fte_days);
    }

    const linesToInsert: any[] = [];
    const balancesToUpsert: any[] = [];

    for (const s of sorted) {
      let jornadas = 0;
      let used = 0;

      if (mode === 'individual') {
        jornadas = Math.floor(s.available / target_fte_days);
        used = round2(jornadas * target_fte_days);
      } else {
        used = round2(Math.min(s.available, poolRemainingToUse));
        poolRemainingToUse = round2(poolRemainingToUse - used);
      }

      const closing = round2(s.available - used);

      if (used > 0) {
        totalUsed = round2(totalUsed + used);
      }
      if (mode === 'individual' && jornadas > 0) {
        totalJornadas += jornadas;
      }

      linesToInsert.push([
        liquidationId,
        s.sid,
        s.opening,
        s.added,
        used,
        closing,
        jornadas,
      ]);

      balancesToUpsert.push([s.sid, closing]);
    }

    // Insert lines
    const placeholders = linesToInsert.map(() => '(?, ?, ?, ?, ?, ?, ?)').join(',');
    await conn.query(
      `
        INSERT INTO liquidation_lines
        (liquidation_id, student_id, opening_fte_days, added_fte_days, used_fte_days, closing_fte_days, jornadas_generated)
        VALUES ${placeholders}
      `,
      linesToInsert.flat()
    );

    // Upsert balances
    const bPlaceholders = balancesToUpsert.map(() => '(?, ?)').join(',');
    await conn.query(
      `
        INSERT INTO student_liquidation_balances (student_id, fte_days_balance)
        VALUES ${bPlaceholders}
        ON DUPLICATE KEY UPDATE fte_days_balance = VALUES(fte_days_balance)
      `,
      balancesToUpsert.flat()
    );

    const totalStudentsUsed = linesToInsert.filter((l) => Number(l[4]) > 0).length;

    await conn.query(
      'UPDATE liquidations SET total_students = ?, total_fte_days_used = ?, total_jornadas = ? WHERE id = ?',
      [totalStudentsUsed, totalUsed, totalJornadas, liquidationId]
    );

    // Return
    const [liqRows] = await conn.query(
      'SELECT id, start_date, end_date, target, mode, target_fte_days, total_students, total_fte_days_used, total_jornadas, created_at FROM liquidations WHERE id = ?',
      [liquidationId]
    );

    const [lineRows] = await conn.query(
      `
        SELECT
          ll.id,
          ll.student_id,
          s.first_names,
          s.last_names,
          ll.opening_fte_days,
          ll.added_fte_days,
          ll.used_fte_days,
          ll.closing_fte_days,
          ll.jornadas_generated
        FROM liquidation_lines ll
        JOIN students s ON s.id = ll.student_id
        WHERE ll.liquidation_id = ?
        ORDER BY ll.used_fte_days DESC, ll.added_fte_days DESC, ll.student_id ASC
      `,
      [liquidationId]
    );

    await conn.commit();

    return res.status(201).json({ liquidation: (liqRows as any[])[0], lines: lineRows });
  } catch (e) {
    try {
      await conn.rollback();
    } catch {
      // ignore
    }
    return res.status(500).json({ error: 'Error al ejecutar liquidación', details: (e as Error).message });
  } finally {
    conn.release();
  }
});

export default router;
