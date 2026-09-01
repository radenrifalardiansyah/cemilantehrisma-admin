import { FieldValue, Firestore } from 'firebase-admin/firestore';
import { getSql } from '@/lib/db';

// Dipanggil sekali per login sukses (lihat src/app/api/login/route.ts) — mencatat event ke
// koleksi `login_history` (masih Firestore, kecil & jarang dibaca, di luar cakupan migrasi ini)
// sekaligus menyimpan snapshot `lastLoginAt`/`lastLoginIp` di baris `profiles` (Tahap 7 migrasi,
// lihat plan gleaming-wondering-quokka.md) supaya profil & chat bisa menampilkannya tanpa query
// tambahan.
interface RecordLoginOpts {
  username: string;
  role: string;
  ip: string;
  userAgent: string;
}

export async function recordLogin(db: Firestore, opts: RecordLoginOpts): Promise<void> {
  const sql = getSql();
  await Promise.all([
    db.collection('login_history').add({
      username: opts.username,
      role: opts.role,
      ip: opts.ip,
      userAgent: opts.userAgent,
      createdAt: FieldValue.serverTimestamp(),
    }),
    sql`update profiles set last_login_at = now(), last_login_ip = ${opts.ip} where username = ${opts.username}`,
  ]);
}
