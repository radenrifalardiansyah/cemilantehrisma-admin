import type { Firestore } from 'firebase-admin/firestore';
import type { AuthUser } from '@/lib/admin-auth';
import { getSql } from '@/lib/db';
import { notify } from '@/lib/notifications';

// Stok barang titipan di sebuah lapak BARU melewati batas minimum (sebelum > batas, sesudah <= batas).
// Batas 0 = tidak dipantau. Hanya dikirim saat melewati batas, bukan di setiap penjualan berikutnya.
export function crossedLowStock(before: number, after: number, min: number): boolean {
  return min > 0 && before > min && after <= min;
}

// Dipanggil SETELAH transaksi penjualan lapak commit (best-effort, tanpa cron): `sold` = jumlah
// terjual per produk titipan di penjualan itu. Stok sebelum = stok sekarang + jumlah terjual.
export async function notifyConsignLowStock(
  db: Firestore, stall: { id: string; name: string }, sold: Map<string, number>, actor: AuthUser, source: string,
): Promise<void> {
  try {
    if (sold.size === 0) return;
    const sql = getSql();
    const rows = await sql<{ product_id: string; stock_qty: string; name: string; unit: string; min_stock: string }[]>`
      select si.product_id, si.stock_qty, p.name, p.unit, p.min_stock
      from consign_stall_items si join consign_products p on p.id = si.product_id
      where si.stall_id = ${stall.id} and si.product_id in ${sql([...sold.keys()])}
    `;
    for (const r of rows) {
      const after = Number(r.stock_qty) || 0;
      const min = Number(r.min_stock) || 0;
      const before = after + (sold.get(r.product_id) ?? 0);
      if (!crossedLowStock(before, after, min)) continue;
      await notify(db, {
        type: 'stock_low',
        title: after <= 0 ? 'Stok titipan habis' : 'Stok titipan menipis',
        message: `${r.name} di ${stall.name} tersisa ${after} ${r.unit} (batas minimum ${min} ${r.unit}) — ${source} oleh ${actor.username}.`,
        link: 'consign',
        entityCollection: 'consign_products', entityId: r.product_id,
        actor,
      });
    }
  } catch (err) {
    console.error('Failed to send consign low stock notification', err);
  }
}
