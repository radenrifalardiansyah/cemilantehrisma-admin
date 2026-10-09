import { getSql } from '@/lib/db';
import type { AuthUser } from '@/lib/admin-auth';

// Admin & super-admin boleh mengakses semua lapak; akun lain (mis. Kasir Lapak) hanya lapak yang
// ditugaskan padanya lewat tabel `stall_users`. Dicek di SERVER pada setiap route Kasir Lapak —
// menyembunyikan lapak di UI saja tidak cukup.
export const STALL_ALL_ACCESS_ROLES = ['admin', 'super-admin'];

export const hasAllStallAccess = (user: AuthUser) => STALL_ALL_ACCESS_ROLES.includes(user.role);

export async function userStallIds(user: AuthUser): Promise<string[] | 'all'> {
  if (hasAllStallAccess(user)) return 'all';
  const sql = getSql();
  const rows = await sql<{ stall_id: string }[]>`select stall_id from stall_users where username = ${user.username}`;
  return rows.map(r => r.stall_id);
}

export async function canAccessStall(user: AuthUser, stallId: string): Promise<boolean> {
  const ids = await userStallIds(user);
  return ids === 'all' || ids.includes(stallId);
}

// Awalan invoice lapak: huruf/angka/tanda hubung, 2–12 karakter, disimpan huruf besar.
export function normalizeInvoicePrefix(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim().toUpperCase() : '';
  return /^[A-Z0-9-]{2,12}$/.test(s) ? s : null;
}
