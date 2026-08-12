import { getDb } from '@/lib/firebase-admin';
import { getAuthUser, unauthorized, type AuthUser } from '@/lib/admin-auth';
import type { Action } from '@/types/rbac';

export function forbidden() {
  return Response.json({ error: 'Anda tidak memiliki akses untuk aksi ini.' }, { status: 403 });
}

export async function hasPermission(
  user: AuthUser,
  featureKey: string | string[],
  action: Action,
): Promise<boolean> {
  if (user.role === 'super-admin') return true;
  const keys = Array.isArray(featureKey) ? featureKey : [featureKey];
  const doc = await getDb().collection('role_permissions').doc(user.role).get();
  const permissions = doc.data()?.permissions as Record<string, Partial<Record<Action, boolean>>> | undefined;
  if (!permissions) return false;
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
