import type { TransactionSql } from 'postgres';

export type PgTx = TransactionSql;

// Nomor dokumen berurutan per periode, mis. `PO-202610-0001`. Dinaikkan lewat upsert di tabel
// `doc_counters` DI DALAM transaksi pemanggil — baris counter terkunci sampai commit, jadi dua
// request bersamaan tidak pernah dapat nomor yang sama (beda dengan pola max+1 tanpa kunci).
// Kalau transaksi pemanggil rollback, counter ikut rollback (tidak ada nomor yang "bolong").
export async function nextDocNumber(pgTx: PgTx, prefix: string, yyyymm: string): Promise<string> {
  const key = `${prefix}-${yyyymm}`;
  const [row] = await pgTx<{ last_value: number }[]>`
    insert into doc_counters (key, last_value) values (${key}, 1)
    on conflict (key) do update set last_value = doc_counters.last_value + 1
    returning last_value
  `;
  return `${key}-${String(row.last_value).padStart(4, '0')}`;
}

// 'yyyy-mm-dd' → 'yyyymm'
export function periodOf(dateKey: string): string {
  return dateKey.slice(0, 7).replace('-', '');
}
