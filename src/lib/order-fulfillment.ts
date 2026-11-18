import { isShippingCourier } from '@/lib/shipping-couriers';

// Status layanan/pengiriman pesanan website. Terpisah dari `orders.status` (baru|selesai|dibatalkan):
// mengubah ini TIDAK memotong stok dan tidak memengaruhi laporan — stok tetap hanya dipotong saat 'selesai'.
// null/undefined = "Menunggu konfirmasi" (juga data lama).
export const FULFILLMENT_STATUSES = ['diproses', 'dikirim', 'siap_diambil'] as const;
export type FulfillmentStatus = (typeof FULFILLMENT_STATUSES)[number];

export const TRACKING_NO_MAX = 64;

export const FULFILLMENT_LABEL: Record<FulfillmentStatus, string> = {
  diproses: 'Diproses',
  dikirim: 'Dikirim',
  siap_diambil: 'Siap diambil',
};

export function isFulfillmentStatus(v: unknown): v is FulfillmentStatus {
  return typeof v === 'string' && (FULFILLMENT_STATUSES as readonly string[]).includes(v);
}

export interface FulfillmentOrderState {
  source?: string;
  status: string;
  deliveryMethod?: string;
  fulfillmentStatus?: string | null;
  paymentStatus?: string | null;
}

export interface FulfillmentInput {
  fulfillmentStatus?: unknown;
  shippingCourier?: unknown;
  trackingNo?: unknown;
}

/** Kolom DB yang boleh diubah jalur ini — sengaja hanya tiga kolom fulfillment (bukan status/stock_cut/uang). */
export interface FulfillmentColumns {
  fulfillment_status: FulfillmentStatus;
  shipping_courier: string | null;
  tracking_no: string | null;
}

export type FulfillmentResult =
  | { ok: true; columns: FulfillmentColumns }
  | { ok: false; error: string };

/** Apakah body PUT memuat salah satu kunci fulfillment. */
export function hasFulfillmentKeys(body: object): boolean {
  return 'fulfillmentStatus' in body || 'shippingCourier' in body || 'trackingNo' in body;
}

// Urutan: menunggu(null) -> diproses -> dikirim | siap_diambil. Loncat dari null langsung ke
// dikirim/siap_diambil boleh. Mundur tidak boleh. Status sama = idempotent (dikirim: boleh koreksi kurir/resi).
function rank(s: string | null | undefined): number {
  if (s === 'diproses') return 1;
  if (s === 'dikirim' || s === 'siap_diambil') return 2;
  return 0;
}

/** Status berikut yang boleh dipilih admin untuk pesanan ini (kosong = tidak ada aksi). */
export function nextFulfillmentActions(o: FulfillmentOrderState): FulfillmentStatus[] {
  if (o.source !== 'portal' || o.status !== 'baru') return [];
  const cur = o.fulfillmentStatus ?? null;
  const out: FulfillmentStatus[] = [];
  if (cur === null) out.push('diproses');
  if (rank(cur) < 2) {
    // Pesanan belum lunas tidak boleh dikirim (siap diambil tetap boleh).
    if (o.deliveryMethod === 'delivery') { if (o.paymentStatus !== 'belum_lunas') out.push('dikirim'); }
    else if (o.deliveryMethod === 'pickup') out.push('siap_diambil');
  }
  return out;
}

