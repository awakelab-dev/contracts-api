import * as dotenv from 'dotenv';
dotenv.config();
export const env = {
  PORT: parseInt(process.env.PORT || '4000', 10),
  JWT_SECRET: process.env.JWT_SECRET || 'change-me',
  DB_HOST: process.env.DB_HOST || 'localhost',
  DB_USER: process.env.DB_USER || 'root',
  DB_PASSWORD: process.env.DB_PASSWORD || '',
  DB_NAME: process.env.DB_NAME || 'contracts_app',
  DB_PORT: parseInt(process.env.DB_PORT || '3306', 10),
};
