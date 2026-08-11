import { NextRequest } from 'next/server';
import { getAuthUser, unauthorized } from '@/lib/admin-auth';
import { getDb } from '@/lib/firebase-admin';
import { fullAccessPermissions } from '@/lib/permissions';
import type { Action } from '@/types/rbac';

export async function GET(req: NextRequest) {
  const user = getAuthUser(req);
  if (!user) return unauthorized();

  const superAdmin = user.role === 'super-admin';
  let permissions: Record<string, Partial<Record<Action, boolean>>>;
  if (superAdmin) {
    permissions = fullAccessPermissions();
  } else {
    const doc = await getDb().collection('role_permissions').doc(user.role).get();
    permissions = (doc.data()?.permissions as Record<string, Partial<Record<Action, boolean>>>) ?? {};
  }

  return Response.json({ ok: true, user, superAdmin, permissions });
}
