import mysql from 'mysql2/promise';
import { env } from '../config/env';

export const pool = mysql.createPool({
  host: env.DB_HOST,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  database: env.DB_NAME,
  port: env.DB_PORT,
  connectionLimit: 10,
  charset: 'utf8mb4',
  timezone: '+00:00',
});

export async function ping() {
  const [rows] = await pool.query('SELECT 1 AS ok');
  return rows;
}
