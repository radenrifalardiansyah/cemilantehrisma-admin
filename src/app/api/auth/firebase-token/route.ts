import { NextRequest } from 'next/server';
import jwt from 'jsonwebtoken';
import { getAuthUser, unauthorized } from '@/lib/admin-auth';

// Auth admin panel pakai JWT custom (header x-admin-auth), bukan Firebase Auth — endpoint ini
// menjembataninya: mint Firebase custom token untuk user yang sudah tervalidasi JWT-nya, supaya
// client bisa sign-in ke Firebase dan mendengarkan koleksi `notifications` secara realtime
// (lihat firestore.rules: read notifications butuh request.auth != null).
//
// Sengaja TIDAK pakai firebase-admin/auth (createCustomToken) — modul itu menarik jwks-rsa -> jose
// (ESM) yang gagal di-bundle Turbopack di server Vercel (ERR_REQUIRE_ESM), dan karena error itu
// terjadi saat modul di-load, itu ikut menjatuhkan SEMUA route lain yang re-export dari file yang
// sama. Format custom token Firebase terdokumentasi publik & cukup ditandatangani manual pakai
// `jsonwebtoken` (RS256 + private_key service account) — hasilnya identik dengan yang dibuat SDK.
export async function GET(req: NextRequest) {
  const user = getAuthUser(req);
  if (!user) return unauthorized();

  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT ?? '{}') as { client_email: string; private_key: string };
  const now = Math.floor(Date.now() / 1000);
  const token = jwt.sign(
    {
      iss: sa.client_email,
      sub: sa.client_email,
      aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
      iat: now,
      exp: now + 3600,
      uid: user.username,
      claims: { role: user.role },
    },
    sa.private_key,
    { algorithm: 'RS256' },
  );

  return Response.json({ token });
}
