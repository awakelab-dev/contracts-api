import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { env } from '../config/env.js';

const router = Router();
router.use(requireAuth);

function toInt(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function clampInt(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function extractJsonObject(text: string): string {
  const t = (text || '').trim();
  if (!t) return t;

  if (t.startsWith('{') && t.endsWith('}')) return t;

  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  if (fenced?.[1]) {
    const inner = fenced[1].trim();
    if (inner.startsWith('{') && inner.endsWith('}')) return inner;
  }

  const first = t.indexOf('{');
  const last = t.lastIndexOf('}');
  if (first !== -1 && last !== -1 && last > first) return t.slice(first, last + 1);
  return t;
}

const OpenAiMatchSchema = z.object({
  score: z.number().int().min(0).max(100),
  notes: z.string().max(500).optional(),
});

type ScoreInput = {
  vacancy: {
    title: string;
    sector?: string | null;
    description?: string | null;
    requirements?: string | null;
  };
  course: {
    title: string;
    description?: string | null;
  };
};

async function scoreVacancyVsCourseWithOpenAI(input: ScoreInput): Promise<{ score: number; notes: string }> {
  if (!env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured');
  }

  const system = [
    'Eres un asistente experto en selección de talento.',
    'Tu tarea: evaluar qué tan útil/relevante es un curso para una vacante.',
    'Devuelve SOLO un JSON con: score (entero 0-100) y notes (explicación muy breve).',
    'Rubrica:',
    '- 0-20: no relacionado o muy débil',
    '- 21-50: relación parcial',
    '- 51-80: buena relación',
    '- 81-100: relación muy fuerte',
    'Si falta información, infiere con cautela y usa un score moderado.',
  ].join('\n');

  const user = [
    'VACANTE',
    `Título: ${input.vacancy.title}`,
    `Sector: ${input.vacancy.sector ?? ''}`,
    `Descripción: ${input.vacancy.description ?? ''}`,
    `Requisitos: ${input.vacancy.requirements ?? ''}`,
    '',
    'CURSO',
    `Título: ${input.course.title}`,
    `Descripción: ${input.course.description ?? ''}`,
    '',
    'Responde en JSON: {"score": 0-100, "notes": "..."}',
  ].join('\n');

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: env.OPENAI_MATCH_MODEL,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });

  const data = (await resp.json().catch(() => null)) as any;
  if (!resp.ok) {
    const msg = data?.error?.message || `OpenAI error ${resp.status}`;
    throw new Error(msg);
  }

  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('OpenAI response missing content');
  }

  const parsedJson = JSON.parse(extractJsonObject(content));
  const parsed = OpenAiMatchSchema.parse(parsedJson);

  const score = clampInt(parsed.score, 0, 100);
  const notes = (parsed.notes ?? '').toString().slice(0, 255);
  return { score, notes };
}

async function upsertCourseTopicsFromStudentCourses(): Promise<number> {
  const [result] = await pool.query(
    `INSERT IGNORE INTO course_topics (title)
     SELECT DISTINCT TRIM(title)
     FROM student_courses
     WHERE TRIM(title) <> ''`
  );
  return (result as any).affectedRows || 0;
}

async function getMatchingCounts() {
  const [vacRes, topicRes, matchRes, missingTitlesRes] = await Promise.all([
    pool.query('SELECT COUNT(*) AS cnt FROM vacancies'),
    pool.query('SELECT COUNT(*) AS cnt FROM course_topics'),
    pool.query('SELECT COUNT(*) AS cnt FROM vacancy_course_match'),
    pool.query(
      `SELECT COUNT(*) AS cnt FROM (
         SELECT DISTINCT TRIM(title) AS title
         FROM student_courses
         WHERE TRIM(title) <> ''
       ) sc
       LEFT JOIN course_topics ct ON ct.title = sc.title
       WHERE ct.id IS NULL`
    ),
  ]);

  const vacancies = Number((vacRes[0] as any)[0]?.cnt || 0);
  const course_topics = Number((topicRes[0] as any)[0]?.cnt || 0);
  const match_pairs = Number((matchRes[0] as any)[0]?.cnt || 0);
  const missing_course_topics = Number((missingTitlesRes[0] as any)[0]?.cnt || 0);

  const missing_pairs_existing_topics = Math.max(0, vacancies * course_topics - match_pairs);
  const estimated_pairs_after_topics_upsert = vacancies * (course_topics + missing_course_topics);
  const estimated_missing_pairs_after_topics_upsert = Math.max(0, estimated_pairs_after_topics_upsert - match_pairs);

  const needs_update = missing_course_topics > 0 || missing_pairs_existing_topics > 0;

  return {
    vacancies,
    course_topics,
    match_pairs,
    missing_course_topics,
    missing_pairs_existing_topics,
    estimated_missing_pairs_after_topics_upsert,
    needs_update,
  };
}

// GET /matching/status
router.get('/status', async (_req, res) => {
  try {
    const counts = await getMatchingCounts();
    return res.json({
      openai_configured: !!env.OPENAI_API_KEY,
      model: env.OPENAI_MATCH_MODEL,
      prompt_version: env.OPENAI_MATCH_PROMPT_VERSION,
      ...counts,
    });
  } catch (e) {
    return res.status(500).json({ error: 'Error al consultar estado de matching', details: (e as Error).message });
  }
});

