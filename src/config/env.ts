import * as dotenv from 'dotenv';

dotenv.config();

export const env = {
  PORT: parseInt(process.env.PORT || '4000', 10),
  NODE_ENV: process.env.NODE_ENV || 'development',

  // Auth
  JWT_SECRET: process.env.JWT_SECRET || 'change-me',
  ADMIN_USERNAME: process.env.ADMIN_USERNAME || 'admin',
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || '',
  ADMIN_PASSWORD_HASH: process.env.ADMIN_PASSWORD_HASH || '',
  AUTH_COOKIE_NAME: process.env.AUTH_COOKIE_NAME || 'contracts_session',
  AUTH_SESSION_HOURS: parseInt(process.env.AUTH_SESSION_HOURS || '8', 10),

  // CORS
  CORS_ORIGIN: process.env.CORS_ORIGIN || 'http://localhost:5173',

  DB_HOST: process.env.DB_HOST || 'localhost',
  DB_USER: process.env.DB_USER || 'root',
  DB_PASSWORD: process.env.DB_PASSWORD || '',
  DB_NAME: process.env.DB_NAME || 'contracts_app',
  DB_PORT: parseInt(process.env.DB_PORT || '3306', 10),

  // OpenAI (para Matching IA)
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
  OPENAI_MATCH_MODEL: process.env.OPENAI_MATCH_MODEL || 'gpt-4o-mini',
  OPENAI_MATCH_PROMPT_VERSION: parseInt(process.env.OPENAI_MATCH_PROMPT_VERSION || '1', 10),
};
