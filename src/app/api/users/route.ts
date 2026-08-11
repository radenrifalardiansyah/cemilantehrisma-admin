import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { getDb } from '@/lib/firebase-admin';
import { requirePermission } from '@/lib/rbac';
import { FieldValue } from 'firebase-admin/firestore';

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'users', 'view');
  if (guard instanceof Response) return guard;

  const db = getDb();
  const snap = await db.collection('users').get();
  const users = snap.docs.map(d => {
    const { username, email, role, createdAt } =
      d.data() as { username: string; email?: string; role: string; createdAt: unknown };
    return { username, email: email ?? null, role, createdAt };
  });
  return Response.json({ users });
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'users', 'create');
  if (guard instanceof Response) return guard;

  const { username, password, email, role } =
    await req.json() as { username: string; password: string; email?: string; role: string };

  if (!username || !password || !role) {
    return Response.json({ error: 'Username, password, dan role wajib diisi.' }, { status: 400 });
  }

  const db = getDb();
  const roleDoc = await db.collection('roles').doc(role).get();
  if (!roleDoc.exists) {
    return Response.json({ error: `Role "${role}" tidak ditemukan.` }, { status: 400 });
  }

  const id = username.toLowerCase();
  const ref = db.collection('users').doc(id);
  if ((await ref.get()).exists) {
    return Response.json({ error: `User "${id}" sudah ada.` }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await ref.set({
    username: id,
    email: email ? email.trim().toLowerCase() : null,
    passwordHash,
    role,
    createdAt: FieldValue.serverTimestamp(),
  });
  return Response.json({ username: id, email: email ?? null, role });
}
