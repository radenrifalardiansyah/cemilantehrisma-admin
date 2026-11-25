import { NextRequest } from 'next/server';
import { getAuthUser, unauthorized } from '@/lib/admin-auth';
import { getSql } from '@/lib/db';
import { staleSessionReason, sessionExpired } from '@/lib/rbac';
import { parseStrictPins } from '@/lib/pins';

// Simpan menu yang disematkan ke tampilan depan Desktop milik pengguna yang sedang login (profiles.ui_pins). Hanya butuh sesi (preferensi tampilan),
// pola sama dengan /api/me/appearance. Body { pins: string[] | null }: array string unik berisi id menu berjendela (maks 40); null = kembali ke bawaan.
export async function PUT(req: NextRequest) {
  const authUser = getAuthUser(req);
  if (!authUser) return unauthorized();
  const staleReason = await staleSessionReason(authUser);
  if (staleReason !== false) return sessionExpired(staleReason);

  let body: { pins?: unknown } | null = null;
  try { body = await req.json() as { pins?: unknown } | null; } catch { /* body bukan JSON */ }
  const raw = body?.pins;
  const pins = raw === null ? null : parseStrictPins(raw);
  if (raw === undefined || (raw !== null && pins === null)) {
    return Response.json({ error: 'Daftar menu yang disematkan tidak valid.' }, { status: 400 });
  }

  try {
    const sql = getSql();
    const value = pins === null ? null : JSON.stringify(pins);
    const res = await sql`update profiles set ui_pins = ${value}::jsonb, updated_at = now() where username = ${authUser.username}`;
    if (res.count === 0) return Response.json({ error: 'Profil tidak ditemukan.' }, { status: 404 });
  } catch (err) {
    // Paling mungkin: migrasi scripts/add-profile-ui-pins.mjs belum dijalankan.
    console.error('Gagal menyimpan ui_pins', err);
    return Response.json({ error: 'Gagal menyimpan menu yang disematkan.' }, { status: 500 });
  }
  return Response.json({ ok: true, pins });
}
