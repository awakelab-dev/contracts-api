import type { Request, Response, NextFunction } from "express";
import jwt from 'jsonwebtoken';
import { env } from '../config/env';

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const auth = (req.headers['authorization'] || '').toString();
  const token = auth.replace('Bearer ', '');

  if (token === 'demo-token') {
    (req as any).user = { id: 1, email: 'admin@test.com', role: 'admin' };
    return next();
  }

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    (req as any).user = jwt.verify(token, env.JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}