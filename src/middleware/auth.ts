import type { Request, Response, NextFunction } from "express";
import jwt from 'jsonwebtoken';
import { env } from '../config/env';

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const auth = (req.headers['authorization'] || '').toString();
  const token = auth.replace('Bearer ', '');
  try {
    (req as any).user = jwt.verify(token, env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}
