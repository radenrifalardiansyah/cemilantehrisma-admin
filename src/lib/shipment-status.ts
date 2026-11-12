// Status dokumen Kirim Stok (Mitra > Kirim Stok): draft → approved | ditolak.
// Modul MURNI (tanpa import server) supaya dipakai bersama oleh API, laporan, dan ConsignmentTab.
//  - draft    : dokumen saja — tidak menyentuh stok/ledger/laporan; bebas diedit & dihapus.
//  - approved : efek stok berlaku & ikut laporan. Baris lama (sebelum fitur ini) = approved.
//  - ditolak  : final (dari draft); tidak bisa diedit/di-approve, boleh dihapus.

export const SHIPMENT_STATUSES = ['draft', 'approved', 'ditolak'] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

// Satu-satunya nilai yang dipakai filter SQL ("where status = ${SHIPMENT_APPROVED}") di semua pembaca.
export const SHIPMENT_APPROVED: ShipmentStatus = 'approved';

export const SHIPMENT_STATUS_LABEL: Record<ShipmentStatus, string> = { draft: 'Draft', approved: 'Approved', ditolak: 'Ditolak' };

// Nilai tak dikenal/kosong (baris lama, klien lama) dianggap 'approved' — sama dengan default kolom di DB.
export function normalizeShipmentStatus(v: unknown): ShipmentStatus {
  return (SHIPMENT_STATUSES as readonly string[]).includes(v as string) ? (v as ShipmentStatus) : 'approved';
}

export function isApprovedShipment(s: { status?: unknown }): boolean {
  return normalizeShipmentStatus(s.status) === SHIPMENT_APPROVED;
}

// Filter pembaca laporan/analitik/invoice/riwayat: hanya shipment approved yang dihitung.
export function approvedShipments<T extends { status?: unknown }>(list: T[]): T[] {
  return list.filter(isApprovedShipment);
}

export type ShipmentAction = 'edit' | 'delete' | 'approve' | 'reject';

// Aturan transisi. Approved tidak bisa kembali ke draft; ditolak final.
export function canShipmentAct(status: ShipmentStatus, action: ShipmentAction): boolean {
  switch (action) {
    case 'edit': return status === 'draft' || status === 'approved';
    case 'delete': return true;
    case 'approve':
    case 'reject': return status === 'draft';
  }
}

// Pesan penolakan (400/409) bila aksi tidak boleh pada status ini; null bila boleh.
export function shipmentActionBlockedReason(status: ShipmentStatus, action: ShipmentAction): string | null {
  if (canShipmentAct(status, action)) return null;
  if (status === 'ditolak') return 'Pengiriman ini sudah ditolak dan tidak bisa diubah.';
  if (action === 'edit') return 'Pengiriman ini tidak bisa diedit.';
  return status === 'approved' ? 'Pengiriman ini sudah di-approve.' : 'Hanya pengiriman berstatus draft yang bisa diproses.';
}

// Peringatan UI (tidak memblokir): tanggal kirim sudah lebih dari N hari lalu saat di-approve —
// efek ke laporan jatuh di tanggal kirim, bukan hari approve.
export const STALE_APPROVE_DAYS = 7;
export function isStaleShipmentDate(createdAtSeconds: number | undefined | null, nowMs: number = Date.now()): boolean {
  if (!createdAtSeconds) return false;
  return nowMs - createdAtSeconds * 1000 > STALE_APPROVE_DAYS * 24 * 3600 * 1000;
}

// Error yang pesannya AMAN ditampilkan ke user; `status` = kode HTTP respons. Error lain (DB, bug) dianggap
// tak terduga: pesannya tidak boleh bocor ke klien (lihat unexpectedShipmentError di shipment-workflow).
export class ShipmentActionError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

// Batas jumlah draft per request approve massal (diproses berurutan, tiap approve = 1 transaksi). Klien memecah
// pilihan yang lebih besar menjadi batch sebesar ini.
export const BULK_APPROVE_MAX = 25;