export function validateFulfillmentUpdate(o: FulfillmentOrderState, input: FulfillmentInput): FulfillmentResult {
  const fail = (error: string): FulfillmentResult => ({ ok: false, error });
  const next = input.fulfillmentStatus;
  if (!isFulfillmentStatus(next)) return fail('Status layanan tidak valid.');
  if (o.source !== 'portal') return fail('Status layanan hanya untuk pesanan Website.');
  if (o.status !== 'baru') return fail('Status layanan tidak bisa diubah pada pesanan yang sudah selesai atau dibatalkan.');
  if (rank(next) < rank(o.fulfillmentStatus)) return fail('Status layanan tidak bisa dimundurkan.');
  if (rank(o.fulfillmentStatus) === 2 && next !== o.fulfillmentStatus) return fail('Pesanan sudah dikirim/siap diambil, status tidak bisa diganti.');

  if (next === 'dikirim') {
    if (o.deliveryMethod !== 'delivery') return fail('Hanya pesanan antar (delivery) yang bisa berstatus Dikirim.');
    // Koreksi kurir/resi pada pesanan yang sudah Dikirim tetap boleh.
    if (o.paymentStatus === 'belum_lunas' && o.fulfillmentStatus !== 'dikirim') return fail('Pesanan belum lunas, tidak bisa ditandai Dikirim. Catat pembayaran dulu.');
    if (!isShippingCourier(input.shippingCourier)) return fail('Pilih kurir dari daftar.');
    const resi = typeof input.trackingNo === 'string' ? input.trackingNo.trim() : '';
    if (!resi) return fail('No. resi wajib diisi.');
    if (resi.length > TRACKING_NO_MAX) return fail(`No. resi maksimal ${TRACKING_NO_MAX} karakter.`);
    if (!/^[A-Za-z0-9 ._\/-]+$/.test(resi)) return fail('No. resi hanya boleh huruf, angka, spasi, titik, garis miring, atau strip.');
    return { ok: true, columns: { fulfillment_status: 'dikirim', shipping_courier: input.shippingCourier, tracking_no: resi } };
  }
  if (next === 'siap_diambil' && o.deliveryMethod !== 'pickup') {
    return fail('Hanya pesanan ambil di toko (pickup) yang bisa berstatus Siap diambil.');
  }
  if (input.shippingCourier != null && input.shippingCourier !== '') return fail('Kurir hanya untuk status Dikirim.');
  if (input.trackingNo != null && input.trackingNo !== '') return fail('No. resi hanya untuk status Dikirim.');
  return { ok: true, columns: { fulfillment_status: next, shipping_courier: null, tracking_no: null } };
}

export interface FulfillmentMessageData {
  storeName: string;
  storeAddress?: string;
  customerName: string;
  invoiceNo: string;
  /** 'selesai' = status pesanan selesai; selain itu nilai fulfillment_status. */
  state: FulfillmentStatus | 'selesai';
  courier?: string;
  trackingNo?: string;
}

/** Status yang punya templat WA untuk pesanan ini, atau null (menunggu konfirmasi / dibatalkan / bukan website). */
export function whatsAppStateOf(o: FulfillmentOrderState): FulfillmentStatus | 'selesai' | null {
  if (o.source !== 'portal' || o.status === 'dibatalkan') return null;
  if (o.status === 'selesai') return 'selesai';
  return isFulfillmentStatus(o.fulfillmentStatus) ? o.fulfillmentStatus : null;
}

// ASCII murni (tanpa emoji/en-dash), tanpa blok monospace, satu baris per data.
export function buildFulfillmentMessage(d: FulfillmentMessageData): string {
  const head = `*${d.storeName.toUpperCase()}*\n\nHalo *${d.customerName}*,`;
  const foot = `\n\nTerima kasih.\n_${d.storeName}_`;
  switch (d.state) {
    case 'diproses':
      return `${head}\nPesanan ${d.invoiceNo} sudah kami terima dan sedang diproses.${foot}`;
    case 'dikirim':
      return `${head}\nPesanan ${d.invoiceNo} sudah kami kirim.\nKurir : ${d.courier ?? '-'}\nNo. Resi : ${d.trackingNo ?? '-'}${foot}`;
    case 'siap_diambil':
      return `${head}\nPesanan ${d.invoiceNo} sudah siap diambil di toko.${d.storeAddress ? `\nAlamat toko : ${d.storeAddress}` : ''}${foot}`;
    case 'selesai':
      return `${head}\nPesanan ${d.invoiceNo} sudah selesai.\nTerima kasih telah berbelanja di ${d.storeName}.\n_${d.storeName}_`;
  }
}
