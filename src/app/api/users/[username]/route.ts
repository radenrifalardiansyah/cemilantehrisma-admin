import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { getDb } from '@/lib/firebase-admin';
import { requirePermission, assertCanEditUser, assertCanDeleteUser } from '@/lib/rbac';
import { FieldValue } from 'firebase-admin/firestore';
import { adminSetPassword, setFirebaseAuthClaims, deleteFirebaseAuthUser } from '@/lib/firebase-auth-rest';

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

  const userRef = db.collection('users').doc(username);
  const userDoc = await userRef.get();
  const firebaseUid = userDoc.data()?.firebaseUid as string | undefined;
  const effectiveRole = role ?? (userDoc.data()?.role as string | undefined) ?? '';

  const patch: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
  if (email !== undefined) patch.email = email ? email.trim().toLowerCase() : null;
  if (role) patch.role = role;

  if (firebaseUid) {
    // Role dan password akun yang sudah dimigrasikan hidup di custom claim Firebase Auth, bukan
    // cuma di Firestore — kalau tidak disinkronkan di sini, requirePermission (yang baca claim
    // lewat JWT hasil login) akan tetap pakai role lama sampai user login ulang, dan admin reset
    // password lewat sini tidak akan benar-benar mengubah password aslinya.
    if (password) {
      const result = await adminSetPassword(firebaseUid, password, { role: effectiveRole, username, mustChangePassword: true });
      if (!result.ok) return Response.json({ error: `Gagal reset password: ${result.error}` }, { status: 500 });
    } else if (role) {
      const result = await setFirebaseAuthClaims(firebaseUid, { role: effectiveRole, username, mustChangePassword: false });
      if (!result.ok) return Response.json({ error: `Gagal sinkron role ke akun otentikasi: ${result.error}` }, { status: 500 });
    }
  } else if (password) {
    // Belum dimigrasikan — masih pakai bcrypt+Firestore lama.
    patch.passwordHash = await bcrypt.hash(password, 10);
  }

  await userRef.update(patch);
  return Response.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'users', 'delete');
  if (guard instanceof Response) return guard;
  const { username } = await ctx.params;

  const check = assertCanDeleteUser(guard, username);
  if (!check.ok) return Response.json({ error: check.error }, { status: 400 });

  const ref = getDb().collection('users').doc(username);
  const doc = await ref.get();
  const firebaseUid = doc.data()?.firebaseUid as string | undefined;
  if (firebaseUid) {
    const result = await deleteFirebaseAuthUser(firebaseUid);
    if (!result.ok) return Response.json({ error: `Gagal menghapus akun otentikasi: ${result.error}` }, { status: 500 });
  }

  await ref.delete();
  return Response.json({ ok: true });
}
