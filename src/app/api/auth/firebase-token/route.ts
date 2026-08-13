import { NextRequest } from 'next/server';
import { getAuthUser, unauthorized } from '@/lib/admin-auth';
import { getFirebaseAuth } from '@/lib/firebase-admin';

// Auth admin panel pakai JWT custom (header x-admin-auth), bukan Firebase Auth — endpoint ini
// menjembataninya: mint Firebase custom token untuk user yang sudah tervalidasi JWT-nya, supaya
// client bisa sign-in ke Firebase dan mendengarkan koleksi `notifications` secara realtime
// (lihat firestore.rules: read notifications butuh request.auth != null).
export async function GET(req: NextRequest) {
  const user = getAuthUser(req);
  if (!user) return unauthorized();

  const token = await getFirebaseAuth().createCustomToken(user.username, { role: user.role });
  return Response.json({ token });
}
