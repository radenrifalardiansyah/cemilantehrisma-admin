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

// Kode supplier untuk nomor DO (mis. 'SUP001'). Pakai kode di master supplier kalau ada; kalau tidak
// (supplier lama tanpa kode / ditulis manual di PO) dibentuk dari inisial nama, tanpa bentuk badan
// usaha: "PT. FKS Food Sejahtera Tbk" -> "FFST". Selalu huruf besar/angka, maks 6 karakter.
export function supplierDoCode(code: string | null | undefined, name: string): string {
  const clean = (code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (clean) return clean.slice(0, 6);
  const words = name.toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/)
    .filter(w => w && !['PT', 'CV', 'UD', 'TBK', 'PD', 'TOKO'].includes(w));
  const initials = words.map(w => w[0]).join('');
  return (initials || 'XXX').slice(0, 6);
}
