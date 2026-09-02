import { randomUUID } from 'crypto';
import { getSql } from '@/lib/db';

// Dipanggil sekali per login sukses (lihat src/app/api/login/route.ts) — mencatat event ke
// tabel `login_history` sekaligus menyimpan snapshot `lastLoginAt`/`lastLoginIp` di baris
// `profiles` (Tahap 7 migrasi, lihat plan gleaming-wondering-quokka.md) supaya profil & chat
// bisa menampilkannya tanpa query tambahan.
interface RecordLoginOpts {
  username: string;
  role: string;
  ip: string;
  userAgent: string;
}

export async function recordLogin(opts: RecordLoginOpts): Promise<void> {
  const sql = getSql();
  await Promise.all([
    sql`
      insert into login_history (id, username, role, ip, user_agent)
      values (${randomUUID()}, ${opts.username}, ${opts.role}, ${opts.ip}, ${opts.userAgent})
    `,
    sql`update profiles set last_login_at = now(), last_login_ip = ${opts.ip} where username = ${opts.username}`,
  ]);
}
