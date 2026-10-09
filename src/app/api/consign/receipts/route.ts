import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { wibDateKey } from '@/lib/date';
import { rowToReceipt, type ReceiptRow, type ReceiptItem } from '@/lib/consign-pg';
import { createReceipt, ConsignStockError } from '@/lib/consign-receipts';
import { auditConsign } from '@/lib/consign-audit';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'consign', 'view');
  if (guard instanceof Response) return guard;
  const { searchParams } = new URL(req.url);
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  const consignorId = searchParams.get('consignorId');
  const stallId = searchParams.get('stallId');
  const sql = getSql();
  const rows = await sql<ReceiptRow[]>`
    select * from consign_receipts
    where true
      ${from && DATE_RE.test(from) ? sql`and doc_date >= ${from}` : sql``}
      ${to && DATE_RE.test(to) ? sql`and doc_date <= ${to}` : sql``}
      ${consignorId ? sql`and consignor_id = ${consignorId}` : sql``}
      ${stallId ? sql`and stall_id = ${stallId}` : sql``}
    order by doc_date desc, created_at desc
    limit 500
  `;
  // hasAny: apakah ada dokumen sama sekali (di luar filter) — supaya layar kosong awal tetap
  // menampilkan kartu "Terima Barang", bukan "tidak ada yang cocok".
  const [{ has }] = await sql<{ has: boolean }[]>`select exists(select 1 from consign_receipts) as has`;
  return Response.json({ receipts: rows.map(rowToReceipt), hasAny: has });
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'consign', 'create');
  if (guard instanceof Response) return guard;
  const data = await req.json() as Record<string, unknown>;

  const kind = data.kind === 'return' ? 'return' : data.kind === 'in' ? 'in' : null;
  if (!kind) return Response.json({ error: 'Jenis dokumen tidak valid.' }, { status: 400 });
  const consignorId = typeof data.consignorId === 'string' ? data.consignorId : '';
  const stallId = typeof data.stallId === 'string' ? data.stallId : '';
  if (!consignorId) return Response.json({ error: 'Penitip wajib dipilih.' }, { status: 400 });
  if (!stallId) return Response.json({ error: 'Lapak wajib dipilih.' }, { status: 400 });
  const docDate = typeof data.docDate === 'string' && DATE_RE.test(data.docDate) ? data.docDate : wibDateKey(new Date());

  // Gabungkan baris produk yang sama, tolak qty <= 0.
  const merged = new Map<string, number>();
  for (const raw of Array.isArray(data.items) ? data.items as Record<string, unknown>[] : []) {
    const pid = typeof raw.productId === 'string' ? raw.productId : '';
    const qty = Number(raw.qty);
    if (!pid || !Number.isFinite(qty) || qty <= 0) return Response.json({ error: 'Item tidak valid: produk dan jumlah (> 0) wajib diisi.' }, { status: 400 });
    merged.set(pid, (merged.get(pid) ?? 0) + qty);
  }
  if (merged.size === 0) return Response.json({ error: 'Tambahkan minimal satu produk.' }, { status: 400 });

  const sql = getSql();
  const [consignor] = await sql<{ id: string; name: string; is_active: boolean }[]>`select id, name, is_active from consignors where id = ${consignorId}`;
  if (!consignor) return Response.json({ error: 'Penitip tidak ditemukan.' }, { status: 400 });
  const [stall] = await sql<{ id: string; name: string; is_active: boolean }[]>`select id, name, is_active from stalls where id = ${stallId}`;
  if (!stall) return Response.json({ error: 'Lapak tidak ditemukan.' }, { status: 400 });
  if (kind === 'in' && !stall.is_active) return Response.json({ error: 'Lapak nonaktif — tidak bisa menerima barang.' }, { status: 400 });

  const ids = [...merged.keys()];
  const products = await sql<{ id: string; name: string; unit: string; consignor_id: string }[]>`
    select id, name, unit, consignor_id from consign_products where id in ${sql(ids)}
  `;
  if (products.length !== ids.length || products.some(p => p.consignor_id !== consignorId)) {
    return Response.json({ error: 'Ada produk yang bukan milik penitip ini.' }, { status: 400 });
  }
  const items: ReceiptItem[] = products.map(p => ({ productId: p.id, productName: p.name, unit: p.unit, qty: merged.get(p.id)! }));

  try {
    const result = await sql.begin(tx => createReceipt(tx, {
      kind, consignorId, consignorName: consignor.name, stallId, stallName: stall.name,
      docDate, note: (data.note as string) ?? '', createdBy: guard.username, items,
    }));
    await auditConsign(guard, 'create', 'receipts', result.id, `${kind === 'in' ? 'Terima barang' : 'Retur titipan'} ${result.docNumber}`,
      null, { docNumber: result.docNumber, consignor: consignor.name, stall: stall.name, items: items.map(i => ({ name: i.productName, qty: i.qty })) });
    return Response.json(result);
  } catch (err) {
    if (err instanceof ConsignStockError) return Response.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
