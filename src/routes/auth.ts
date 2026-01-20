import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';

const router = Router();

router.post('/login', async (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };
  const token = jwt.sign({ sub: email, role: 'admin' }, env.JWT_SECRET, { expiresIn: '8h' });
  res.json({ token });
});

export default router;
