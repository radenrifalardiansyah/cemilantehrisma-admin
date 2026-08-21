import jwt from 'jsonwebtoken';

// uid: Firebase Auth localId — only present on tokens issued after the Firebase Auth login
// migration; used by self-service password change. Optional so older still-valid 7-day tokens
// issued before this field existed keep working (just without change-password access).
export type AuthUser = { username: string; role: string; uid?: string };

export function getAuthUser(request: Request): AuthUser | null {
  const token = request.headers.get('x-admin-auth') ?? '';
  if (!token) return null;
  try {
    return jwt.verify(token, process.env.JWT_SECRET!) as AuthUser;
  } catch {
    return null;
  }
}

export function validateAdminAuth(request: Request): boolean {
  return getAuthUser(request) !== null;
}

export function unauthorized() {
  return Response.json({ error: 'Unauthorized' }, { status: 401 });
}
