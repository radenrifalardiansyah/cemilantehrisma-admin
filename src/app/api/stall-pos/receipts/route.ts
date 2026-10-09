import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { wibDateKey } from '@/lib/date';
import { guardStall } from '@/lib/stall-pos-server';
import { createReceipt, ConsignStockError } from '@/lib/consign-receipts';
import { rowToReceipt, type ReceiptRow, type ReceiptItem } from '@/lib/consign-pg';
import { auditConsign } from '@/lib/consign-audit';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Penerimaan barang titipan yang dicatat kasir pada hari tertentu di lapaknya (hanya baca).
export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams;
  const guard = await guardStall(req, 'view', sp.get('stallId'));
  if (guard instanceof Response) return guard;
  const date = sp.get('date') && DATE_RE.test(sp.get('date')!) ? sp.get('date')! : wibDateKey(new Date());
  const sql = getSql();
  const rows = await sql<ReceiptRow[]>`
    select * from consign_receipts where stall_id = ${guard.stall.id} and doc_date = ${date} order by created_at desc limit 100
  `;
  return Response.json({ receipts: rows.map(rowToReceipt), date });
}

// Kasir lapak mencatat TERIMA barang titipan di lapaknya sendiri — stok langsung bertambah. Dibatasi:
// hanya lapak yang ditugaskan padanya, hanya produk yang SUDAH didaftarkan admin di lapak itu (kasir
// tidak bisa menambah produk/mengubah harga & skema), dan hanya terima (retur/pembatalan tetap admin).
// Boleh sebelum shift dibuka — barang biasanya datang pagi, sebelum jualan.
export async function POST(req: NextRequest) {
  const data = await req.json() as Record<string, unknown>;
  const guard = await guardStall(req, 'create', typeof data.stallId === 'string' ? data.stallId : null);
  if (guard instanceof Response) return guard;
  const { user, stall } = guard;
  if (!stall.is_active) return Response.json({ error: 'Lapak nonaktif.' }, { status: 400 });
  const consignorId = typeof data.consignorId === 'string' ? data.consignorId : '';
  if (!consignorId) return Response.json({ error: 'Penitip wajib dipilih.' }, { status: 400 });

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
  if (!consignor || !consignor.is_active) return Response.json({ error: 'Penitip tidak ditemukan atau nonaktif.' }, { status: 400 });

  const ids = [...merged.keys()];
  // Hanya produk milik penitip ini yang SUDAH terdaftar di lapak ini (ada baris stok lapak) dan aktif.
  const products = await sql<{ id: string; name: string; unit: string }[]>`
    select p.id, p.name, p.unit
    from consign_products p join consign_stall_items si on si.product_id = p.id and si.stall_id = ${stall.id}
    where p.id in ${sql(ids)} and p.consignor_id = ${consignorId} and p.is_active
  `;
  if (products.length !== ids.length) {
    return Response.json({ error: 'Ada produk yang belum didaftarkan di lapak ini atau bukan milik penitip tersebut. Minta admin menambahkannya dulu.' }, { status: 400 });
  }
  const items: ReceiptItem[] = products.map(p => ({ productId: p.id, productName: p.name, unit: p.unit, qty: merged.get(p.id)! }));
  const note = typeof data.note === 'string' ? data.note.trim().slice(0, 200) : '';

  try {
    const result = await sql.begin(tx => createReceipt(tx, {
      kind: 'in', consignorId, consignorName: consignor.name, stallId: stall.id, stallName: stall.name,
      docDate: wibDateKey(new Date()), note, createdBy: user.username, items,
    }));
    await auditConsign(user, 'create', 'receipts', result.id, `Terima barang ${result.docNumber} (kasir lapak)`,
      null, { docNumber: result.docNumber, consignor: consignor.name, stall: stall.name, items: items.map(i => ({ name: i.productName, qty: i.qty })) });
    return Response.json(result);
  } catch (err) {
    if (err instanceof ConsignStockError) return Response.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
