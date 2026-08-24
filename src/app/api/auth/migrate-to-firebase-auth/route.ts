import { NextRequest } from 'next/server';
import { randomBytes } from 'crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { getDb } from '@/lib/firebase-admin';
import { requireSuperAdmin } from '@/lib/rbac';
import {
  deriveLoginEmail, createFirebaseAuthUser, setFirebaseAuthClaims,
} from '@/lib/firebase-auth-rest';

// Password sementara UNIK per akun — sebelumnya satu string hardcoded dipakai untuk semua akun,
// yang berarti siapa pun dengan akses ke source code bisa menghitung email login (deriveLoginEmail)
// dan langsung masuk sebagai akun manapun yang sudah dimigrasi tapi belum sempat login ulang
// (termasuk super-admin). mustChangePassword=true tetap memaksa ganti password di login pertama,
// tapi itu bukan pengganti yang layak untuk kerahasiaan password sementara itu sendiri.
function generateTempPassword(): string {
  return randomBytes(9).toString('base64url'); // 12 char, aman utk password sementara sekali pakai
}

// One-time (but safe to re-run — idempotent via the `firebaseUid` field) migration: creates a
// Firebase Auth account for every existing Firestore user that doesn't have one yet, with the
// shared temp password above and mustChangePassword=true.
export async function POST(req: NextRequest) {
  const guard = await requireSuperAdmin(req);
  if (guard instanceof Response) return guard;

  const db = getDb();
  const snap = await db.collection('users').get();

  const migrated: { username: string; tempPassword: string }[] = [];
  const skipped: string[] = [];
  const failed: { username: string; error: string }[] = [];

  for (const doc of snap.docs) {
    const username = doc.id;
    const data = doc.data() as { role?: string; firebaseUid?: string };
    if (data.firebaseUid) { skipped.push(username); continue; }

    const email = deriveLoginEmail(username);
    const tempPassword = generateTempPassword();
    const created = await createFirebaseAuthUser(email, tempPassword);

    if ('error' in created) {
      if (created.error === 'EMAIL_EXISTS') {
        // Sudah ada di Firebase Auth (mis. migrasi sebelumnya sempat gagal setelah tahap ini)
        // tapi firebaseUid belum sempat ditulis balik ke Firestore — jangan generate password
        // baru yang akan menimpa yang sudah dibagikan; tandai untuk dicek manual.
        failed.push({ username, error: 'Sudah ada di Firebase Auth tapi firebaseUid belum tersimpan — cek manual.' });
      } else {
        failed.push({ username, error: created.error });
      }
      continue;
    }

    const claimsResult = await setFirebaseAuthClaims(created.localId, {
      role: data.role ?? '', username, mustChangePassword: true,
    });
    if (!claimsResult.ok) {
      failed.push({ username, error: `Akun dibuat tapi gagal set klaim: ${claimsResult.error}` });
      continue;
    }

    // Hapus passwordHash lama — sejak titik ini, satu-satunya password yang valid untuk akun
    // ini ada di Firebase Auth. Ini juga yang membuat login route aman jatuh ke jalur Firestore
    // lama saat Firebase Auth error tak terduga: tidak ada password lama yang bisa "hidup lagi".
    await doc.ref.update({ firebaseUid: created.localId, passwordHash: FieldValue.delete() });
    migrated.push({ username, tempPassword });
  }

  return Response.json({ migrated, skipped, failed });
}
