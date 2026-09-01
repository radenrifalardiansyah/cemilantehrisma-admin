import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logHistory } from '@/lib/history';
import { writeTransferLedgerEntryPg } from '@/lib/stock-pg';

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'stock', 'edit');
  if (guard instanceof Response) return guard;

  const data = await req.json() as {
    fromWarehouseId: string;
    fromWarehouseName: string;
    toWarehouseId: string;
    toWarehouseName: string;
    productId: string;
    productName: string;
    qty: number;
    note?: string;
  };

  const {
    fromWarehouseId, fromWarehouseName,
    toWarehouseId, toWarehouseName,
    productId, productName,
    qty, note,
  } = data;

  if (!fromWarehouseId || !toWarehouseId || !productId || !qty || qty <= 0 || fromWarehouseId === toWarehouseId) {
    return Response.json({ error: 'Data tidak valid' }, { status: 400 });
  }

  const db = getDb();
  const sql = getSql();

  try {
    await sql.begin(async pgTx => {
      const [fromRow] = await pgTx<{ stock_qty: string }[]>`
        select stock_qty from warehouse_stock where id = ${`${fromWarehouseId}_${productId}`} for update
      `;
      const fromQty = fromRow ? Number(fromRow.stock_qty) || 0 : 0;
      if (fromQty < qty) {
        throw new Error(`Stok ${productName} di ${fromWarehouseName} tidak cukup (tersisa ${fromQty}, butuh ${qty})`);
      }

      await pgTx`
        insert into warehouse_stock (id, warehouse_id, product_id, product_name, stock_qty, updated_at)
        values (${`${fromWarehouseId}_${productId}`}, ${fromWarehouseId}, ${productId}, ${productName}, ${-qty}, now())
        on conflict (id) do update set stock_qty = warehouse_stock.stock_qty - ${qty}, updated_at = now()
      `;
      await pgTx`
        insert into warehouse_stock (id, warehouse_id, product_id, product_name, stock_qty, updated_at)
        values (${`${toWarehouseId}_${productId}`}, ${toWarehouseId}, ${productId}, ${productName}, ${qty}, now())
        on conflict (id) do update set stock_qty = warehouse_stock.stock_qty + ${qty}, updated_at = now()
      `;

      await writeTransferLedgerEntryPg(pgTx, {
        productId, productName,
        fromWarehouseId, fromWarehouseName, toWarehouseId, toWarehouseName,
        qty, note: note ?? '',
      });
    });

  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal transfer stok.' }, { status: 400 });
  }

  try {
    await logHistory(db, {
      entity: 'stock',
      entityId: productId,
      entityLabel: productName ?? productId,
      action: 'update',
      actor: guard,
      meta: { fromWarehouseId, toWarehouseId, qty },
    });
  } catch {
    // audit log failure must never fail the business request
  }

  return Response.json({ ok: true });
}
