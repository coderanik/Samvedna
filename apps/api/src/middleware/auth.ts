import { Request, Response, NextFunction } from "express";
import { supabaseAdmin } from "../lib/supabase";
import type { UserRole } from "@samvedna/shared-types";

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
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
