import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { wibDateKey } from '@/lib/date';
import { DATE_RE } from '@/lib/consign-settlement';
import { ConsignStockError } from '@/lib/consign-receipts';
import { ADJUSTMENT_KINDS, createAdjustment, rowToAdjustment, type AdjustmentRow, type AdjustmentKind, type Bearer } from '@/lib/consign-adjustments';
import { auditConsign } from '@/lib/consign-audit';

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'consign', 'view');
  if (guard instanceof Response) return guard;
  const sp = new URL(req.url).searchParams;
  const from = sp.get('from'); const to = sp.get('to'); const stallId = sp.get('stallId');
  const sql = getSql();
  const rows = await sql<AdjustmentRow[]>`
    select * from consign_adjustments
    where true
      ${from && DATE_RE.test(from) ? sql`and doc_date >= ${from}` : sql``}
      ${to && DATE_RE.test(to) ? sql`and doc_date <= ${to}` : sql``}
      ${stallId ? sql`and stall_id = ${stallId}` : sql``}
    order by doc_date desc, created_at desc limit 500
  `;
  const [{ has }] = await sql<{ has: boolean }[]>`select exists(select 1 from consign_adjustments) as has`;
  return Response.json({ adjustments: rows.map(rowToAdjustment), hasAny: has });
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'consign', 'create');
  if (guard instanceof Response) return guard;
  const data = await req.json() as Record<string, unknown>;
  const kind = ADJUSTMENT_KINDS.includes(data.kind as AdjustmentKind) ? data.kind as AdjustmentKind : null;
  if (!kind) return Response.json({ error: 'Jenis penyesuaian tidak valid.' }, { status: 400 });
  const stallId = typeof data.stallId === 'string' ? data.stallId : '';
  if (!stallId) return Response.json({ error: 'Lapak wajib dipilih.' }, { status: 400 });
  const bearer: Bearer = data.bearer === 'toko' ? 'toko' : data.bearer === 'penitip' ? 'penitip' : 'none';
  const docDate = typeof data.docDate === 'string' && DATE_RE.test(data.docDate) ? data.docDate : wibDateKey(new Date());

  const merged = new Map<string, { productId: string; counted?: number; qty?: number }>();
  for (const raw of Array.isArray(data.items) ? data.items as Record<string, unknown>[] : []) {
    const productId = typeof raw.productId === 'string' ? raw.productId : '';
    if (!productId) return Response.json({ error: 'Item tidak valid.' }, { status: 400 });
    if (kind === 'opname') {
      if (raw.counted === undefined || raw.counted === null || raw.counted === '') continue; // tidak dihitung → dilewati
      const counted = Number(raw.counted);
      if (!Number.isFinite(counted) || counted < 0) return Response.json({ error: 'Hitungan fisik tidak valid.' }, { status: 400 });
      merged.set(productId, { productId, counted });
    } else {
      const qty = Number(raw.qty);
      if (!Number.isFinite(qty) || qty <= 0) return Response.json({ error: 'Jumlah harus lebih dari 0.' }, { status: 400 });
      merged.set(productId, { productId, qty: (merged.get(productId)?.qty ?? 0) + qty });
    }
  }
  if (merged.size === 0) return Response.json({ error: kind === 'opname' ? 'Isi hitungan fisik minimal satu produk.' : 'Tambahkan minimal satu produk.' }, { status: 400 });
  // Kerugian wajib menentukan siapa yang menanggung (opname: dipilih hanya relevan bila ada selisih minus).
  if (kind !== 'opname' && bearer === 'none') return Response.json({ error: 'Pilih siapa yang menanggung kerugian (toko atau penitip).' }, { status: 400 });

  const sql = getSql();
  const [stall] = await sql<{ id: string; name: string }[]>`select id, name from stalls where id = ${stallId}`;
  if (!stall) return Response.json({ error: 'Lapak tidak ditemukan.' }, { status: 400 });
  try {
    const result = await sql.begin(tx => createAdjustment(tx, {
      kind, stall, bearer, docDate, note: typeof data.note === 'string' ? data.note.trim().slice(0, 200) : '', createdBy: guard.username, items: [...merged.values()],
    }));
    await auditConsign(guard, 'create', 'adjustments', result.id, `Penyesuaian stok ${result.docNumber}`, null, { kind, stall: stall.name, bearer, totalCompensation: result.totalCompensation });
    return Response.json(result);
  } catch (err) {
    if (err instanceof ConsignStockError) return Response.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
