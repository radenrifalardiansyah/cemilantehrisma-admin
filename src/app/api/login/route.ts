import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { getDb } from '@/lib/firebase-admin';
import type { QueryDocumentSnapshot, DocumentSnapshot } from 'firebase-admin/firestore';

export async function POST(req: NextRequest) {
  const { username, password } = await req.json() as { username: string; password: string };
  if (!username || !password) {
    return Response.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  const db = getDb();
  const identifier = username.trim().toLowerCase();

  let snap: QueryDocumentSnapshot | DocumentSnapshot | undefined;
  if (identifier.includes('@')) {
    const q = await db.collection('users').where('email', '==', identifier).limit(1).get();
    snap = q.docs[0];
  } else {
    const doc = await db.collection('users').doc(identifier).get();
    snap = doc.exists ? doc : undefined;
  }
  if (!snap) {
    return Response.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  const data = snap.data() as { passwordHash: string; role: string };
  const valid = await bcrypt.compare(password, data.passwordHash);
  if (!valid) {
    return Response.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  const user = { username: snap.id, role: data.role };
  const token = jwt.sign(user, process.env.JWT_SECRET!, { expiresIn: '7d' });

  return Response.json({ ok: true, token, user });
}
