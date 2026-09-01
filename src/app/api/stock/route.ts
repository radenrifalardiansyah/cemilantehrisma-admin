import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { wibDayStart, wibDayEnd } from '@/lib/date';

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'stock', 'view');
  if (guard instanceof Response) return guard;
  const { searchParams } = new URL(req.url);
  const from = searchParams.get('from'); // ISO yyyy-mm-dd — dipakai Laporan Stok untuk filter per periode
  const to   = searchParams.get('to');
  const sql = getSql();

  const SELECT_COLUMNS = sql`
    id, product_id as "productId", product_name as "productName", warehouse_id as "warehouseId",
    warehouse_name as "warehouseName", type, qty, note,
    from_warehouse_id as "fromWarehouseId", from_warehouse_name as "fromWarehouseName",
    to_warehouse_id as "toWarehouseId", to_warehouse_name as "toWarehouseName",
    created_at as "createdAt"
  `;

  const rows = (from || to)
    ? await sql`
        select ${SELECT_COLUMNS} from stock_ledger
        where created_at >= ${from ? wibDayStart(from).toDate() : new Date(0)}
          and created_at <= ${to ? wibDayEnd(to).toDate() : new Date()}
        order by created_at desc
      `
    : await sql`select ${SELECT_COLUMNS} from stock_ledger order by created_at desc limit 200`;

  const entries = rows.map(r => ({ ...r, qty: Number(r.qty) }));
  return Response.json({ entries });
}
