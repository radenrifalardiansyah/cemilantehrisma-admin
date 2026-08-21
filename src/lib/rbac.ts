import { unstable_cache } from 'next/cache';
import { getDb } from '@/lib/firebase-admin';
import { getAuthUser, unauthorized, type AuthUser } from '@/lib/admin-auth';
import type { Action } from '@/types/rbac';

export const ROLE_PERMISSIONS_TAG = 'role-permissions';

export function forbidden() {
  return Response.json({ error: 'Anda tidak memiliki akses untuk aksi ini.' }, { status: 403 });
}

type PermissionsMap = Record<string, Partial<Record<Action, boolean>>>;

export async function hasPermission(
  user: AuthUser,
  featureKey: string | string[],
  action: Action,
): Promise<boolean> {
  if (user.role === 'super-admin') return true;
  const permissions = await getRolePermissionsMap(user.role);
  return checkPermission(permissions, featureKey, action);
}

// Split out of hasPermission for callers that need to check MANY featureKeys for the same
// role in one request (e.g. GET /api/menus filtering the whole menu tree) — fetching the
// role_permissions doc once and checking in-memory instead of once per featureKey turns an
// N-item sequential Firestore round trip into a single read.
//
// Cached: this runs on nearly every authenticated API call (requirePermission is used across
// ~150 routes), so an uncached read here roughly doubled the app's total Firestore read volume.
// Role matrices change rarely, so a short TTL is safe; role-permissions/[roleId] PUT and
// roles/[id] DELETE call revalidateTag(ROLE_PERMISSIONS_TAG) so edits still apply immediately
// instead of waiting out the TTL.
export const getRolePermissionsMap = unstable_cache(
  async (role: string): Promise<PermissionsMap | null> => {
    const doc = await getDb().collection('role_permissions').doc(role).get();
    return (doc.data()?.permissions as PermissionsMap | undefined) ?? null;
  },
  ['role-permissions-map'],
  { revalidate: 30, tags: [ROLE_PERMISSIONS_TAG] },
);

export function checkPermission(
  permissions: PermissionsMap | null,
  featureKey: string | string[],
  action: Action,
): boolean {
  if (!permissions) return false;
  const keys = Array.isArray(featureKey) ? featureKey : [featureKey];
  return keys.some(k => permissions[k]?.[action] === true);
}

// One-line route guard: returns the AuthUser on success, or a Response to
// `return` immediately on failure (401 not logged in, 403 lacks permission).
export async function requirePermission(
  req: Request,
  featureKey: string | string[],
  action: Action,
): Promise<AuthUser | Response> {
  const user = getAuthUser(req);
  if (!user) return unauthorized();
  if (!(await hasPermission(user, featureKey, action))) return forbidden();
  return user;
}

// Route guard for RMedia's own internal tooling (Biaya Admin) — deliberately bypasses
// hasPermission/role_permissions entirely, unlike requirePermission. That matrix is editable
// via the Hak Akses Role UI, so routing this through a featureKey would let `admin` be granted
// access; this must stay impossible regardless of how the matrix is configured.
export function requireSuperAdmin(req: Request): AuthUser | Response {
  const user = getAuthUser(req);
  if (!user) return unauthorized();
  if (user.role !== 'super-admin') return forbidden();
  return user;
}

// Same hardcoded-bypass reasoning as requireSuperAdmin, but also lets `admin` through — used by
// the Biaya Admin routes that `admin` (the business owner being billed) needs to read/act on:
// viewing invoices raised against them and marking one paid. Creating invoices and setting rates
// stays requireSuperAdmin-only.
export function requireAdminOrSuperAdmin(req: Request): AuthUser | Response {
  const user = getAuthUser(req);
  if (!user) return unauthorized();
  if (user.role !== 'super-admin' && user.role !== 'admin') return forbidden();
  return user;
}

// ─── Hardcoded self-escalation guards ──────────────────────────────────────
// These hold regardless of what a role's permission matrix says — a
// misconfigured matrix must never be able to grant either of these.

export function assertCanEditUser(
  actingUser: AuthUser,
  targetUsername: string,
  patch: { role?: string },
): { ok: true } | { ok: false; error: string } {
  if (patch.role !== undefined && actingUser.username === targetUsername) {
    return { ok: false, error: 'Anda tidak dapat mengubah role Anda sendiri.' };
  }
  if (patch.role === 'super-admin' && actingUser.role !== 'super-admin') {
    return { ok: false, error: 'Hanya Super Admin yang dapat menetapkan role Super Admin.' };
  }
  return { ok: true };
}

export function assertCanDeleteUser(
  actingUser: AuthUser,
  targetUsername: string,
): { ok: true } | { ok: false; error: string } {
  if (actingUser.username === targetUsername) {
    return { ok: false, error: 'Anda tidak dapat menghapus akun Anda sendiri.' };
  }
  return { ok: true };
}
