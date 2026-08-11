import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { requirePermission } from '@/lib/rbac';

// Returns every role's permission matrix in one call, so the Hak Akses Role
// screen can load the whole picture (role selector + matrix) without N+1 fetches.
export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'role-permissions', 'view');
  if (guard instanceof Response) return guard;

  const snap = await getDb().collection('role_permissions').get();
  const rolePermissions: Record<string, Record<string, Partial<Record<string, boolean>>>> = {};
  snap.docs.forEach(d => {
    rolePermissions[d.id] = (d.data().permissions as Record<string, Partial<Record<string, boolean>>>) ?? {};
  });
  return Response.json({ rolePermissions });
}
