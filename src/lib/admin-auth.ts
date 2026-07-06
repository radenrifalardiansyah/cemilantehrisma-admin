import jwt from 'jsonwebtoken';

export type AuthUser = { username: string; role: string };

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
