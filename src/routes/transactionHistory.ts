import { Router } from 'express';
import type { Request } from 'express';
import type { ResultSetHeader } from 'mysql2';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

let ensureTransactionHistorySchemaPromise: Promise<void> | null = null;

const norm = (value: unknown) => (value ?? '').toString().trim();

const toPositiveInt = (value: unknown) => {
  const cleaned = norm(value);
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.trunc(parsed);
};

const isForeignKeyError = (error: unknown) =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { code?: string }).code === 'ER_NO_REFERENCED_ROW_2';

function resolveCurrentUser(req: Request) {
  const authUser = (req as any).user as Record<string, unknown> | undefined;
  const userCandidates = [
    authUser?.username,
    authUser?.sub,
    authUser?.email,
    authUser?.name,
  ];

  for (const candidate of userCandidates) {
    const resolved = norm(candidate);
    if (resolved) return resolved;
  }

  return 'admin';
}

async function ensureTransactionHistorySchema() {
  if (ensureTransactionHistorySchemaPromise) {
    await ensureTransactionHistorySchemaPromise;
    return;
  }

  ensureTransactionHistorySchemaPromise = (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS transaction_history (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        company_id BIGINT NOT NULL,
        \`user\` VARCHAR(190) NOT NULL,
        description TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_transaction_history_company_id (company_id),
        CONSTRAINT fk_transaction_history_company
          FOREIGN KEY (company_id) REFERENCES companies(id)
          ON UPDATE CASCADE
          ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);
  })();

  try {
    await ensureTransactionHistorySchemaPromise;
  } catch (error) {
    ensureTransactionHistorySchemaPromise = null;
    throw error;
  }
}

router.use(async (req, res, next) => {
  if (req.method === 'OPTIONS') {
    return next();
  }
  try {
    await ensureTransactionHistorySchema();
    return next();
  } catch (e) {
    return res.status(500).json({
      error: 'Error al preparar esquema de historial de transacciones',
      details: (e as Error).message,
    });
  }
});

/**
 * GET /transaction-history/:companyId
 */
router.get('/:companyId', async (req, res) => {
  const companyId = toPositiveInt(req.params.companyId);
  if (!companyId) {
    return res.status(400).json({ error: 'companyId inválido' });
  }

  try {
    const [rows] = await pool.query(
      `SELECT id, company_id, \`user\`, description, created_at
       FROM transaction_history
       WHERE company_id = ?
       ORDER BY created_at DESC, id DESC`,
      [companyId]
    );

    return res.json(rows);
  } catch (e) {
    return res.status(500).json({
      error: 'Error al consultar historial de transacciones',
      details: (e as Error).message,
    });
  }
});

/**
 * POST /transaction-history
 */
router.post('/', async (req, res) => {
  const companyId = toPositiveInt(req.body?.company_id);
  const description = norm(req.body?.description);
  const currentUser = resolveCurrentUser(req);

  if (!companyId) {
    return res.status(400).json({ error: 'company_id es obligatorio' });
  }
  if (!description) {
    return res.status(400).json({ error: 'description es obligatoria' });
  }

  try {
    const [result] = await pool.query<ResultSetHeader>(
      `INSERT INTO transaction_history (company_id, \`user\`, description)
       VALUES (?, ?, ?)`,
      [companyId, currentUser, description]
    );

    const insertId = Number((result as ResultSetHeader).insertId || 0);
    const [rows] = await pool.query(
      `SELECT id, company_id, \`user\`, description, created_at
       FROM transaction_history
       WHERE id = ?
       LIMIT 1`,
      [insertId]
    );

    return res.status(201).json((rows as any[])[0] ?? { id: insertId });
  } catch (e) {
    if (isForeignKeyError(e)) {
      return res.status(400).json({ error: 'Empresa no encontrada' });
    }
    return res.status(500).json({
      error: 'Error al crear transacción',
      details: (e as Error).message,
    });
  }
});

/**
 * PUT /transaction-history/:companyId/:transactionId
 */
router.put('/:companyId/:transactionId', async (req, res) => {
  const companyId = toPositiveInt(req.params.companyId);
  const transactionId = toPositiveInt(req.params.transactionId);
  const description = norm(req.body?.description);

  if (!companyId || !transactionId) {
    return res.status(400).json({ error: 'id inválido' });
  }
  if (!description) {
    return res.status(400).json({ error: 'description es obligatoria' });
  }

  try {
    const [result] = await pool.query<ResultSetHeader>(
      `UPDATE transaction_history
       SET description = ?
       WHERE id = ? AND company_id = ?`,
      [description, transactionId, companyId]
    );

    if ((result as ResultSetHeader).affectedRows === 0) {
      return res.status(404).json({ error: 'Transacción no encontrada' });
    }

    return res.json({ message: 'Transacción actualizada' });
  } catch (e) {
    return res.status(500).json({
      error: 'Error al actualizar transacción',
      details: (e as Error).message,
    });
  }
});

/**
 * DELETE /transaction-history/:companyId/:transactionId
 */
router.delete('/:companyId/:transactionId', async (req, res) => {
  const companyId = toPositiveInt(req.params.companyId);
  const transactionId = toPositiveInt(req.params.transactionId);

  if (!companyId || !transactionId) {
    return res.status(400).json({ error: 'id inválido' });
  }

  try {
    const [result] = await pool.query<ResultSetHeader>(
      'DELETE FROM transaction_history WHERE id = ? AND company_id = ?',
      [transactionId, companyId]
    );

    if ((result as ResultSetHeader).affectedRows === 0) {
      return res.status(404).json({ error: 'Transacción no encontrada' });
    }

    return res.json({ message: 'Transacción eliminada' });
  } catch (e) {
    return res.status(500).json({
      error: 'Error al eliminar transacción',
      details: (e as Error).message,
    });
  }
});

export default router;
