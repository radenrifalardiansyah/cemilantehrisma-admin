import { NextRequest } from 'next/server';
import { randomUUID, randomBytes } from 'crypto';
import { getDb } from '@/lib/firebase-admin';
import { getSql, parseJsonb } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logHistory } from '@/lib/history';
import { nextDocNumber, periodOf, supplierDoCode } from '@/lib/doc-number';
import { rowToGr, receivedByMaterial, remainingItems, mergePoItems, type GrRow, type PoRow, type PoItem } from '@/lib/purchase-orders-pg';
import { wibDateKey } from '@/lib/date';

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'materials', 'view');
  if (guard instanceof Response) return guard;
  const sql = getSql();
  const rows = await sql<GrRow[]>`
    select g.*, po.po_number, po.supplier_name, po.supplier_id,
      coalesce(nullif(po.supplier_phone, ''), s.phone, '') as supplier_phone, coalesce(s.address, '') as supplier_address
    from goods_receipts g join purchase_orders po on po.id = g.po_id
    left join suppliers s on s.id = po.supplier_id
    order by g.created_at desc
  `;
  return Response.json({ goodsReceipts: rows.map(r => rowToGr(r)) });
}

// "Buat GR" dari sebuah PO — satu klik: item terisi otomatis dari sisa PO yang belum diterima,
// nomor GR & DO terbuat bersamaan. Nomor DO memuat kode supplier & berurut per supplier
// (DO-SUP001-202610-0001). Qty/harga diedit setelahnya (PUT) sebelum approve.
export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'materials', 'create');
  if (guard instanceof Response) return guard;
  const { poId, receivedDate, note } = await req.json() as {
    poId: string; receivedDate?: string; note?: string;
  };
  if (!poId) return Response.json({ error: 'poId wajib diisi.' }, { status: 400 });
  const receivedOn = receivedDate || wibDateKey(new Date());
  const sql = getSql();
  const id = randomUUID();
  const token = randomBytes(16).toString('hex');
  let grNumber = '';
  let doNumber = '';
  let total = 0;
  let poNumber = '';
  try {
    await sql.begin(async pgTx => {
      const [po] = await pgTx<PoRow[]>`select * from purchase_orders where id = ${poId} for update`;
      if (!po) throw new Error('PO tidak ditemukan.');
      if (po.status === 'batal') throw new Error('PO ini sudah dibatalkan.');
      if (po.status === 'diterima') throw new Error('PO ini sudah diterima penuh.');
      poNumber = po.po_number;
      const [{ exists }] = await pgTx<{ exists: boolean }[]>`select exists(select 1 from goods_receipts where po_id = ${poId} and status = 'draft') as exists`;
      if (exists) throw new Error('PO ini masih punya GR draft. Selesaikan (approve/batalkan) dulu.');

      const poItems = mergePoItems((parseJsonb(po.items as string | PoItem[] | null) as PoItem[] | null) ?? []);
      const items = remainingItems(poItems, await receivedByMaterial(pgTx, poId));
      if (items.length === 0) throw new Error('Semua item PO ini sudah diterima.');
      total = items.reduce((s, it) => s + it.subtotal, 0);
      const period = periodOf(receivedOn);
      const [sup] = po.supplier_id ? await pgTx<{ code: string | null }[]>`select code from suppliers where id = ${po.supplier_id}` : [];
      const supCode = supplierDoCode(sup?.code, po.supplier_name);
      grNumber = await nextDocNumber(pgTx, 'GR', period);
      doNumber = await nextDocNumber(pgTx, `DO-${supCode}`, period);
      await pgTx`
        insert into goods_receipts (id, gr_number, do_number, po_id, items, total, received_date, note, status, token, created_by, created_at)
        values (${id}, ${grNumber}, ${doNumber}, ${poId}, ${JSON.stringify(items)}, ${total}, ${receivedOn}, ${note ?? ''}, 'draft', ${token}, ${guard.username}, now())
      `;
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal membuat GR.' }, { status: 400 });
  }
  try {
    await logHistory(getDb(), {
      entity: 'goods-receipts', entityId: id, entityLabel: `${grNumber} (${poNumber}) - Rp${total}`,
      action: 'create', actor: guard, after: { grNumber, doNumber, poId, total, receivedDate: receivedOn },
    });
  } catch (err) {
    console.error('Failed to write history for GR create', err);
  }
  return Response.json({ id, grNumber, doNumber });
}
