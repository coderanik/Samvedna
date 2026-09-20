import type { User } from "@supabase/supabase-js";
import type { UserRole } from "@samvedna/shared-types";

/** Product homes. Officials land on district/state ops dashboard. */
export const ROLE_HOME: Record<UserRole, string> = {
  victim: "/victim/dashboard",
  counsellor: "/counselor/cases",
  official: "/official/dashboard",
  admin: "/admin",
};

const ACTIVE_ROLES = new Set<UserRole>(["victim", "counsellor", "official", "admin"]);

export function isDeprecatedRole(_role: UserRole | null | undefined): boolean {
  return false;
}

/** Resolve role from profile row, then JWT metadata, then default victim. */
export function resolveUserRole(
  user: User,
  profile: { role?: string } | null | undefined
): UserRole {
  const fromProfile = profile?.role as UserRole | undefined;
  if (fromProfile && ACTIVE_ROLES.has(fromProfile)) return fromProfile;

  const fromMeta = user.user_metadata?.role as UserRole | undefined;
  if (fromMeta && ACTIVE_ROLES.has(fromMeta)) return fromMeta;

  return "victim";
}

export function homeForRole(role: UserRole): string {
  return ROLE_HOME[role] ?? ROLE_HOME.victim;
}
