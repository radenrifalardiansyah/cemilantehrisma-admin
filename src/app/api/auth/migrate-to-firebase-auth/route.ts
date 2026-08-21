import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { getDb } from '@/lib/firebase-admin';
import { requireSuperAdmin } from '@/lib/rbac';
import {
  deriveLoginEmail, createFirebaseAuthUser, setFirebaseAuthClaims,
} from '@/lib/firebase-auth-rest';

// Satu password sementara yang sama untuk semua akun yang dimigrasikan (permintaan eksplisit
// pemilik — lebih mudah dibagikan ke tim daripada satu password acak per orang). Tetap aman
// sebagai password SEMENTARA karena mustChangePassword=true memaksa tiap orang menggantinya
// sendiri saat login pertama sebelum bisa memakai aplikasi.
const MIGRATION_TEMP_PASSWORD = '123qwe5566';

// One-time (but safe to re-run — idempotent via the `firebaseUid` field) migration: creates a
// Firebase Auth account for every existing Firestore user that doesn't have one yet, with the
// shared temp password above and mustChangePassword=true.
export async function POST(req: NextRequest) {
  const guard = requireSuperAdmin(req);
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
    const tempPassword = MIGRATION_TEMP_PASSWORD;
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
