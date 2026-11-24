import { NextRequest } from 'next/server';
import { getAuthUser, unauthorized } from '@/lib/admin-auth';
import { getSql } from '@/lib/db';
import { staleSessionReason, sessionExpired } from '@/lib/rbac';
import { parseStrictAppearance } from '@/lib/appearance';

// Simpan pengaturan tampilan Desktop milik pengguna yang sedang login (profiles.ui_appearance). Hanya butuh sesi
// (preferensi tampilan, bukan data bisnis), pola sama dengan /api/me/layout. Validasi ketat: empat field persis, semua id dikenal.
export async function PUT(req: NextRequest) {
  const authUser = getAuthUser(req);
  if (!authUser) return unauthorized();
  const staleReason = await staleSessionReason(authUser);
  if (staleReason !== false) return sessionExpired(staleReason);

  let body: { appearance?: unknown } | null = null;
  try { body = await req.json() as { appearance?: unknown } | null; } catch { /* body bukan JSON */ }
  const appearance = parseStrictAppearance(body?.appearance);
  if (!appearance) return Response.json({ error: 'Pengaturan tampilan tidak valid.' }, { status: 400 });

  try {
    const sql = getSql();
    const res = await sql`update profiles set ui_appearance = ${JSON.stringify(appearance)}::jsonb, updated_at = now() where username = ${authUser.username}`;
    if (res.count === 0) return Response.json({ error: 'Profil tidak ditemukan.' }, { status: 404 });
  } catch (err) {
    // Paling mungkin: migrasi scripts/add-profile-ui-appearance.mjs belum dijalankan.
    console.error('Gagal menyimpan ui_appearance', err);
    return Response.json({ error: 'Gagal menyimpan pengaturan tampilan.' }, { status: 500 });
  }
  return Response.json({ ok: true, appearance });
}
