import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { toTimestamp } from '@/lib/orders-pg';

interface LedgerRow {
  id: string; product_id: string; product_name: string; stall_id: string; stall_name: string;
  type: string; qty: string; balance_after: string; receipt_id: string | null; note: string; created_at: Date;
}

// Riwayat pergerakan stok titipan (kartu stok), bisa difilter per produk dan/atau lapak.
export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'consign', 'view');
  if (guard instanceof Response) return guard;
  const { searchParams } = new URL(req.url);
  const productId = searchParams.get('productId');
  const stallId = searchParams.get('stallId');
  const sql = getSql();
  const rows = await sql<LedgerRow[]>`
    select * from consign_stock_ledger
    where true
      ${productId ? sql`and product_id = ${productId}` : sql``}
      ${stallId ? sql`and stall_id = ${stallId}` : sql``}
    order by created_at desc
    limit 300
  `;
  return Response.json({
    ledger: rows.map(r => ({
      id: r.id, productId: r.product_id, productName: r.product_name, stallId: r.stall_id, stallName: r.stall_name,
      type: r.type, qty: Number(r.qty), balanceAfter: Number(r.balance_after), receiptId: r.receipt_id,
      note: r.note, createdAt: toTimestamp(r.created_at),
    })),
  });
}
