// Status dokumen Transfer Stok Antar Mitra (Mitra > Transfer Stok):
//   draft -> approved | ditolak ; approved -> dibatalkan (soft cancel, dokumen tetap).
// Modul MURNI (tanpa import server) supaya dipakai bersama oleh API, laporan, dan UI.
//  - draft      : dokumen saja — tidak menyentuh stok; bebas diedit & dihapus.
//  - approved   : stok mitra asal berkurang & mitra tujuan bertambah; ikut laporan. TIDAK bisa diedit/dihapus (hanya dibatalkan).
//  - ditolak    : final (dari draft); boleh dihapus.
//  - dibatalkan : efek stok sudah dibalik; final; boleh dihapus.

export const TRANSFER_STATUSES = ['draft', 'approved', 'ditolak', 'dibatalkan'] as const;
export type TransferStatus = (typeof TRANSFER_STATUSES)[number];

// Satu-satunya nilai yang dipakai filter SQL ("where status = ${TRANSFER_APPROVED}") di semua pembaca laporan.
export const TRANSFER_APPROVED: TransferStatus = 'approved';

export const TRANSFER_STATUS_LABEL: Record<TransferStatus, string> = {
  draft: 'Draft', approved: 'Approved', ditolak: 'Ditolak', dibatalkan: 'Dibatalkan',
};

// Nilai tak dikenal/kosong dianggap 'draft' (paling aman: tidak pernah dihitung sebagai efek stok).
export function normalizeTransferStatus(v: unknown): TransferStatus {
  return (TRANSFER_STATUSES as readonly string[]).includes(v as string) ? (v as TransferStatus) : 'draft';
}

export function isApprovedTransfer(t: { status?: unknown }): boolean {
  return t.status === TRANSFER_APPROVED;
}

// Filter pembaca laporan: hanya transfer approved yang dihitung.
export function approvedTransfers<T extends { status?: unknown }>(list: T[]): T[] {
  return list.filter(isApprovedTransfer);
}

export type TransferAction = 'edit' | 'delete' | 'approve' | 'reject' | 'cancel';

export function canTransferAct(status: TransferStatus, action: TransferAction): boolean {
  switch (action) {
    case 'edit':
    case 'approve':
    case 'reject': return status === 'draft';
    case 'delete': return status !== 'approved';
    case 'cancel': return status === 'approved';
  }
}

// Pesan penolakan (409) bila aksi tidak boleh pada status ini; null bila boleh.
export function transferActionBlockedReason(status: TransferStatus, action: TransferAction): string | null {
  if (canTransferAct(status, action)) return null;
  switch (action) {
    case 'delete': return 'Transfer yang sudah di-approve tidak bisa dihapus — batalkan dulu.';
    case 'cancel': return 'Hanya transfer berstatus approved yang bisa dibatalkan.';
    case 'edit': return status === 'approved' ? 'Transfer yang sudah di-approve tidak bisa diedit — batalkan lalu buat transfer baru.' : 'Hanya transfer berstatus draft yang bisa diedit.';
    default:
      if (status === 'approved') return 'Transfer ini sudah di-approve.';
      if (status === 'ditolak') return 'Transfer ini sudah ditolak dan tidak bisa diubah.';
      if (status === 'dibatalkan') return 'Transfer ini sudah dibatalkan dan tidak bisa diubah.';
      return 'Hanya transfer berstatus draft yang bisa diproses.';
  }
}

// Error yang pesannya AMAN ditampilkan ke user; `status` = kode HTTP respons. Error lain (DB, bug) dianggap
// tak terduga: pesannya tidak boleh bocor ke klien.
export class TransferActionError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

// Item transfer dari body request: qty digabung per produk (produk duplikat dijumlahkan). Murni.
export interface TransferItemInput { productId: string; qty: number }
export function mergeTransferItems(items: TransferItemInput[]): TransferItemInput[] {
  const m = new Map<string, number>();
  for (const it of items) m.set(it.productId, (m.get(it.productId) ?? 0) + (Number(it.qty) || 0));
  return [...m].map(([productId, qty]) => ({ productId, qty }));
}

// Validasi item dari body: minimal 1 baris, productId string, qty angka > 0. Mengembalikan pesan error atau null.
export function invalidTransferItemsMessage(items: unknown): string | null {
  if (!Array.isArray(items) || items.length === 0) return 'Minimal 1 produk dipindahkan.';
  for (const [i, raw] of (items as Partial<TransferItemInput>[]).entries()) {
    if (!raw || typeof raw.productId !== 'string' || !raw.productId) return `Produk pada baris ${i + 1} tidak valid.`;
    if (typeof raw.qty !== 'number' || !Number.isFinite(raw.qty) || raw.qty <= 0) return `Jumlah pada baris ${i + 1} harus berupa angka lebih dari 0.`;
  }
  return null;
}
