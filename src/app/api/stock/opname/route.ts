import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { withDeadlockRetry } from '@/lib/db-retry';
import { readProductsForDeltasPg, applyStockDeltaPg, writeStockLedgerEntryPg } from '@/lib/stock-pg';
import { revalidateProductStock } from '@/lib/revalidate';
import { revalidateTag } from 'next/cache';
import { logHistory } from '@/lib/history';
import { notifyProductLowStock } from '@/lib/low-stock';

// Stok opname produk jadi per gudang: hitung fisik dibanding stok sistem di gudang itu, lalu
// selisihnya dikoreksi (stok gudang + total produk) dan dicatat di buku stok sebagai Masuk
// (fisik > sistem) atau Keluar (fisik < sistem) dengan catatan "Stok opname". Hanya produk yang
// benar-benar berselisih yang disentuh. Urutan kunci sama dengan alur lain: produk → gudang.
export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'stock', 'create');
  if (guard instanceof Response) return guard;
  const data = await req.json() as {
    warehouseId?: string; warehouseName?: string; note?: string;
    items?: { productId: string; countedQty: number }[];
  };
  const warehouseId = data.warehouseId;
  if (!warehouseId) return Response.json({ error: 'Pilih gudang dulu.' }, { status: 400 });
  const counted = new Map<string, number>();
  for (const it of data.items ?? []) {
    const q = Number(it.countedQty);
    if (!it.productId || !Number.isInteger(q) || q < 0) {
      return Response.json({ error: 'Jumlah hitung fisik harus bilangan bulat ≥ 0.' }, { status: 400 });
    }
    counted.set(it.productId, q);
  }
  if (counted.size === 0) return Response.json({ error: 'Belum ada produk yang dihitung.' }, { status: 400 });
  const note = (data.note ?? '').trim().slice(0, 200);
  const sql = getSql();

  type Diff = { productId: string; name: string; systemQty: number; countedQty: number; delta: number };
  let diffs: Diff[];
  try {
    diffs = await withDeadlockRetry(() => sql.begin(async pgTx => {
      const ids = [...counted.keys()].sort();
      // delta 0 hanya untuk mengunci & membaca produk (urut id) — kekurangan stok tidak relevan di sini.
      const { products } = await readProductsForDeltasPg(pgTx, new Map(ids.map(id => [id, 0])));
      const keys = ids.map(id => `${warehouseId}_${id}`);
      const wsRows = await pgTx<{ id: string; stock_qty: string }[]>`
        select id, stock_qty from warehouse_stock where id in ${pgTx(keys)} order by id for update
      `;
      const wsQty = new Map(wsRows.map(r => [r.id, Number(r.stock_qty) || 0]));

      const result: Diff[] = [];
      for (const id of ids) {
        const product = products.get(id);
        if (!product?.exists) continue;
        const systemQty = wsQty.get(`${warehouseId}_${id}`) ?? 0;
        const countedQty = counted.get(id)!;
        const delta = countedQty - systemQty;
        if (delta === 0) continue;
        await applyStockDeltaPg(pgTx, { productId: id, product, warehouseId, delta });
        await writeStockLedgerEntryPg(pgTx, {
          productId: id, productName: product.name, warehouseId, warehouseName: data.warehouseName,
          type: delta > 0 ? 'in' : 'out', qty: delta,
          note: `Stok opname: sistem ${systemQty} → fisik ${countedQty}${note ? ` — ${note}` : ''}`,
          unitCost: product.costPrice, kind: 'opname',
        });
        result.push({ productId: id, name: product.name, systemQty, countedQty, delta });
      }
      return result;
    }));
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal menyimpan stok opname.' }, { status: 400 });
  }

  if (diffs.length > 0) {
    try {
      await logHistory(getDb(), {
        entity: 'stock', entityId: warehouseId, entityLabel: `Stok opname ${data.warehouseName ?? warehouseId}`,
        action: 'update', actor: guard, after: { note, items: diffs },
      });
    } catch (err) {
      console.error('Failed to write history for stock opname', err);
    }
    revalidateProductStock();
    revalidateTag('admin-analytics', { expire: 0 }); // selisih opname ikut Laba Rugi di dashboard
    await notifyProductLowStock(getDb(), new Map(diffs.map(d => [d.productId, d.delta])), guard, 'stok opname');
  }
  return Response.json({ ok: true, adjusted: diffs.length, items: diffs });
}
