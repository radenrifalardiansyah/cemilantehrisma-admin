import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { seq } from '@/lib/db-seq';
import { wibDateKey } from '@/lib/date';
import { guardStall } from '@/lib/stall-pos-server';
import { rowToSettlement, createSettlementDoc, type SettlementRow } from '@/lib/consign-settlement';
import { auditConsign } from '@/lib/consign-audit';

// Rekap bagi hasil untuk kasir lapak: penjualan titipan yang belum direkap per penitip di lapak ini,
// dan rekap yang sudah dibuat (status belum dibayar/dibayar — pembayaran dilakukan owner).
export async function GET(req: NextRequest) {
  const guard = await guardStall(req, 'view', new URL(req.url).searchParams.get('stallId'));
  if (guard instanceof Response) return guard;
  const sql = getSql();
  const [payables, settlements] = await seq([
    sql<{ consignor_id: string; consignor_name: string; amount: string; qty: string; lines: string; first_at: Date; last_at: Date }[]>`
      select l.consignor_id, l.consignor_name, sum(l.consignor_amount) as amount, sum(l.qty) as qty, count(*) as lines,
             min(l.created_at) as first_at, max(l.created_at) as last_at
      from consign_sale_lines l join stall_sales s on s.id = l.sale_id
      where l.stall_id = ${guard.stall.id} and not l.voided and l.settlement_id is null and s.status = 'paid'
      group by l.consignor_id, l.consignor_name order by l.consignor_name
    `,
    sql<SettlementRow[]>`select * from consign_settlements where stall_id = ${guard.stall.id} order by created_at desc limit 40`,
  ]);
  return Response.json({
    payables: payables.map(p => ({
      consignorId: p.consignor_id, consignorName: p.consignor_name, amount: Number(p.amount), qty: Number(p.qty), lines: Number(p.lines),
      firstDate: wibDateKey(p.first_at), lastDate: wibDateKey(p.last_at),
    })),
    settlements: settlements.map(rowToSettlement),
  });
}

// Kasir membuat rekap untuk satu penitip: semua penjualan titipan yang belum direkap sampai hari ini.
// Pembayaran ke penitip TIDAK dilakukan di sini — owner membayar lewat Titip Jual → Rekap & Bayar.
export async function POST(req: NextRequest) {
  const data = await req.json() as Record<string, unknown>;
  const guard = await guardStall(req, 'create', typeof data.stallId === 'string' ? data.stallId : null);
  if (guard instanceof Response) return guard;
  const { user, stall } = guard;
  const consignorId = typeof data.consignorId === 'string' ? data.consignorId : '';
  if (!consignorId) return Response.json({ error: 'Penitip wajib dipilih.' }, { status: 400 });
  const sql = getSql();
  const [consignor] = await sql<{ id: string; name: string }[]>`select id, name from consignors where id = ${consignorId}`;
  if (!consignor) return Response.json({ error: 'Penitip tidak ditemukan.' }, { status: 400 });

  const result = await createSettlementDoc(sql, {
    stall: { id: stall.id, name: stall.name }, consignor, from: '2000-01-01', to: wibDateKey(new Date()),
    note: typeof data.note === 'string' ? data.note : '', createdBy: user.username,
  });
  if (!result) return Response.json({ error: 'Tidak ada penjualan yang belum direkap untuk penitip ini.' }, { status: 400 });
  await auditConsign(user, 'create', 'settlements', result.id, `Rekap ${result.docNumber} (kasir lapak)`, null, { stall: stall.name, consignor: consignor.name, total: result.total });
  return Response.json(result);
}
