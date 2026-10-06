import type { Firestore } from 'firebase-admin/firestore';
import type { AuthUser } from '@/lib/admin-auth';
import { getSql } from '@/lib/db';
import { notify } from '@/lib/notifications';

// Notifikasi stok produk menipis — dipanggil SETELAH transaksi stok commit, dengan perubahan stok
// bertanda (negatif = keluar). Hanya produk yang BARU melewati batas minimum yang diberitahu
// (sebelum > minimum, sesudah <= minimum), supaya tiap penjualan berikutnya tidak mengirim ulang.
// Batas diambil dari `products.min_stock` (0 = tidak dipantau); produk "Buka PO" dilewati.
// Best-effort: kegagalan di sini tidak boleh menggagalkan transaksi stoknya.
export async function notifyProductLowStock(
  db: Firestore,
  stockDeltas: Map<string, number>,
  actor: AuthUser,
  source: string,
): Promise<void> {
  try {
    const out = [...stockDeltas].filter(([, d]) => d < 0);
    if (out.length === 0) return;
    const sql = getSql();
    const rows = await sql<{ id: string; name: string; stock_qty: string; min_stock: string; open_po: boolean }[]>`
      select id, name, stock_qty, min_stock, open_po from products where id in ${sql(out.map(([id]) => id))}
    `;
    for (const r of rows) {
      const after = Number(r.stock_qty) || 0;
      const min = Number(r.min_stock) || 0;
      const before = after - (stockDeltas.get(r.id) ?? 0);
      if (r.open_po || min <= 0 || !(before > min && after <= min)) continue;
      await notify(db, {
        type: 'stock_low',
        title: after <= 0 ? 'Stok produk habis' : 'Stok produk menipis',
        message: `${r.name} tersisa ${after} pcs (batas minimum ${min} pcs) — ${source} oleh ${actor.username}.`,
        link: 'products',
        entityCollection: 'products', entityId: r.id,
        actor,
      });
    }
  } catch (err) {
    console.error('Failed to send low stock notification', err);
  }
}
