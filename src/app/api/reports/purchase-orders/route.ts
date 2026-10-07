import { NextRequest } from 'next/server';
import { getSql, parseJsonb } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { wibDateKey } from '@/lib/date';
import { summarizePo, type PoReportRow } from '@/lib/procurement-report';

// Laporan PO per periode (tanggal PO). Digerbangi 'po-report' — terpisah dari 'materials' supaya
// laporan bisa diberikan ke role yang tidak mengelola Bahan Baku.
export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'po-report', 'view');
  if (guard instanceof Response) return guard;
  const { searchParams } = new URL(req.url);
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  if (!from || !to) return Response.json({ error: 'Parameter from & to (yyyy-mm-dd) wajib diisi.' }, { status: 400 });

  const sql = getSql();
  const rows = await sql<{
    id: string; po_number: string; date: string; supplier_name: string; items: unknown; total: string;
    status: string; expected_date: string | null; received_value: string;
  }[]>`
    select po.id, po.po_number, po.date, po.supplier_name, po.items, po.total, po.status, po.expected_date,
      coalesce((select sum(g.total) from goods_receipts g where g.po_id = po.id and g.status = 'approved'), 0) as received_value
    from purchase_orders po
    where po.date >= ${from} and po.date <= ${to}
    order by po.date desc, po.created_at desc
    limit 5000
  `;
  const today = wibDateKey(new Date());
  const data: PoReportRow[] = rows.map(r => {
    const items = (parseJsonb(r.items as string | { materialName: string; qty: number; unit: string }[] | null) ?? []) as { materialName: string; qty: number; unit: string }[];
    return {
      id: r.id, poNumber: r.po_number, date: r.date, supplierName: r.supplier_name,
      items: items.map(it => `${it.materialName} (${it.qty} ${it.unit})`).join(', '),
      total: Number(r.total), status: r.status, expectedDate: r.expected_date, receivedValue: Number(r.received_value),
      late: !!r.expected_date && r.expected_date < today && ['draft', 'terkirim', 'diterima_sebagian'].includes(r.status),
    };
  });
  return Response.json({ rows: data, summary: summarizePo(data) });
}
