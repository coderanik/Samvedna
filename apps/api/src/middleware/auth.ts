import { Request, Response, NextFunction } from "express";
import { supabaseAdmin } from "../lib/supabase";
import type { UserRole } from "@samvedna/shared-types";
import { demoUserFromToken, isDemoFallback } from "../demo/data";

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
  user_metadata?: Record<string, unknown>;
  full_name?: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or invalid authorization header" });
  }

  const token = header.slice(7);

  if (token.startsWith("demo.")) {
    if (!isDemoFallback()) {
      return res.status(401).json({ error: "Demo session is disabled" });
    }
    const demoUser = demoUserFromToken(token);
    if (!demoUser) {
      return res.status(401).json({ error: "Unknown demo session" });
    }
    req.user = {
      id: demoUser.id,
      email: demoUser.email,
      role: demoUser.role,
      full_name: demoUser.full_name,
      user_metadata: { role: demoUser.role, full_name: demoUser.full_name },
    };
    return next();
  }

  try {
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data.user) {
      return res.status(401).json({ error: "Invalid or expired token" });
    }

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("role, full_name")
      .eq("id", data.user.id)
      .single();

    if (!profile) {
      return res.status(403).json({ error: "Profile not found" });
    }

    req.user = {
      id: data.user.id,
      email: data.user.email ?? "",
      role: profile.role as UserRole,
      user_metadata: (data.user.user_metadata ?? {}) as Record<string, unknown>,
      full_name: profile.full_name ?? undefined,
    };

    next();
  } catch {
    return res.status(401).json({ error: "Authentication failed" });
  }
}

export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    next();
  };
}
