import { getSql, parseJsonb } from '@/lib/db';

// Versi Postgres dari dokumen tunggal `settings/main` (Tahap 15 migrasi Fase 2, lihat plan
// gleaming-wondering-quokka.md) — disimpan sebagai satu blob jsonb (bukan tabel relasional)
// karena bentuknya memang bebas skema (branding, pembayaran, tema admin, dsb) persis seperti
// dokumen Firestore lama. `getSettings()` mengembalikan objek yang sama seperti `doc.data()`
// dulu supaya semua pemanggil tidak perlu berubah.

export async function getSettings(): Promise<Record<string, unknown>> {
  const sql = getSql();
  const [row] = await sql<{ data: unknown }[]>`select data from settings where id = 'main'`;
  return (parseJsonb(row?.data ?? null) as Record<string, unknown>) ?? {};
}

export async function setSettings(patch: Record<string, unknown>): Promise<void> {
  const sql = getSql();
  const current = await getSettings();
  const merged = { ...current, ...patch };
  await sql`
    insert into settings (id, data, updated_at) values ('main', ${JSON.stringify(merged)}, now())
    on conflict (id) do update set data = ${JSON.stringify(merged)}, updated_at = now()
  `;
}
