import { Router } from 'express';
import { pool } from '../db/pool.js';

const router = Router();

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

function toIsoDate(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v);
  return s.length >= 10 ? s.slice(0, 10) : null;
}

function monthKeyFromIso(iso: string) {
  return iso.slice(0, 7);
}

function quarterKeyFromIso(iso: string) {
  const y = iso.slice(0, 4);
  const m = Number(iso.slice(5, 7));
  const q = Math.floor((m - 1) / 3) + 1;
  return `${y}-Q${q}`;
}

function parseMonthKey(key: string): { year: number; month: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec((key || '').trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return null;
  return { year, month };
}

function parseQuarterKey(key: string): { year: number; quarter: number } | null {
  const m = /^(\d{4})-(?:Q|q|T|t)([1-4])$/.exec((key || '').trim());
  if (!m) return null;
  const year = Number(m[1]);
  const quarter = Number(m[2]);
  if (!Number.isFinite(year) || !Number.isFinite(quarter)) return null;
  return { year, quarter };
}

function daysInMonthUtc(year: number, month: number) {
  // month 1-12
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function clampIsoDate(iso: string, maxIso: string) {
  return iso > maxIso ? maxIso : iso;
}

function monthStartEnd(key: string, maxIso: string): { key: string; start_date: string; end_date: string } {
  const parsed = parseMonthKey(key);
  if (!parsed) throw new Error('Invalid month key');
  const { year, month } = parsed;
  const start_date = `${year}-${pad2(month)}-01`;
  const endOfMonth = `${year}-${pad2(month)}-${pad2(daysInMonthUtc(year, month))}`;
  const end_date = clampIsoDate(endOfMonth, maxIso);
  return { key: `${year}-${pad2(month)}`, start_date, end_date };
}

function quarterStartEnd(key: string, maxIso: string): { key: string; start_date: string; end_date: string } {
  const parsed = parseQuarterKey(key);
  if (!parsed) throw new Error('Invalid quarter key');
  const { year, quarter } = parsed;
  const startMonth = (quarter - 1) * 3 + 1;
  const endMonth = startMonth + 2;
  const start_date = `${year}-${pad2(startMonth)}-01`;
  const endOfQuarter = `${year}-${pad2(endMonth)}-${pad2(daysInMonthUtc(year, endMonth))}`;
  const end_date = clampIsoDate(endOfQuarter, maxIso);
  return { key: `${year}-Q${quarter}`, start_date, end_date };
}

function clampMonthKey(key: string, minKey: string, maxKey: string): string {
  if (key < minKey) return minKey;
  if (key > maxKey) return maxKey;
  return key;
}

function quarterKeyIndex(key: string) {
  const p = parseQuarterKey(key);
  if (!p) return null;
  return p.year * 4 + p.quarter;
}

function clampQuarterKey(key: string, minKey: string, maxKey: string): string {
  const idx = quarterKeyIndex(key);
  const minIdx = quarterKeyIndex(minKey);
  const maxIdx = quarterKeyIndex(maxKey);
  if (idx == null || minIdx == null || maxIdx == null) return maxKey;
  if (idx < minIdx) return minKey;
  if (idx > maxIdx) return maxKey;
  return key;
}

function asNumber(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// GET /stats/summary
router.get('/summary', async (_req, res) => {
  try {
    const [sRes, eiRes, ceRes, mRes, vRes] = await Promise.all([
      pool.query("SELECT COUNT(*) AS total_students FROM students"),
      pool.query("SELECT COUNT(*) AS employed_or_improved FROM students WHERE employment_status IN ('employed','improved')"),
      pool.query("SELECT COUNT(*) AS currently_employed FROM students WHERE employment_status = 'employed'"),
      pool.query(
        "SELECT COUNT(*) AS missing_cvs FROM students s LEFT JOIN documents d ON s.id = d.student_id AND d.type = 'cv' WHERE d.id IS NULL"
      ),
      pool.query("SELECT COUNT(*) AS open_vacancies FROM vacancies WHERE status = 'open'")
    ]);

    const total_students = (sRes[0] as any)[0]?.total_students || 0;
    const employed_or_improved = (eiRes[0] as any)[0]?.employed_or_improved || 0;
    const currently_employed = (ceRes[0] as any)[0]?.currently_employed || 0;
    const missing_cvs = (mRes[0] as any)[0]?.missing_cvs || 0;
    const open_vacancies = (vRes[0] as any)[0]?.open_vacancies || 0;

    res.json({
      total_students,
      employed_or_improved,
      currently_employed,
      missing_cvs,
      open_vacancies,
      employed_rate: total_students ? employed_or_improved / total_students : 0,
    });
  } catch (e) {
    res.status(500).json({ error: 'Error al calcular estadísticas', details: (e as Error).message });
  }
});

// GET /stats/reports?type=monthly|quarterly&key=YYYY-MM|YYYY-Qn
router.get('/reports', async (req, res) => {
  try {
    const todayIso = new Date().toISOString().slice(0, 10);

    const [minRes] = await pool.query(
      `SELECT MIN(d) AS min_date FROM (
        SELECT MIN(start_date) AS d FROM pnl
        UNION ALL SELECT MIN(end_date) AS d FROM pnl WHERE end_date IS NOT NULL
        UNION ALL SELECT MIN(interview_date) AS d FROM interviews
        UNION ALL SELECT MIN(start_date) AS d FROM hiring_contracts
        UNION ALL SELECT MIN(end_date) AS d FROM hiring_contracts WHERE end_date IS NOT NULL
        UNION ALL SELECT MIN(COALESCE(end_date, start_date)) AS d FROM student_courses
        UNION ALL SELECT MIN(practices_start) AS d FROM students WHERE practices_start IS NOT NULL
        UNION ALL SELECT MIN(practices_end) AS d FROM students WHERE practices_end IS NOT NULL
      ) t`
    );

    const minDateIso = toIsoDate((minRes as any)[0]?.min_date);

    const maxMonthKey = monthKeyFromIso(todayIso);
    const maxQuarterKey = quarterKeyFromIso(todayIso);

    const minMonthKey = minDateIso ? monthKeyFromIso(minDateIso) : maxMonthKey;
    const minQuarterKey = minDateIso ? quarterKeyFromIso(minDateIso) : maxQuarterKey;

    const meta = {
      min_date: minDateIso,
      max_date: todayIso,
      min_month: minMonthKey,
      max_month: maxMonthKey,
      min_quarter: minQuarterKey,
      max_quarter: maxQuarterKey,
    };

    const rawType = String((req.query as any)?.type || 'monthly').toLowerCase();
    const type = rawType === 'trimestral' || rawType === 'quarterly' || rawType === 'trim' ? 'quarterly' : 'monthly';

    const keyIn = String((req.query as any)?.key || '').trim();

    let periodKey: string;
    let periodStart: string;
    let periodEnd: string;

    if (type === 'monthly') {
      const defaultKey = maxMonthKey;
      const safeKey = clampMonthKey(parseMonthKey(keyIn) ? keyIn : defaultKey, minMonthKey, maxMonthKey);
      const p = monthStartEnd(safeKey, todayIso);
      periodKey = p.key;
      periodStart = p.start_date;
      periodEnd = p.end_date;
    } else {
      const defaultKey = maxQuarterKey;
      const safeKey = clampQuarterKey(parseQuarterKey(keyIn) ? keyIn : defaultKey, minQuarterKey, maxQuarterKey);
      const p = quarterStartEnd(safeKey, todayIso);
      periodKey = p.key;
      periodStart = p.start_date;
      periodEnd = p.end_date;
    }

    const [studentsRes, pnlStartsRes, pnlEndsRes, interviewsRes, contractsRes, sixMonthsRes, ttbRes] = await Promise.all([
      pool.query("SELECT COUNT(*) AS total FROM students"),

      pool.query(
        "SELECT COUNT(DISTINCT student_id) AS cnt FROM pnl WHERE start_date BETWEEN ? AND ?",
        [periodStart, periodEnd]
      ),
      pool.query(
        "SELECT COUNT(DISTINCT student_id) AS cnt FROM pnl WHERE end_date IS NOT NULL AND end_date BETWEEN ? AND ?",
        [periodStart, periodEnd]
      ),

      pool.query(
        "SELECT COUNT(DISTINCT student_id) AS cnt FROM interviews WHERE status = 'attended' AND interview_date BETWEEN ? AND ?",
        [periodStart, periodEnd]
      ),

      pool.query(
        "SELECT COUNT(DISTINCT student_id) AS cnt FROM hiring_contracts WHERE start_date BETWEEN ? AND ?",
        [periodStart, periodEnd]
      ),

      pool.query(
        `SELECT COUNT(DISTINCT student_id) AS cnt
         FROM hiring_contracts
         WHERE DATE_ADD(start_date, INTERVAL 6 MONTH) BETWEEN ? AND ?
           AND (end_date IS NULL OR end_date >= DATE_ADD(start_date, INTERVAL 6 MONTH))`,
        [periodStart, periodEnd]
      ),

      pool.query(
        `SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN DATEDIFF(first_contract_start, itinerary_end) BETWEEN 0 AND 90 THEN 1 ELSE 0 END) AS within_90,
          AVG(CASE WHEN DATEDIFF(first_contract_start, itinerary_end) >= 0 THEN DATEDIFF(first_contract_start, itinerary_end) ELSE NULL END) AS avg_days
        FROM (
          SELECT
            fc.student_id,
            fc.first_contract_start,
            COALESCE(sc.course_end, s.practices_end, s.practices_start) AS itinerary_end
          FROM (
            SELECT student_id, MIN(start_date) AS first_contract_start
            FROM hiring_contracts
            GROUP BY student_id
          ) fc
          JOIN students s ON s.id = fc.student_id
          LEFT JOIN (
            SELECT student_id, MAX(COALESCE(end_date, start_date)) AS course_end
            FROM student_courses
            GROUP BY student_id
          ) sc ON sc.student_id = fc.student_id
          WHERE fc.first_contract_start BETWEEN ? AND ?
        ) t
        WHERE itinerary_end IS NOT NULL
          AND DATEDIFF(first_contract_start, itinerary_end) >= 0`,
        [periodStart, periodEnd]
      ),
    ]);

    const totalStudents = asNumber((studentsRes[0] as any)[0]?.total);

    const alumnosAccedenPracticas = asNumber((pnlStartsRes[0] as any)[0]?.cnt);
    const alumnosFinalizanPNL = asNumber((pnlEndsRes[0] as any)[0]?.cnt);
    const alumnosEntrevistas = asNumber((interviewsRes[0] as any)[0]?.cnt);
    const alumnosIncorporados = asNumber((contractsRes[0] as any)[0]?.cnt);
    const alumnosMas6Meses = asNumber((sixMonthsRes[0] as any)[0]?.cnt);

    const ttbRow = (ttbRes[0] as any)[0] || {};
    const ttbTotal = asNumber(ttbRow.total);
    const ttbWithin90 = asNumber(ttbRow.within_90);
    const ttbAvgDays = asNumber(ttbRow.avg_days);

    const insercionLaboral = totalStudents ? (alumnosIncorporados / totalStudents) * 100 : 0;
    const porcentajeEmpleoAntes3Meses = ttbTotal ? (ttbWithin90 / ttbTotal) * 100 : 0;
    const tiempoPromedioBusqueda = ttbTotal ? (Number.isFinite(ttbAvgDays) ? Math.round(ttbAvgDays) : null) : null;

    res.json({
      meta,
      period: {
        type,
        key: periodKey,
        start_date: periodStart,
        end_date: periodEnd,
      },
      data: {
        alumnosAccedenPracticas,
        alumnosEntrevistas,
        alumnosIncorporados,
        alumnosMas6Meses,
        insercionLaboral,
        porcentajeEmpleoAntes3Meses,
        tiempoPromedioBusqueda,
        alumnosFinalizanPNL,
      },
    });
  } catch (e) {
    res.status(500).json({ error: 'Error al calcular informes', details: (e as Error).message });
  }
});

export default router;
