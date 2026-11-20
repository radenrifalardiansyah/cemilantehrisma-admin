// Nomor urutan pengiriman (consignment_shipments.delivery_seq): bilangan bulat 1..999, kosong = belum diurutkan.
export const DELIVERY_SEQ_MAX = 999;

/** undefined/null/'' -> null (kosong); angka valid -> integer; selain itu -> 'invalid'. */
export function parseDeliverySeq(v: unknown): number | null | 'invalid' {
  if (v === undefined || v === null || v === '') return null;
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (!Number.isInteger(n) || n < 1 || n > DELIVERY_SEQ_MAX) return 'invalid';
  return n;
}
