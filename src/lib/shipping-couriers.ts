// Daftar kurir tetap untuk pengiriman pesanan website (dipakai modal "Kirim" di Pesanan dan
// validasi API). Nilai yang disimpan di `orders.shipping_courier` = nama persis di bawah.
export const SHIPPING_COURIERS = [
  'JNE',
  'J&T',
  'SiCepat',
  'AnterAja',
  'Ninja Xpress',
  'Pos Indonesia',
  'Grab/Gojek (instan)',
  'Kurir toko',
  'Lainnya',
] as const;

export type ShippingCourier = (typeof SHIPPING_COURIERS)[number];

export function isShippingCourier(v: unknown): v is ShippingCourier {
  return typeof v === 'string' && (SHIPPING_COURIERS as readonly string[]).includes(v);
}
