import { NextRequest } from 'next/server';
import { getSql, parseJsonb } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { summarizeGr, type GrReportRow } from '@/lib/procurement-report';

// Laporan GR/DO per periode (tanggal terima). Digerbangi 'gr-report'.
export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'gr-report', 'view');
  if (guard instanceof Response) return guard;
  const { searchParams } = new URL(req.url);
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  if (!from || !to) return Response.json({ error: 'Parameter from & to (yyyy-mm-dd) wajib diisi.' }, { status: 400 });

  const sql = getSql();
  const rows = await sql<{
    id: string; gr_number: string; do_number: string; po_number: string; supplier_name: string; received_date: string;
    items: unknown; total: string; status: string; approved_by: string | null; payment_status: string | null; voided: boolean | null;
  }[]>`
    select g.id, g.gr_number, g.do_number, po.po_number, po.supplier_name, g.received_date, g.items, g.total, g.status,
      g.approved_by, mp.payment_status, mp.voided
    from goods_receipts g
    join purchase_orders po on po.id = g.po_id
    left join material_purchases mp on mp.id = g.purchase_id
    where g.received_date >= ${from} and g.received_date <= ${to}
    order by g.received_date desc, g.created_at desc
    limit 5000
  `;
  const data: GrReportRow[] = rows.map(r => {
    const items = (parseJsonb(r.items as string | { materialName: string; qty: number; unit: string }[] | null) ?? []) as { materialName: string; qty: number; unit: string }[];
    return {
      id: r.id, grNumber: r.gr_number, doNumber: r.do_number, poNumber: r.po_number, supplierName: r.supplier_name,
      receivedDate: r.received_date, items: items.map(it => `${it.materialName} (${it.qty} ${it.unit})`).join(', '),
      total: Number(r.total), status: r.status, approvedBy: r.approved_by, paymentStatus: r.payment_status, purchaseVoided: !!r.voided,
    };
  });
  return Response.json({ rows: data, summary: summarizeGr(data) });
}
