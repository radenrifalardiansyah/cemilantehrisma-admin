import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { getDb } from '@/lib/firebase-admin';
import { requirePermission, assertCanEditUser, assertCanDeleteUser } from '@/lib/rbac';
import { FieldValue } from 'firebase-admin/firestore';

type Ctx = { params: Promise<{ username: string }> };

export async function PUT(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'users', 'edit');
  if (guard instanceof Response) return guard;
  const { username } = await ctx.params;

  const { email, role, password } =
    await req.json() as { email?: string; role?: string; password?: string };

  const check = assertCanEditUser(guard, username, { role });
  if (!check.ok) return Response.json({ error: check.error }, { status: 400 });

  const db = getDb();
  if (role) {
    const roleDoc = await db.collection('roles').doc(role).get();
    if (!roleDoc.exists) return Response.json({ error: `Role "${role}" tidak ditemukan.` }, { status: 400 });
  }

  const patch: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
  if (email !== undefined) patch.email = email ? email.trim().toLowerCase() : null;
  if (role) patch.role = role;
  if (password) patch.passwordHash = await bcrypt.hash(password, 10);

  await db.collection('users').doc(username).update(patch);
  return Response.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'users', 'delete');
  if (guard instanceof Response) return guard;
  const { username } = await ctx.params;

  const check = assertCanDeleteUser(guard, username);
  if (!check.ok) return Response.json({ error: check.error }, { status: 400 });

  await getDb().collection('users').doc(username).delete();
  return Response.json({ ok: true });
}
