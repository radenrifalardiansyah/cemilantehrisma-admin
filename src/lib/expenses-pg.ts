import { getSql } from '@/lib/db';

// `expenses` sekarang di Postgres (Tahap 5 migrasi, lihat plan gleaming-wondering-quokka.md), tapi
// material-purchases & production menulis expense "otomatis" sebagai bagian dari transaksi
// Firestore mereka sendiri (stok bahan baku/produk, dsb). Postgres tidak bisa ikut serta dalam
// transaksi Firestore itu, jadi pola di semua caller berikut ini adalah: baca/putuskan di dalam
// (atau sebelum) `db.runTransaction(...)`, lalu jalankan insert/update/delete Postgres di sini
// SETELAH transaksi Firestore-nya berhasil commit — best-effort, non-atomic lintas 2 database,
// trade-off yang sudah disepakati untuk migrasi bertahap ini.

export interface ExpensePgRow {
  id: string; category: string | null; description: string | null; amount: string;
  date: string; note: string | null; wallet_id: string | null;
  source_type: string | null; source_id: string | null;
}

export async function getExpensePg(id: string): Promise<ExpensePgRow | null> {
  const sql = getSql();
  const [row] = await sql<ExpensePgRow[]>`select * from expenses where id = ${id}`;
  return row ?? null;
}

export interface ExpenseInsert {
  id: string; category: string; description: string; amount: number; date: string;
  note?: string; walletId?: string | null; sourceType: string; sourceId: string;
}

export async function insertExpensePg(e: ExpenseInsert) {
  const sql = getSql();
  await sql`
    insert into expenses (id, category, description, amount, date, note, wallet_id, source_type, source_id, created_at, updated_at)
    values (${e.id}, ${e.category}, ${e.description}, ${e.amount}, ${e.date}, ${e.note ?? ''}, ${e.walletId ?? null}, ${e.sourceType}, ${e.sourceId}, now(), now())
  `;
}

export interface ExpenseUpdate {
  description: string; amount: number; date: string; walletId?: string | null;
}

export async function updateExpensePg(id: string, patch: ExpenseUpdate) {
  const sql = getSql();
  await sql`
    update expenses set description = ${patch.description}, amount = ${patch.amount}, date = ${patch.date},
      wallet_id = ${patch.walletId ?? null}, updated_at = now()
    where id = ${id}
  `;
}

export async function deleteExpensePg(id: string) {
  const sql = getSql();
  await sql`delete from expenses where id = ${id}`;
}

// Deskripsi keputusan "apa yang perlu terjadi ke expense Postgres" yang dibuat DI DALAM callback
// `db.runTransaction(...)` milik caller (material-purchases/production), lalu dieksekusi lewat
// `applyExpensePgAction` SETELAH transaksi Firestore itu commit. Dibungkus function terpisah
// (bukan langsung switch di tempat) supaya parameter dapat tipe union yang benar — TypeScript
// tidak melacak narrowing serikat tipe `let` yang di-assign di dalam closure lintas awaited call.
export type ExpensePgAction =
  | { type: 'none' }
  | { type: 'update'; id: string; description: string; amount: number; date: string; walletId?: string | null }
  | { type: 'insert'; id: string; category: string; description: string; amount: number; date: string; note: string; sourceType: string; sourceId: string; walletId?: string | null }
  | { type: 'delete'; id: string };

export async function applyExpensePgAction(action: ExpensePgAction): Promise<boolean> {
  switch (action.type) {
    case 'update':
      await updateExpensePg(action.id, { description: action.description, amount: action.amount, date: action.date, walletId: action.walletId ?? null });
      return true;
    case 'insert':
      await insertExpensePg({
        id: action.id, category: action.category, description: action.description, amount: action.amount,
        date: action.date, note: action.note, sourceType: action.sourceType, sourceId: action.sourceId, walletId: action.walletId ?? null,
      });
      return true;
    case 'delete':
      await deleteExpensePg(action.id);
      return true;
    case 'none':
      return false;
  }
}
