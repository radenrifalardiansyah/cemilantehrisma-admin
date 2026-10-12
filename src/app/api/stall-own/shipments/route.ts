import { randomUUID } from 'crypto';
import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { withDeadlockRetry } from '@/lib/db-retry';
import { requirePermission } from '@/lib/rbac';
import { nextDocNumber, periodOf } from '@/lib/doc-number';
import { wibDateKey } from '@/lib/date';
import { auditConsign } from '@/lib/consign-audit';
import { DATE_RE, OwnError, moveWarehouseStock, rowToShipment, type ShipmentItem, type ShipmentRow } from '@/lib/stall-own';

const PREFIX = { send: 'KLP', return: 'RLP', opening: 'SAL' } as const;

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'stall-own', 'view');
  if (guard instanceof Response) return guard;
  const stallId = new URL(req.url).searchParams.get('stallId');
  const sql = getSql();
  const rows = stallId
    ? await sql<ShipmentRow[]>`select * from stall_shipments where stall_id = ${stallId} order by created_at desc limit 500`
    : await sql<ShipmentRow[]>`select * from stall_shipments order by created_at desc limit 500`;
  return Response.json({ shipments: rows.map(rowToShipment) });
}

// Kirim ke Lapak (gudang asal -> gudang lapak), Retur ke Gudang (gudang lapak -> gudang tujuan), atau
// Saldo Awal (mencatat stok yang SUDAH ada di gudang lapak supaya ikut ditagih; stok tidak bergerak).
// Harga per baris menjadi harga jual produk itu di lapak.
export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'stall-own', 'create');
  if (guard instanceof Response) return guard;
  const data = await req.json() as Record<string, unknown>;
  const kind = data.kind === 'return' ? 'return' : data.kind === 'opening' ? 'opening' : data.kind === 'send' ? 'send' : null;
  if (!kind) return Response.json({ error: 'Jenis dokumen tidak valid.' }, { status: 400 });
  const stallId = typeof data.stallId === 'string' ? data.stallId : '';
  const otherWarehouseId = typeof data.warehouseId === 'string' ? data.warehouseId : '';
  const note = typeof data.note === 'string' ? data.note.trim().slice(0, 200) : '';
  const docDate = typeof data.date === 'string' && DATE_RE.test(data.date) ? data.date : wibDateKey(new Date());
  const raw = Array.isArray(data.items) ? data.items as Record<string, unknown>[] : [];

  const merged = new Map<string, { qty: number; price: number }>();
  for (const r of raw) {
    const productId = typeof r.productId === 'string' ? r.productId : '';
    const qty = Number(r.qty); const price = Number(r.price);
    if (!productId || !Number.isFinite(qty) || qty <= 0) return Response.json({ error: 'Jumlah barang harus lebih dari 0.' }, { status: 400 });
    if (!Number.isFinite(price) || price < 0) return Response.json({ error: 'Harga tidak valid.' }, { status: 400 });
    const cur = merged.get(productId);
    merged.set(productId, { qty: (cur?.qty ?? 0) + qty, price });
  }
  if (merged.size === 0) return Response.json({ error: 'Tambahkan minimal satu barang.' }, { status: 400 });

  const sql = getSql();
  const [stall] = await sql<{ id: string; name: string; warehouse_id: string | null }[]>`select id, name, warehouse_id from stalls where id = ${stallId}`;
  if (!stall) return Response.json({ error: 'Lapak tidak ditemukan.' }, { status: 400 });
  if (!stall.warehouse_id) return Response.json({ error: 'Lapak ini belum punya gudang terkait. Atur dulu di menu Lapak.' }, { status: 400 });
  if (kind !== 'opening') {
    if (!otherWarehouseId) return Response.json({ error: kind === 'send' ? 'Pilih gudang asal.' : 'Pilih gudang tujuan.' }, { status: 400 });
    if (otherWarehouseId === stall.warehouse_id) return Response.json({ error: 'Gudang asal/tujuan tidak boleh sama dengan gudang lapak.' }, { status: 400 });
  }

  const id = randomUUID();
  try {
    const row = await withDeadlockRetry(() => sql.begin(async tx => {
      const products = await tx<{ id: string; name: string | null }[]>`select id, name from products where id in ${tx([...merged.keys()])}`;
      if (products.length !== merged.size) throw new OwnError('Ada produk yang tidak ditemukan.');
      const nameById = new Map(products.map(p => [p.id, p.name ?? '']));
      const items: ShipmentItem[] = [...merged].map(([productId, v]) => ({ productId, name: nameById.get(productId) ?? '', qty: v.qty, price: v.price }));
      const [stallWh] = await tx<{ name: string }[]>`select name from warehouses where id = ${stall.warehouse_id}`;
      const [other] = otherWarehouseId ? await tx<{ name: string }[]>`select name from warehouses where id = ${otherWarehouseId}` : [];
      if (kind !== 'opening' && !other) throw new OwnError('Gudang tidak ditemukan.');
      const note2 = `${kind === 'send' ? 'Kirim ke' : kind === 'return' ? 'Retur dari' : 'Saldo awal'} lapak ${stall.name}`;
      if (kind === 'send') {
        await moveWarehouseStock(tx, { fromId: otherWarehouseId, fromName: other.name, toId: stall.warehouse_id!, toName: stallWh?.name ?? '', items, note: note2 });
      } else if (kind === 'return') {
        await moveWarehouseStock(tx, { fromId: stall.warehouse_id!, fromName: stallWh?.name ?? '', toId: otherWarehouseId, toName: other.name, items, note: note2 });
      } else {
        // Saldo awal: stok yang dicatat tidak boleh melebihi stok yang benar-benar ada di gudang lapak.
        for (const i of items) {
          const [ws] = await tx<{ stock_qty: string }[]>`select stock_qty from warehouse_stock where id = ${`${stall.warehouse_id}_${i.productId}`}`;
          if ((Number(ws?.stock_qty) || 0) < i.qty) throw new OwnError(`Stok ${i.name} di gudang lapak hanya ${Number(ws?.stock_qty) || 0}, tidak bisa dicatat ${i.qty}.`);
        }
      }
      // Harga di dokumen = harga jual produk itu di lapak (berlaku untuk penjualan berikutnya). Retur ke gudang
      // tidak mengubah harga lapak (harga yang diketik di retur bisa saja asal).
      for (const i of kind === 'return' ? [] : items) {
        await tx`
          insert into stall_product_prices (stall_id, product_id, price, updated_at) values (${stall.id}, ${i.productId}, ${i.price}, now())
          on conflict (stall_id, product_id) do update set price = excluded.price, updated_at = now()
        `;
      }
      const docNumber = await nextDocNumber(tx, PREFIX[kind], periodOf(docDate));
      const totalQty = items.reduce((a, i) => a + i.qty, 0);
      const totalValue = items.reduce((a, i) => a + i.qty * i.price, 0);
      const [r] = await tx<ShipmentRow[]>`
        insert into stall_shipments (id, doc_number, kind, stall_id, stall_name, stall_warehouse_id, from_warehouse_id, from_warehouse_name, doc_date, items, total_qty, total_value, note, created_by, created_at)
        values (${id}, ${docNumber}, ${kind}, ${stall.id}, ${stall.name}, ${stall.warehouse_id}, ${otherWarehouseId || null}, ${other?.name ?? ''}, ${docDate}, ${tx.json(items as never)}, ${totalQty}, ${totalValue}, ${note}, ${guard.username}, now())
        returning *
      `;
      return r;
    }));
    await auditConsign(guard, 'create', 'stall-shipments', id, `${row.doc_number} (${stall.name})`, null, { kind, stall: stall.name, qty: Number(row.total_qty), value: Number(row.total_value) });
    return Response.json({ shipment: rowToShipment(row) });
  } catch (err) {
    if (err instanceof OwnError) return Response.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
