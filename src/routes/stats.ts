import { Router } from 'express';
import { pool } from '../db/pool';

const router = Router();

// GET /stats/summary
router.get('/summary', async (_req, res) => {
  try {
    const [sRes, eiRes, ceRes, mRes, vRes] = await Promise.all([
      pool.query("SELECT COUNT(*) AS total_students FROM students"),
      pool.query("SELECT COUNT(*) AS employed_or_improved FROM students WHERE employment_status IN ('employed','improved')"),
      pool.query("SELECT COUNT(*) AS currently_employed FROM students WHERE employment_status = 'employed'"),
      pool.query("SELECT COUNT(*) AS missing_cvs FROM students s LEFT JOIN documents d ON s.id = d.student_id AND d.type = 'cv' WHERE d.id IS NULL"),
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
      employed_rate: total_students ? (employed_or_improved / total_students) : 0,
    });
  } catch (e) {
    res.status(500).json({ error: 'Error al calcular estadísticas', details: (e as Error).message });
  }
});

// GET /stats/reports
router.get('/reports', async (_req, res) => {
  try {
  // 1. Ejecutamos todo y cerramos el paréntesis correctamente
  const [sRes, eRes, iRes, cRes, hRes] = await Promise.all([
    pool.query("SELECT COUNT(*) AS total FROM students"),
    pool.query("SELECT COUNT(*) AS employed FROM students WHERE employment_status = 'employed'"),
    pool.query("SELECT COUNT(*) AS interviews FROM interviews"),
    pool.query("SELECT COUNT(*) AS contracts FROM hiring_contracts"),
    pool.query("SELECT COUNT(*) AS hospitality FROM hiring_contracts WHERE sector = 'Hostelería'")
  ]);

  // 2. Extraemos los valores de las filas (el primer elemento del resultado)
  const total_students = (sRes[0] as any)[0]?.total || 0;
  const employed_students = (eRes[0] as any)[0]?.employed || 0;
  const interviews_total = (iRes[0] as any)[0]?.interviews || 0;
  const contracts_total = (cRes[0] as any)[0]?.contracts || 0;
  const hospitality_contracts = (hRes[0] as any)[0]?.hospitality || 0;

  // 3. Cálculos con lógica de seguridad
  const insercionLaboral = total_students ? Math.round((employed_students / total_students) * 100) : 0;
  const hospitalityPct = contracts_total ? Math.round((hospitality_contracts / contracts_total) * 100) : 0;

  res.json({
    alumnosAccedenPracticas: 0, 
    alumnosEntrevistas: interviews_total,
    alumnosIncorporados: contracts_total,
    alumnosMas6Meses: 0,
    valoracionEmpresasMedia: 0,
    insercionLaboral,
    porcentajeEmpleoAntes3Meses: hospitalityPct,
    tiempoPromedioBusqueda: 0,
    alumnosFinalizanPNL: 0,
  });
} catch (e) {
  res.status(500).json({ error: 'Error al calcular informes', details: (e as Error).message });
}
});

export default router;
