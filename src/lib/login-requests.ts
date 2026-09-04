import { randomUUID } from 'crypto';
import { getSql, parseJsonb } from '@/lib/db';
import type { AuthUser } from '@/lib/admin-auth';

// Sebuah permintaan login baru untuk akun yang terdeteksi sedang online (lihat `presence` di
// chat.ts) — sesi yang sedang aktif harus menyetujui/menolak sebelum perangkat baru dapat token.
export const PENDING_EXPIRY_MS = 2 * 60 * 1000;

export type LoginRequestStatus = 'pending' | 'approved' | 'rejected' | 'expired';

export interface LoginRequestRow {
  id: string;
  username: string;
  ip: string;
  user_agent: string;
  device_label: string;
  status: LoginRequestStatus;
  reject_reason: string | null;
  user_payload: AuthUser | string;
  created_at: Date;
  responded_at: Date | null;
  responded_by: string | null;
}

// Heuristik ringan dari User-Agent — cukup untuk ditampilkan ke pengguna ("dari HP atau Web"),
// tidak perlu presisi sempurna (tidak ada library UA parsing di dependencies saat ini).
export function parseDeviceLabel(userAgent: string): string {
  const ua = userAgent || '';
  const isMobile = /Mobi|Android|iPhone|iPad/i.test(ua);
  const os = /Android/i.test(ua) ? 'Android'
    : /iPhone|iPad|iOS/i.test(ua) ? 'iOS'
    : /Windows/i.test(ua) ? 'Windows'
    : /Mac OS X/i.test(ua) ? 'macOS'
    : /Linux/i.test(ua) ? 'Linux'
    : 'perangkat tidak dikenal';
  const browser = /Edg\//i.test(ua) ? 'Edge'
    : /CriOS/i.test(ua) || /Chrome\//i.test(ua) ? 'Chrome'
    : /Firefox\//i.test(ua) ? 'Firefox'
    : /Safari\//i.test(ua) ? 'Safari'
    : 'browser tidak dikenal';
  return `${isMobile ? 'HP' : 'Web'} · ${browser} di ${os}`;
}

// Ditandai expired secara lazy (bukan cron) — dipanggil sebelum tiap read supaya permintaan yang
// tidak direspons dalam PENDING_EXPIRY_MS tidak menggantung selamanya sebagai "pending".
async function expireStaleRequests(): Promise<void> {
  const sql = getSql();
  await sql`
    update login_requests set status = 'expired'
    where status = 'pending' and created_at < now() - interval '2 minutes'
  `;
}

export async function createLoginRequest(opts: {
  username: string; ip: string; userAgent: string; userPayload: AuthUser;
}): Promise<{ id: string; deviceLabel: string }> {
  await expireStaleRequests();
  const sql = getSql();
  const id = randomUUID();
  const deviceLabel = parseDeviceLabel(opts.userAgent);
  await sql`
    insert into login_requests (id, username, ip, user_agent, device_label, user_payload)
    values (${id}, ${opts.username}, ${opts.ip}, ${opts.userAgent}, ${deviceLabel}, ${JSON.stringify(opts.userPayload)})
  `;
  return { id, deviceLabel };
}

export async function getLoginRequest(id: string): Promise<LoginRequestRow | null> {
  await expireStaleRequests();
  const sql = getSql();
  const [row] = await sql<LoginRequestRow[]>`select * from login_requests where id = ${id}`;
  if (!row) return null;
  return { ...row, user_payload: parseJsonb(row.user_payload) as AuthUser };
}

// Dipanggil oleh SETIAP sesi yang sedang login, terus-menerus selama sesi terbuka (poll
// `/api/login-requests/pending`, lihat LoginRequestWatcher.tsx) — beda dari getLoginRequest/
// createLoginRequest di atas yang hanya jalan selama insiden login konkuren berlangsung (jarang,
// singkat). Sengaja TIDAK memanggil expireStaleRequests() di sini — itu sebuah UPDATE, dan
// menjalankannya di jalur poll yang aktif sepanjang hari untuk semua sesi akan jadi beban tulis
// Postgres yang sia-sia. Baris "pending" yang sudah lewat PENDING_EXPIRY_MS cukup difilter di
// klausa WHERE (murni SELECT) — status barisnya sendiri baru benar-benar ditulis "expired" nanti
// saat createLoginRequest/getLoginRequest berikutnya kebetulan menyapunya.
export async function getPendingRequestForUser(username: string): Promise<LoginRequestRow | null> {
  const sql = getSql();
  const [row] = await sql<LoginRequestRow[]>`
    select * from login_requests
    where username = ${username} and status = 'pending' and created_at >= now() - interval '2 minutes'
    order by created_at desc limit 1
  `;
  return row ?? null;
}
