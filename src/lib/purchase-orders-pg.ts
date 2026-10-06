import { parseJsonb } from '@/lib/db';
import { toTimestamp } from '@/lib/orders-pg';
import type { PgTx } from '@/lib/doc-number';

// Purchase Order (PO) & Penerimaan Barang (GR/DO) untuk Bahan Baku. Shape JSON ke frontend
// camelCase seperti materials-pg.ts. PO tidak menyentuh stok/keuangan; baru saat GR di-approve
// dibuat baris `material_purchases` (lihat material-purchase-core.ts).

export type PoStatus = 'draft' | 'terkirim' | 'diterima_sebagian' | 'diterima' | 'batal';
export type GrStatus = 'draft' | 'approved' | 'dibatalkan';

export interface PoItem { materialId: string; materialName: string; unit: string; qty: number; price: number; subtotal: number }
export interface GrItem extends PoItem { orderedQty: number }

export interface PoRow {
  id: string; po_number: string; supplier_id: string | null; supplier_name: string; supplier_phone: string;
  items: unknown; total: string; date: string; expected_date: string | null; note: string;
  status: string; token: string; sent_at: Date | null; cancel_note: string | null; created_by: string | null;
  created_at: Date; updated_at: Date | null;
}
export function rowToPo(r: PoRow, opts?: { includeToken?: boolean }) {
  return {
    id: r.id, poNumber: r.po_number, supplierId: r.supplier_id, supplierName: r.supplier_name, supplierPhone: r.supplier_phone,
    items: (parseJsonb(r.items as string | PoItem[] | null) as PoItem[] | null) ?? [],
    total: Number(r.total), date: r.date, expectedDate: r.expected_date, note: r.note,
    status: r.status as PoStatus, sentAt: toTimestamp(r.sent_at), cancelNote: r.cancel_note, createdBy: r.created_by,
    ...(opts?.includeToken ? { token: r.token } : {}),
    createdAt: toTimestamp(r.created_at), updatedAt: toTimestamp(r.updated_at),
  };
}

export interface GrRow {
  id: string; gr_number: string; do_number: string; supplier_do_number: string; po_id: string;
  items: unknown; total: string; received_date: string; note: string; status: string;
  wallet_id: string | null; payment_status: string | null; purchase_id: string | null; token: string;
  created_by: string | null; approved_by: string | null; approved_at: Date | null;
  cancelled_at: Date | null; cancel_note: string | null;
  created_at: Date; updated_at: Date | null;
  po_number?: string | null; supplier_name?: string | null;
}
export function rowToGr(r: GrRow, opts?: { includeToken?: boolean }) {
  return {
    id: r.id, grNumber: r.gr_number, doNumber: r.do_number, supplierDoNumber: r.supplier_do_number, poId: r.po_id,
    poNumber: r.po_number ?? null, supplierName: r.supplier_name ?? null,
    items: (parseJsonb(r.items as string | GrItem[] | null) as GrItem[] | null) ?? [],
    total: Number(r.total), receivedDate: r.received_date, note: r.note, status: r.status as GrStatus,
    walletId: r.wallet_id, paymentStatus: r.payment_status, purchaseId: r.purchase_id,
    createdBy: r.created_by, approvedBy: r.approved_by, approvedAt: toTimestamp(r.approved_at),
    cancelledAt: toTimestamp(r.cancelled_at), cancelNote: r.cancel_note,
    ...(opts?.includeToken ? { token: r.token } : {}),
    createdAt: toTimestamp(r.created_at), updatedAt: toTimestamp(r.updated_at),
  };
}

// Qty yang sudah diterima per bahan untuk satu PO — hanya GR berstatus approved yang dihitung.
export async function receivedByMaterial(pgTx: PgTx, poId: string, excludeGrId?: string): Promise<Map<string, number>> {
  const rows = await pgTx<{ items: unknown }[]>`
    select items from goods_receipts where po_id = ${poId} and status = 'approved' and id != ${excludeGrId ?? ''}
  `;
  const received = new Map<string, number>();
  for (const r of rows) {
    for (const it of (parseJsonb(r.items as string | GrItem[] | null) as GrItem[] | null) ?? []) {
      received.set(it.materialId, (received.get(it.materialId) ?? 0) + it.qty);
    }
  }
  return received;
}

