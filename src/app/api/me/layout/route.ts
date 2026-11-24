import { NextRequest } from 'next/server';
import { getAuthUser, unauthorized } from '@/lib/admin-auth';
import { getSql } from '@/lib/db';
import { staleSessionReason, sessionExpired } from '@/lib/rbac';
import { isUiLayout } from '@/lib/ui-layout';

// Simpan pilihan tata letak dashboard milik pengguna yang sedang login (profiles.ui_layout).
// Hanya butuh sesi (sama seperti /api/me): preferensi tampilan bukan data bisnis. Baris profil pasti ada:
// staleSessionReason menolak token milik profil yang sudah tidak ada.
export async function PUT(req: NextRequest) {
  const authUser = getAuthUser(req);
  if (!authUser) return unauthorized();
  const staleReason = await staleSessionReason(authUser);
  if (staleReason !== false) return sessionExpired(staleReason);

  let body: { layout?: unknown } | null = null;
  try { body = await req.json() as { layout?: unknown } | null; } catch { /* body bukan JSON */ }
  const layout = body?.layout;
  if (!isUiLayout(layout)) {
    return Response.json({ error: 'Tampilan tidak valid.' }, { status: 400 });
  }

  try {
    const sql = getSql();
    const res = await sql`update profiles set ui_layout = ${layout}, updated_at = now() where username = ${authUser.username}`;
    if (res.count === 0) return Response.json({ error: 'Profil tidak ditemukan.' }, { status: 404 });
  } catch (err) {
    // Paling mungkin: migrasi scripts/add-profile-ui-layout.mjs belum dijalankan.
    console.error('Gagal menyimpan ui_layout', err);
    return Response.json({ error: 'Gagal menyimpan tampilan.' }, { status: 500 });
  }
  return Response.json({ ok: true, layout });
}
