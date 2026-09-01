import { NextRequest, after } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { revalidateStorefront } from '@/lib/revalidate';

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'products', 'delete');
  if (guard instanceof Response) return guard;
  const { ids } = await req.json() as { ids: string[] };
  if (!Array.isArray(ids) || ids.length === 0)
    return Response.json({ error: 'ids required' }, { status: 400 });

  const sql = getSql();
  // Satu per satu (bukan satu statement `where id = any(...)`) — FK ke stock_ledger/
  // warehouse_stock/consignment_stock sengaja tidak cascade, jadi produk yang sudah punya
  // riwayat stok/transaksi gagal dihapus; kalau digabung satu statement, satu kegagalan
  // membatalkan SELURUH batch. Diproses terpisah supaya produk yang aman dihapus tetap
  // berhasil, dan yang gagal dilaporkan balik ke UI.
  let deleted = 0;
  const failed: { id: string; error: string }[] = [];
  for (const id of ids) {
    try {
      await sql`delete from products where id = ${id}`;
      deleted++;
    } catch (err) {
      const message = err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === '23503'
        ? 'sudah punya riwayat stok/transaksi'
        : (err instanceof Error ? err.message : 'gagal dihapus');
      failed.push({ id, error: message });
    }
  }

  if (deleted > 0) {
    revalidateTag('admin-products', { expire: 0 });
    after(() => revalidateStorefront('products'));
  }
  // Non-200 kalau ada yang gagal — frontend (ProductsTab) saat ini cuma cek `r.ok` lalu langsung
  // hapus SEMUA id yang dipilih dari state lokal, tidak melihat isi `failed`. Kalau tetap 200 di
  // sini, produk yang gagal dihapus (masih ada di DB) akan hilang dari layar sampai refresh —
  // lebih aman jatuh ke jalur error generik daripada diam-diam salah tampil "berhasil".
  if (failed.length > 0) return Response.json({ deleted, failed }, { status: 400 });
  return Response.json({ deleted, failed });
}