// Hitung ulang status PO dari GR yang approved: diterima (semua item terpenuhi) / diterima_sebagian /
// kembali ke terkirim (sudah pernah dikirim) atau draft. PO yang `batal` tidak disentuh.
// Dipanggil setelah approve & pembatalan GR, di dalam transaksi yang sama.
export async function recalcPoStatus(pgTx: PgTx, poId: string): Promise<PoStatus> {
  const [po] = await pgTx<{ items: unknown; status: string; sent_at: Date | null }[]>`
    select items, status, sent_at from purchase_orders where id = ${poId} for update
  `;
  if (!po) throw new Error('PO tidak ditemukan.');
  if (po.status === 'batal') return 'batal';
  const items = (parseJsonb(po.items as string | PoItem[] | null) as PoItem[] | null) ?? [];
  const received = await receivedByMaterial(pgTx, poId);
  const anyReceived = [...received.values()].some(q => q > 0);
  const ordered = new Map<string, number>();
  items.forEach(it => ordered.set(it.materialId, (ordered.get(it.materialId) ?? 0) + it.qty));
  const complete = [...ordered].every(([mid, q]) => (received.get(mid) ?? 0) >= q);
  const status: PoStatus = anyReceived ? (complete ? 'diterima' : 'diterima_sebagian') : (po.sent_at ? 'terkirim' : 'draft');
  await pgTx`update purchase_orders set status = ${status}, updated_at = now() where id = ${poId}`;
  return status;
}

// PO digabung per bahan (bahan yang sama di dua baris dijumlah, harga = rata-rata tertimbang).
export function mergePoItems(poItems: PoItem[]): PoItem[] {
  const merged = new Map<string, PoItem>();
  for (const it of poItems) {
    const m = merged.get(it.materialId);
    if (m) { m.qty += it.qty; m.subtotal += it.subtotal; m.price = m.qty > 0 ? m.subtotal / m.qty : 0; }
    else merged.set(it.materialId, { ...it });
  }
  return [...merged.values()];
}

// Sisa yang belum diterima per bahan (dasar prefill GR dan batas qty saat simpan/approve).
export function remainingItems(poItems: PoItem[], received: Map<string, number>): GrItem[] {
  const out: GrItem[] = [];
  for (const it of mergePoItems(poItems)) {
    const remaining = it.qty - (received.get(it.materialId) ?? 0);
    if (remaining > 0) out.push({ ...it, orderedQty: it.qty, qty: remaining, subtotal: remaining * it.price });
  }
  return out;
}

export interface GrItemInput { materialId: string; qty: number; price?: number }

// Susun item GR dari isian user: qty 0 dibuang, qty tidak boleh melebihi sisa PO, nama/satuan
// diambil dari PO (bukan dari klien), harga boleh beda dari PO (harga di nota supplier).
// Melempar Error (pesan siap tampil) kalau tidak valid.
export function buildGrItems(poItems: PoItem[], received: Map<string, number>, input: GrItemInput[]): GrItem[] {
  const remaining = new Map(remainingItems(poItems, received).map(r => [r.materialId, r]));
  const sums = new Map<string, number>();
  const out: GrItem[] = [];
  for (const row of input) {
    const qty = Number(row.qty);
    if (!Number.isFinite(qty) || qty < 0) throw new Error('Jumlah diterima harus angka 0 atau lebih.');
    if (qty === 0) continue;
    const rem = remaining.get(row.materialId);
    if (!rem) throw new Error('Ada bahan yang tidak ada di PO ini atau sudah diterima penuh.');
    const price = row.price === undefined ? rem.price : Number(row.price);
    if (!Number.isFinite(price) || price < 0) throw new Error(`Harga "${rem.materialName}" harus angka 0 atau lebih.`);
    const sum = (sums.get(row.materialId) ?? 0) + qty;
    if (sum > rem.qty + 1e-9) throw new Error(`Jumlah "${rem.materialName}" melebihi sisa PO (${rem.qty} ${rem.unit}).`);
    sums.set(row.materialId, sum);
    out.push({ materialId: rem.materialId, materialName: rem.materialName, unit: rem.unit, orderedQty: rem.orderedQty, qty, price, subtotal: qty * price });
  }
  if (out.length === 0) throw new Error('Isi jumlah diterima minimal untuk 1 bahan.');
  return out;
}
