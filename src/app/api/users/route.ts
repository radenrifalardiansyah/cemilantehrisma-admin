import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { requirePermission } from '@/lib/rbac';
import { FieldValue } from 'firebase-admin/firestore';
import { deriveLoginEmail, createFirebaseAuthUser, setFirebaseAuthClaims } from '@/lib/firebase-auth-rest';

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

  // Akun baru dibuat langsung di Firebase Auth (bukan bcrypt+Firestore lagi) — konsisten dengan
  // akun lama yang sudah dimigrasikan, sekaligus supaya password awal yang diset admin di sini
  // wajib diganti sendiri oleh pemiliknya (mustChangePassword), sama seperti alur migrasi.
  const created = await createFirebaseAuthUser(deriveLoginEmail(id), password);
  if ('error' in created) {
    return Response.json({ error: `Gagal membuat akun otentikasi: ${created.error}` }, { status: 500 });
  }
  const claimsResult = await setFirebaseAuthClaims(created.localId, { role, username: id, mustChangePassword: true });
  if (!claimsResult.ok) {
    return Response.json({ error: `Akun dibuat tapi gagal set klaim akses: ${claimsResult.error}` }, { status: 500 });
  }

  await ref.set({
    username: id,
    email: email ? email.trim().toLowerCase() : null,
    firebaseUid: created.localId,
    role,
    createdAt: FieldValue.serverTimestamp(),
  });
  return Response.json({ username: id, email: email ?? null, role });
}