// POST /matching/update
// Ejecuta el scoring SOLO para pares (vacancy_id, course_topic_id) que aún no existen.
router.post('/update', async (req, res) => {
  try {
    const limitIn = toInt((req.body as any)?.limit) ?? toInt((req.query as any)?.limit);
    const limit = clampInt(limitIn ?? 20, 1, 200);

    const inserted_course_topics = await upsertCourseTopicsFromStudentCourses();

    const [pairsRes] = await pool.query(
      `SELECT
         v.id AS vacancy_id,
         v.title AS vacancy_title,
         v.sector AS vacancy_sector,
         v.description AS vacancy_description,
         v.requirements AS vacancy_requirements,
         ct.id AS course_topic_id,
         ct.title AS course_title,
         ct.description AS course_description
       FROM vacancies v
       JOIN course_topics ct
       LEFT JOIN vacancy_course_match m
         ON m.vacancy_id = v.id AND m.course_topic_id = ct.id
       WHERE m.vacancy_id IS NULL
       ORDER BY v.id DESC, ct.id ASC
       LIMIT ?`,
      [limit]
    );

    const pairs = Array.isArray(pairsRes) ? (pairsRes as any[]) : [];

    if (pairs.length === 0) {
      const counts = await getMatchingCounts();
      return res.json({
        message: 'Todo está actualizado',
        inserted_course_topics,
        processed_pairs: 0,
        ...counts,
      });
    }

    if (!env.OPENAI_API_KEY) {
      return res.status(400).json({
        error: 'OPENAI_API_KEY no configurada (no se puede ejecutar Matching IA)',
        inserted_course_topics,
        pending_pairs_sampled: pairs.length,
      });
    }

    let processed_pairs = 0;
    let inserted_pairs = 0;

    for (const p of pairs) {
      const { score, notes } = await scoreVacancyVsCourseWithOpenAI({
        vacancy: {
          title: String(p.vacancy_title || ''),
          sector: p.vacancy_sector ?? null,
          description: p.vacancy_description ?? null,
          requirements: p.vacancy_requirements ?? null,
        },
        course: {
          title: String(p.course_title || ''),
          description: p.course_description ?? null,
        },
      });

      const [ins] = await pool.query(
        `INSERT IGNORE INTO vacancy_course_match
         (vacancy_id, course_topic_id, score, model, prompt_version, notes)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          p.vacancy_id,
          p.course_topic_id,
          score,
          env.OPENAI_MATCH_MODEL,
          env.OPENAI_MATCH_PROMPT_VERSION,
          notes || null,
        ]
      );

      processed_pairs += 1;
      inserted_pairs += (ins as any).affectedRows || 0;
    }

    const counts = await getMatchingCounts();
    return res.json({
      message: 'Matching actualizado',
      inserted_course_topics,
      processed_pairs,
      inserted_pairs,
      ...counts,
    });
  } catch (e) {
    return res.status(500).json({ error: 'Error al actualizar matching', details: (e as Error).message });
  }
});

// GET /matching/students?vacancyId=123&limit=100
router.get('/students', async (req, res) => {
  try {
    const vacancyId = toInt((req.query as any)?.vacancyId ?? (req.query as any)?.vacancy_id);
    if (!vacancyId || vacancyId <= 0) {
      return res.status(400).json({ error: 'vacancyId must be a positive number' });
    }

    const limitIn = toInt((req.query as any)?.limit);
    const limit = clampInt(limitIn ?? 200, 1, 1000);

    const [rows] = await pool.query(
      `SELECT
         s.id,
         s.first_names,
         s.last_names,
         s.dni_nie,
         s.social_security_number,
         s.birth_date,
         d.name AS district,
         s.phone,
         s.email,
         MAX(m.score) AS score,
         COUNT(DISTINCT m.course_topic_id) AS matched_topics_count
       FROM students s
       LEFT JOIN districts d ON d.code = s.district_code
       LEFT JOIN student_courses sc ON sc.student_id = s.id
       LEFT JOIN course_topics ct ON ct.title = TRIM(sc.title)
       LEFT JOIN vacancy_course_match m ON m.vacancy_id = ? AND m.course_topic_id = ct.id
       GROUP BY s.id
       HAVING score > 0
       ORDER BY score DESC, matched_topics_count DESC, s.id DESC
       LIMIT ?`,
      [vacancyId, limit]
    );

    return res.json(rows);
  } catch (e) {
    return res.status(500).json({ error: 'Error al consultar matching de alumnos', details: (e as Error).message });
  }
});

// GET /matching/vacancies?studentId=123&limit=100&includeClosed=1
router.get('/vacancies', async (req, res) => {
  try {
    const studentId = toInt((req.query as any)?.studentId ?? (req.query as any)?.student_id);
    if (!studentId || studentId <= 0) {
      return res.status(400).json({ error: 'studentId must be a positive number' });
    }

    const limitIn = toInt((req.query as any)?.limit);
    const limit = clampInt(limitIn ?? 200, 1, 1000);

    const includeClosed = String((req.query as any)?.includeClosed ?? '').trim() === '1';
    const where = includeClosed ? '' : "WHERE v.status = 'open'";

    const [rows] = await pool.query(
      `SELECT
         v.id,
         v.company_id,
         v.title,
         v.sector,
         v.description,
         v.requirements,
         v.status,
         v.created_at,
         MAX(m.score) AS score,
         COUNT(DISTINCT m.course_topic_id) AS matched_topics_count
       FROM vacancies v
       JOIN vacancy_course_match m ON m.vacancy_id = v.id
       JOIN course_topics ct ON ct.id = m.course_topic_id
       JOIN student_courses sc ON sc.student_id = ? AND TRIM(sc.title) = ct.title
       ${where}
       GROUP BY v.id
       HAVING score > 0
       ORDER BY score DESC, matched_topics_count DESC, v.id DESC
       LIMIT ?`,
      [studentId, limit]
    );

    return res.json(rows);
  } catch (e) {
    return res.status(500).json({ error: 'Error al consultar matching de vacantes', details: (e as Error).message });
  }
});

export default router;
