import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { rowToReceipt, type ReceiptRow, type ReceiptItem } from '@/lib/consign-pg';
import { voidReceipt, updateReceipt, ConsignStockError } from '@/lib/consign-receipts';
import { auditConsign } from '@/lib/consign-audit';

type Ctx = { params: Promise<{ id: string }> };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Ubah dokumen terima/retur/pindah (jenis & nomor dokumen tetap). Stok dihitung ulang sebagai selisih;
// ditolak kalau selisihnya membuat stok negatif (mis. barang yang diterima sudah terjual).
export async function PUT(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'consign', 'edit');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const data = await req.json() as Record<string, unknown>;
  const sql = getSql();
  const [row] = await sql<ReceiptRow[]>`select * from consign_receipts where id = ${id}`;
  if (!row) return Response.json({ error: 'Dokumen tidak ditemukan.' }, { status: 404 });
  const old = rowToReceipt(row);

  const consignorId = typeof data.consignorId === 'string' ? data.consignorId : '';
  const stallId = typeof data.stallId === 'string' ? data.stallId : '';
  const toStallId = typeof data.toStallId === 'string' ? data.toStallId : '';
  if (!consignorId) return Response.json({ error: 'Penitip wajib dipilih.' }, { status: 400 });
  if (!stallId) return Response.json({ error: 'Lapak wajib dipilih.' }, { status: 400 });
  if (old.kind === 'transfer') {
    if (!toStallId) return Response.json({ error: 'Lapak tujuan wajib dipilih.' }, { status: 400 });
    if (toStallId === stallId) return Response.json({ error: 'Lapak asal dan tujuan tidak boleh sama.' }, { status: 400 });
  }
  const docDate = typeof data.docDate === 'string' && DATE_RE.test(data.docDate) ? data.docDate : old.docDate;
  const merged = new Map<string, number>();
  for (const raw of Array.isArray(data.items) ? data.items as Record<string, unknown>[] : []) {
    const pid = typeof raw.productId === 'string' ? raw.productId : '';
    const qty = Number(raw.qty);
    if (!pid || !Number.isFinite(qty) || qty <= 0) return Response.json({ error: 'Item tidak valid: produk dan jumlah (> 0) wajib diisi.' }, { status: 400 });
    merged.set(pid, (merged.get(pid) ?? 0) + qty);
  }
  if (merged.size === 0) return Response.json({ error: 'Tambahkan minimal satu produk.' }, { status: 400 });

  const [consignor] = await sql<{ id: string; name: string }[]>`select id, name from consignors where id = ${consignorId}`;
  if (!consignor) return Response.json({ error: 'Penitip tidak ditemukan.' }, { status: 400 });
  const [stall] = await sql<{ id: string; name: string; is_active: boolean }[]>`select id, name, is_active from stalls where id = ${stallId}`;
  if (!stall) return Response.json({ error: 'Lapak tidak ditemukan.' }, { status: 400 });
  // Lapak nonaktif hanya ditolak kalau lapaknya diganti ke lapak itu (dokumen lama boleh tetap diedit).
  if (old.kind === 'in' && stallId !== old.stallId && !stall.is_active) return Response.json({ error: 'Lapak nonaktif — tidak bisa menerima barang.' }, { status: 400 });
  let toStall: { id: string; name: string; is_active: boolean } | undefined;
  if (old.kind === 'transfer') {
    [toStall] = await sql<{ id: string; name: string; is_active: boolean }[]>`select id, name, is_active from stalls where id = ${toStallId}`;
    if (!toStall) return Response.json({ error: 'Lapak tujuan tidak ditemukan.' }, { status: 400 });
    if (toStallId !== old.toStallId && !toStall.is_active) return Response.json({ error: 'Lapak tujuan nonaktif.' }, { status: 400 });
  }
  const ids = [...merged.keys()];
  const products = await sql<{ id: string; name: string; unit: string; consignor_id: string }[]>`select id, name, unit, consignor_id from consign_products where id in ${sql(ids)}`;
  if (products.length !== ids.length || products.some(p => p.consignor_id !== consignorId)) {
    return Response.json({ error: 'Ada produk yang bukan milik penitip ini.' }, { status: 400 });
  }
  const items: ReceiptItem[] = products.map(p => ({ productId: p.id, productName: p.name, unit: p.unit, qty: merged.get(p.id)! }));
  const note = typeof data.note === 'string' ? data.note : '';

  try {
    await sql.begin(async tx => {
      // Baca ulang SETELAH dikunci: isi dokumen bisa berubah sejak dibaca di atas (edit/hapus bersamaan).
      const [locked] = await tx<ReceiptRow[]>`select * from consign_receipts where id = ${id} for update`;
      if (!locked) throw new ConsignStockError('Dokumen sudah dihapus.');
      const cur = rowToReceipt(locked);
      await updateReceipt(tx, { id: cur.id, docNumber: cur.docNumber, kind: cur.kind, stallId: cur.stallId, stallName: cur.stallName, toStallId: cur.toStallId, toStallName: cur.toStallName, items: cur.items },
        { consignorId, consignorName: consignor.name, stallId, stallName: stall.name, toStallId: toStall?.id, toStallName: toStall?.name, docDate, note, items });
    });
  } catch (err) {
    if (err instanceof ConsignStockError) return Response.json({ error: err.message }, { status: 400 });
    throw err;
  }
  await auditConsign(guard, 'update', 'receipts', id, `Ubah ${old.docNumber}`,
    { consignor: old.consignorName, stall: old.stallName, docDate: old.docDate, note: old.note, items: old.items.map(i => ({ name: i.productName, qty: i.qty })) },
    { consignor: consignor.name, stall: stall.name, docDate, note, items: items.map(i => ({ name: i.productName, qty: i.qty })) });
  return Response.json({ ok: true, docNumber: old.docNumber });
}

// Hapus dokumen terima/retur/pindah: stok dibalik. Ditolak kalau stok sudah terpakai.
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'consign', 'delete');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const sql = getSql();
  const [row] = await sql<ReceiptRow[]>`select * from consign_receipts where id = ${id}`;
  if (!row) return Response.json({ error: 'Dokumen tidak ditemukan.' }, { status: 404 });
  const r = rowToReceipt(row);
  try {
    await sql.begin(async tx => {
      // Kunci dokumen supaya dua pembatalan bersamaan tidak membalik stok dua kali.
      const [locked] = await tx<ReceiptRow[]>`select * from consign_receipts where id = ${id} for update`;
      if (!locked) throw new ConsignStockError('Dokumen sudah dibatalkan.');
      const cur = rowToReceipt(locked);   // baca ulang setelah dikunci
      await voidReceipt(tx, { id: cur.id, docNumber: cur.docNumber, kind: cur.kind, stallId: cur.stallId, stallName: cur.stallName, toStallId: cur.toStallId, toStallName: cur.toStallName, items: cur.items });
    });
  } catch (err) {
    if (err instanceof ConsignStockError) return Response.json({ error: err.message }, { status: 400 });
    throw err;
  }
  await auditConsign(guard, 'delete', 'receipts', id, `Hapus ${r.docNumber}`, { docNumber: r.docNumber, totalQty: r.totalQty }, null);
  return Response.json({ ok: true });
}
