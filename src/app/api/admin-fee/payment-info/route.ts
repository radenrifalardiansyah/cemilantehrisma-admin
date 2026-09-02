import { NextRequest } from 'next/server';
import { getSql, parseJsonb } from '@/lib/db';
import { requireSuperAdmin, requireAdminOrSuperAdmin } from '@/lib/rbac';

// Disimpan sebagai baris tersendiri di tabel `settings` (blob jsonb generik, lihat
// lib/settings-pg.ts) dengan id 'adminFeePaymentInfo' — sengaja BUKAN baris 'main' (data toko
// milik `admin`), dan BUKAN lewat setSettings()/getSettings() yang hardcode ke 'main'.
const ID = 'adminFeePaymentInfo';

// Rekening tujuan pembayaran Biaya Admin milik RMedia Solutions sendiri (ke mana `admin`
// harus transfer) — sengaja dokumen & endpoint TERPISAH dari /api/settings (yang isinya data
// toko milik `admin`). Kalau digabung ke situ, `admin` (pihak yang justru harus bayar ke sini)
// akan bisa mengedit nomor rekening tujuannya sendiri lewat halaman Pengaturan biasa.
export async function GET(req: NextRequest) {
  const guard = await requireAdminOrSuperAdmin(req);
  if (guard instanceof Response) return guard;
  const sql = getSql();
  const [row] = await sql<{ data: unknown }[]>`select data from settings where id = ${ID}`;
  return Response.json({ paymentInfo: (parseJsonb(row?.data as string | Record<string, unknown> | null ?? null) as Record<string, unknown>) ?? {} });
}

export async function PUT(req: NextRequest) {
  const guard = await requireSuperAdmin(req);
  if (guard instanceof Response) return guard;
  const data = await req.json() as { bankName?: string; accountNumber?: string; accountHolder?: string };
  const payload = {
    bankName: data.bankName?.trim() ?? '',
    accountNumber: data.accountNumber?.trim() ?? '',
    accountHolder: data.accountHolder?.trim() ?? '',
  };
  const sql = getSql();
  await sql`
    insert into settings (id, data, updated_at) values (${ID}, ${JSON.stringify(payload)}, now())
    on conflict (id) do update set data = ${JSON.stringify(payload)}, updated_at = now()
  `;
  return Response.json({ ok: true });
}
