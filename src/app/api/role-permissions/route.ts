import { NextRequest } from 'next/server';
import { getSql, parseJsonb } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';

// Returns every role's permission matrix in one call, so the Hak Akses Role
// screen can load the whole picture (role selector + matrix) without N+1 fetches.
export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'role-permissions', 'view');
  if (guard instanceof Response) return guard;

  const sql = getSql();
  const rows = await sql<{ role: string; permissions: Record<string, Partial<Record<string, boolean>>> | string }[]>`
    select role, permissions from role_permissions
  `;
  const rolePermissions: Record<string, Record<string, Partial<Record<string, boolean>>>> = {};
  rows.forEach(r => { rolePermissions[r.role] = parseJsonb(r.permissions) ?? {}; });
  return Response.json({ rolePermissions });
}
