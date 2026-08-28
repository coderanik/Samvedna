import type { User } from "@supabase/supabase-js";
import type { UserRole } from "@samvedna/shared-types";

export const ROLE_HOME: Record<UserRole, string> = {
  victim: "/victim/checkin",
  counsellor: "/counsellor/cases",
  official: "/official/dashboard",
  admin: "/admin",
};

/** Resolve role from profile row, then JWT metadata, then default victim. */
export function resolveUserRole(
  user: User,
  profile: { role?: string } | null | undefined
): UserRole {
  const fromProfile = profile?.role as UserRole | undefined;
  if (fromProfile && fromProfile in ROLE_HOME) return fromProfile;

  const fromMeta = user.user_metadata?.role as UserRole | undefined;
  if (fromMeta && fromMeta in ROLE_HOME) return fromMeta;

  return "victim";
}

export function homeForRole(role: UserRole): string {
  return ROLE_HOME[role] ?? ROLE_HOME.victim;
}
