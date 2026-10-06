import type postgres from 'postgres';
import { wibDayStart, wibDayEnd } from '@/lib/date';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- lihat catatan yang sama di src/lib/wallet-balance.ts
type PgClient = postgres.ISql<{}>;

export interface StockAdjustment {
  loss: number;   // nilai barang yang kurang dari hitungan fisik (stok sistem > fisik), pada Harga Modal
  gain: number;   // nilai barang yang lebih dari hitungan fisik
  net: number;    // gain − loss (negatif = rugi stok) — ditambahkan ke Laba Bersih
}

// Selisih stok hasil opname dalam periode, dinilai pada Harga Modal saat opname (unit_cost).
// Entri opname lama/tanpa unit_cost dianggap bernilai 0 (tidak dikarang-karang).
export async function stockAdjustmentForPeriod(sql: PgClient, from: string, to: string): Promise<StockAdjustment> {
  const [row] = await sql<{ loss: string; gain: string }[]>`
    select
      coalesce(sum(qty * coalesce(unit_cost, 0)) filter (where type = 'out'), 0) as loss,
      coalesce(sum(qty * coalesce(unit_cost, 0)) filter (where type = 'in'), 0) as gain
    from stock_ledger
    where kind = 'opname' and created_at >= ${wibDayStart(from).toDate()} and created_at <= ${wibDayEnd(to).toDate()}
  `;
  const loss = Number(row.loss) || 0;
  const gain = Number(row.gain) || 0;
  return { loss, gain, net: gain - loss };
}
