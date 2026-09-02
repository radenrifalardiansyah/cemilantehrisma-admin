import jwt from 'jsonwebtoken';

// uid: Firebase Auth localId — only present on tokens issued after the Firebase Auth login
// migration; used by self-service password change. Optional so older still-valid 7-day tokens
// issued before this field existed keep working (just without change-password access).
// mustChangePassword: baked into the token itself at sign time (not just the one-time login
// response) so every subsequent request carries it — see requirePermission/requireSuperAdmin/
// requireAdminOrSuperAdmin in rbac.ts, which refuse to act on a token still flagged this way.
// iat: standard JWT "issued at" (unix seconds) — added automatically by jsonwebtoken at sign
// time, not something we set ourselves. Used by rbac.ts's session-revocation check: comparing
// this against `users/{username}.sessionsInvalidatedAt` lets a role change / forced password
// reset / account deletion kill an already-issued 7-day token without needing a token blacklist.
export type AuthUser = { username: string; role: string; uid?: string; mustChangePassword?: boolean; iat?: number };

export function getAuthUser(request: Request): AuthUser | null {
  const token = request.headers.get('x-admin-auth') ?? '';
  if (!token) return null;
  try {
    return jwt.verify(token, process.env.JWT_SECRET!) as AuthUser;
  } catch {
    return null;
  }
}

// Only a same-or-lesser gate than requirePermission/requireSuperAdmin: still blocks a
// not-yet-changed temporary password, since the routes using this (seed, upload) are
// mutating/admin-ish and must not be reachable on a token that hasn't completed that flow.
export function validateAdminAuth(request: Request): boolean {
  const user = getAuthUser(request);
  return user !== null && !user.mustChangePassword;
}

export function unauthorized() {
  return Response.json({ error: 'Unauthorized' }, { status: 401 });
}

export function passwordChangeRequired() {
  return Response.json({ error: 'Anda harus mengganti password sementara sebelum melanjutkan.' }, { status: 403 });
}
