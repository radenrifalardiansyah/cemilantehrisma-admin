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

// Masa berlaku token sesi admin. Sesi diperpanjang otomatis (sliding) lewat /api/auth/refresh
// selama aplikasi dipakai — lihat useSessionRefresh di page.tsx — jadi pengguna praktis hanya
// logout kalau logout manual, atau tidak membuka aplikasi selama masa ini. Dulu 7 hari tanpa
// perpanjangan, sehingga semua perangkat otomatis logout tepat seminggu setelah login.
// Pencabutan sesi (kick admin, ganti password/role, akun dihapus) TIDAK bergantung pada masa
// berlaku ini — tetap langsung berlaku lewat sessions_invalidated_at (lihat rbac.ts).
export const ADMIN_SESSION_TTL = '365d';

// Satu-satunya tempat menandatangani token sesi admin. Field bawaan JWT (iat/exp) dari token lama
// sengaja dibuang supaya jsonwebtoken mengisi ulang iat = sekarang dan exp sesuai TTL.
export function signAdminToken(user: AuthUser): string {
  const payload: AuthUser = { username: user.username, role: user.role, uid: user.uid, mustChangePassword: user.mustChangePassword };
  return jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn: ADMIN_SESSION_TTL });
}

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
