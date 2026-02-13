import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

router.post("/login", async (req, res) => {
  const { username, password } = req.body as { username?: string; password?: string };

  const u = (username || "").toString().trim();
  const p = (password || "").toString();

  if (!u || !p) {
    return res.status(400).json({ error: "username and password are required" });
  }

  if (u !== env.ADMIN_USERNAME) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  if (!env.ADMIN_PASSWORD && !env.ADMIN_PASSWORD_HASH) {
    return res.status(500).json({ error: "Admin password is not configured" });
  }

  const ok = env.ADMIN_PASSWORD_HASH
    ? bcrypt.compareSync(p, env.ADMIN_PASSWORD_HASH)
    : p === env.ADMIN_PASSWORD;

  if (!ok) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const token = jwt.sign({ sub: env.ADMIN_USERNAME, role: "admin" }, env.JWT_SECRET, {
    expiresIn: `${env.AUTH_SESSION_HOURS}h`,
  });

  res.cookie(env.AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: env.AUTH_SESSION_HOURS * 60 * 60 * 1000,
  });

  return res.json({ ok: true, user: { username: env.ADMIN_USERNAME, role: "admin" } });
});

router.post("/logout", async (_req, res) => {
  res.clearCookie(env.AUTH_COOKIE_NAME, { path: "/" });
  return res.json({ ok: true });
});

router.get("/me", requireAuth, async (req, res) => {
  return res.json({ user: (req as any).user });
});

export default router;
