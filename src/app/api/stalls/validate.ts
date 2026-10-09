import { getSql } from '@/lib/db';

// Pastikan semua username petugas benar-benar ada (dan bukan admin — admin sudah punya akses semua).
export async function validateStallUsernames(sql: ReturnType<typeof getSql>, usernames: unknown): Promise<{ usernames: string[] } | { error: string }> {
  const list = Array.isArray(usernames) ? [...new Set(usernames.filter((u): u is string => typeof u === 'string' && !!u.trim()).map(u => u.trim().toLowerCase()))] : [];
  if (list.length === 0) return { usernames: [] };
  const found = await sql<{ username: string }[]>`select username from profiles where username in ${sql(list)}`;
  if (found.length !== list.length) return { error: 'Ada petugas yang tidak ditemukan.' };
  return { usernames: list };
}
