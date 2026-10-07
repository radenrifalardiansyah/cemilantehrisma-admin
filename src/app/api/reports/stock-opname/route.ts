import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { wibDayStart, wibDayEnd } from '@/lib/date';
import { summarizeOpname, type OpnameReportRow } from '@/lib/procurement-report';

// Laporan Stok Opname per periode: tiap baris = satu produk yang selisih saat opname (buku stok
// berpenanda kind='opname'). Nilai selisih memakai Harga Modal saat opname (unit_cost); entri lama
// tanpa unit_cost bernilai 0. Digerbangi 'opname-report'.
export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'opname-report', 'view');
  if (guard instanceof Response) return guard;
  const { searchParams } = new URL(req.url);
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  if (!from || !to) return Response.json({ error: 'Parameter from & to (yyyy-mm-dd) wajib diisi.' }, { status: 400 });

  const sql = getSql();
  const rows = await sql<{
    id: string; created_at: Date; warehouse_name: string | null; product_name: string | null;
    type: string; qty: string; unit_cost: string | null; note: string | null;
  }[]>`
    select id, created_at, warehouse_name, product_name, type, qty, unit_cost, note
    from stock_ledger
    where kind = 'opname' and created_at >= ${wibDayStart(from).toDate()} and created_at <= ${wibDayEnd(to).toDate()}
    order by created_at desc
    limit 5000
  `;
  const data: OpnameReportRow[] = rows.map(r => {
    const delta = (r.type === 'in' ? 1 : -1) * (Number(r.qty) || 0);
    const unitCost = Number(r.unit_cost) || 0;
    return {
      id: r.id, createdAt: r.created_at.toISOString(), warehouseName: r.warehouse_name ?? '-', productName: r.product_name ?? '-',
      delta, unitCost, value: delta * unitCost, note: r.note ?? '',
    };
  });
  return Response.json({ rows: data, summary: summarizeOpname(data) });
}
