import { FieldValue, Firestore } from 'firebase-admin/firestore';

// Dipanggil sekali per login sukses (lihat src/app/api/login/route.ts) — mencatat event ke
// koleksi `login_history` sekaligus menyimpan snapshot `lastLoginAt`/`lastLoginIp` di dokumen
// user itu sendiri supaya profil & chat bisa menampilkannya tanpa query tambahan.
interface RecordLoginOpts {
  username: string;
  role: string;
  ip: string;
  userAgent: string;
}

export async function recordLogin(db: Firestore, opts: RecordLoginOpts): Promise<void> {
  const now = FieldValue.serverTimestamp();
  const batch = db.batch();
  batch.set(db.collection('login_history').doc(), {
    username: opts.username,
    role: opts.role,
    ip: opts.ip,
    userAgent: opts.userAgent,
    createdAt: now,
  });
  batch.update(db.collection('users').doc(opts.username), {
    lastLoginAt: now,
    lastLoginIp: opts.ip,
  });
  await batch.commit();
}
