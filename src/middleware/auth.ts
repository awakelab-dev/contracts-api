import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  if (!cookieHeader) return {};
  const out: Record<string, string> = {};

  // Very small cookie parser (no dependency)
  // cookieHeader: "a=1; b=2"
  for (const part of cookieHeader.split(";")) {
    const [rawKey, ...rawValParts] = part.trim().split("=");
    if (!rawKey) continue;
    const rawVal = rawValParts.join("=");
    out[rawKey] = decodeURIComponent(rawVal || "");
  }

  return out;
}

function getAuthToken(req: Request): string | null {
  // 1) httpOnly cookie
  const cookies = parseCookies(req.headers.cookie);
  const cookieToken = cookies[env.AUTH_COOKIE_NAME];
  if (cookieToken) return cookieToken;

  // 2) Authorization: Bearer <token>
  const auth = (req.headers["authorization"] || "").toString();
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (m && m[1]) return m[1].trim();

  return null;
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  // Let CORS middleware answer preflights
  if (req.method === "OPTIONS") return next();

  const token = getAuthToken(req);
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  try {
    (req as any).user = jwt.verify(token, env.JWT_SECRET);
    return next();
  } catch {
    return res.status(401).json({ error: "Unauthorized" });
  }
}
