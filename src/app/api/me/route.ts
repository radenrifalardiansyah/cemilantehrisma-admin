import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { FieldValue } from 'firebase-admin/firestore';
import { getAuthUser, unauthorized } from '@/lib/admin-auth';
import { getDb } from '@/lib/firebase-admin';
import { fullAccessPermissions } from '@/lib/permissions';
import type { Action } from '@/types/rbac';

export async function GET(req: NextRequest) {
  const authUser = getAuthUser(req);
  if (!authUser) return unauthorized();

  const superAdmin = authUser.role === 'super-admin';
  const db = getDb();
  const [permsDoc, userDoc] = await Promise.all([
    superAdmin ? null : db.collection('role_permissions').doc(authUser.role).get(),
    db.collection('users').doc(authUser.username).get(),
  ]);
  const permissions: Record<string, Partial<Record<Action, boolean>>> = superAdmin
    ? fullAccessPermissions()
    : (permsDoc!.data()?.permissions as Record<string, Partial<Record<Action, boolean>>>) ?? {};

  const userData = userDoc.data() as { email?: string | null; avatar?: string | null } | undefined;
  const user = { ...authUser, email: userData?.email ?? null, avatar: userData?.avatar ?? null };

  return Response.json({ ok: true, user, superAdmin, permissions });
}

export async function PATCH(req: NextRequest) {
  const authUser = getAuthUser(req);
  if (!authUser) return unauthorized();

  const { email, avatar, currentPassword, newPassword } = await req.json() as {
    email?: string; avatar?: string | null; currentPassword?: string; newPassword?: string;
  };

  const db  = getDb();
  const ref = db.collection('users').doc(authUser.username);

  const patch: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
  if (email !== undefined) patch.email = email ? email.trim().toLowerCase() : null;
  if (avatar !== undefined) patch.avatar = avatar || null;

  if (newPassword) {
    if (!currentPassword) {
      return Response.json({ error: 'Masukkan password saat ini untuk mengubah password.' }, { status: 400 });
    }
    const doc = await ref.get();
    const passwordHash = doc.data()?.passwordHash as string | undefined;
    const valid = passwordHash && await bcrypt.compare(currentPassword, passwordHash);
    if (!valid) {
      return Response.json({ error: 'Password saat ini salah.' }, { status: 400 });
    }
    patch.passwordHash = await bcrypt.hash(newPassword, 10);
  }

  await ref.update(patch);
  return Response.json({ ok: true, email: patch.email, avatar: patch.avatar });
}
