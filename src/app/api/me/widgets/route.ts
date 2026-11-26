import { NextRequest } from 'next/server';
import { getAuthUser, unauthorized } from '@/lib/admin-auth';
import { getSql } from '@/lib/db';
import { staleSessionReason, sessionExpired } from '@/lib/rbac';
import { parseStrictWidgets } from '@/lib/widgets';

// Simpan widget tampilan depan Desktop milik pengguna yang sedang login (profiles.ui_widgets). Hanya butuh sesi (preferensi tampilan), pola sama dengan
// /api/me/pins. Body { widgets: WidgetInstance[] | null }: validasi KETAT (lihat parseStrictWidgets: maks 12, id unik, type dikenal, size diizinkan,
// col/row < 40, config hanya kunci yang diizinkan type-nya); null = kembali ke belum memilih.
export async function PUT(req: NextRequest) {
  const authUser = getAuthUser(req);
  if (!authUser) return unauthorized();
  const staleReason = await staleSessionReason(authUser);
  if (staleReason !== false) return sessionExpired(staleReason);

  let body: { widgets?: unknown } | null = null;
  try { body = await req.json() as { widgets?: unknown } | null; } catch { /* body bukan JSON */ }
  const raw = body?.widgets;
  const widgets = raw === null ? null : parseStrictWidgets(raw);
  if (raw === undefined || (raw !== null && widgets === null)) {
    return Response.json({ error: 'Daftar widget tidak valid.' }, { status: 400 });
  }

  try {
    const sql = getSql();
    const value = widgets === null ? null : JSON.stringify(widgets);
    const res = await sql`update profiles set ui_widgets = ${value}::jsonb, updated_at = now() where username = ${authUser.username}`;
    if (res.count === 0) return Response.json({ error: 'Profil tidak ditemukan.' }, { status: 404 });
  } catch (err) {
    // Paling mungkin: migrasi scripts/add-profile-ui-widgets.mjs belum dijalankan.
    console.error('Gagal menyimpan ui_widgets', err);
    return Response.json({ error: 'Gagal menyimpan widget.' }, { status: 500 });
  }
  return Response.json({ ok: true, widgets });
}
