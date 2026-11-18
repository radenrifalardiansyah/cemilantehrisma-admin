import { describe, expect, it } from 'vitest';
import {
  buildFulfillmentMessage, hasFulfillmentKeys, nextFulfillmentActions, validateFulfillmentUpdate, whatsAppStateOf,
  TRACKING_NO_MAX, type FulfillmentOrderState,
} from './order-fulfillment';
import { SHIPPING_COURIERS } from './shipping-couriers';

const delivery: FulfillmentOrderState = { source: 'portal', status: 'baru', deliveryMethod: 'delivery', fulfillmentStatus: null };
const pickup: FulfillmentOrderState = { source: 'portal', status: 'baru', deliveryMethod: 'pickup', fulfillmentStatus: null };

describe('validateFulfillmentUpdate', () => {
  it('menunggu -> diproses, kolom hanya fulfillment (tidak ada status/stok)', () => {
    const r = validateFulfillmentUpdate(delivery, { fulfillmentStatus: 'diproses' });
    expect(r).toEqual({ ok: true, columns: { fulfillment_status: 'diproses', shipping_courier: null, tracking_no: null } });
    if (r.ok) {
      // Bukti: jalur ini tidak pernah menghasilkan kolom status/stock_cut -> tidak ada pemotongan stok.
      expect(Object.keys(r.columns).sort()).toEqual(['fulfillment_status', 'shipping_courier', 'tracking_no']);
    }
  });
  it('boleh loncat langsung dari menunggu ke dikirim / siap_diambil', () => {
    expect(validateFulfillmentUpdate(delivery, { fulfillmentStatus: 'dikirim', shippingCourier: 'JNE', trackingNo: ' ABC123 ' }))
      .toEqual({ ok: true, columns: { fulfillment_status: 'dikirim', shipping_courier: 'JNE', tracking_no: 'ABC123' } });
    expect(validateFulfillmentUpdate(pickup, { fulfillmentStatus: 'siap_diambil' }).ok).toBe(true);
  });
  it('dikirim wajib kurir dari daftar dan resi (trim, batas panjang)', () => {
    expect(validateFulfillmentUpdate(delivery, { fulfillmentStatus: 'dikirim', trackingNo: 'X' }).ok).toBe(false);
    expect(validateFulfillmentUpdate(delivery, { fulfillmentStatus: 'dikirim', shippingCourier: 'Ekspedisi X', trackingNo: 'X' }).ok).toBe(false);
    expect(validateFulfillmentUpdate(delivery, { fulfillmentStatus: 'dikirim', shippingCourier: 'JNE', trackingNo: '   ' }).ok).toBe(false);
    expect(validateFulfillmentUpdate(delivery, { fulfillmentStatus: 'dikirim', shippingCourier: 'JNE', trackingNo: 'A'.repeat(TRACKING_NO_MAX + 1) }).ok).toBe(false);
    expect(validateFulfillmentUpdate(delivery, { fulfillmentStatus: 'dikirim', shippingCourier: 'JNE', trackingNo: 'A'.repeat(TRACKING_NO_MAX) }).ok).toBe(true);
    for (const c of SHIPPING_COURIERS) {
      expect(validateFulfillmentUpdate(delivery, { fulfillmentStatus: 'dikirim', shippingCourier: c, trackingNo: '1' }).ok).toBe(true);
    }
  });
  it('delivery vs pickup harus sesuai', () => {
    expect(validateFulfillmentUpdate(pickup, { fulfillmentStatus: 'dikirim', shippingCourier: 'JNE', trackingNo: '1' }).ok).toBe(false);
    expect(validateFulfillmentUpdate(delivery, { fulfillmentStatus: 'siap_diambil' }).ok).toBe(false);
    expect(validateFulfillmentUpdate({ ...delivery, deliveryMethod: undefined }, { fulfillmentStatus: 'dikirim', shippingCourier: 'JNE', trackingNo: '1' }).ok).toBe(false);
  });
  it('hanya source portal dan status baru', () => {
    expect(validateFulfillmentUpdate({ ...delivery, source: 'kasir' }, { fulfillmentStatus: 'diproses' }).ok).toBe(false);
    expect(validateFulfillmentUpdate({ ...delivery, status: 'selesai' }, { fulfillmentStatus: 'diproses' }).ok).toBe(false);
    expect(validateFulfillmentUpdate({ ...delivery, status: 'dibatalkan' }, { fulfillmentStatus: 'diproses' }).ok).toBe(false);
  });
  it('nilai tidak dikenal ditolak; tidak boleh mundur; kurir/resi hanya untuk dikirim', () => {
    expect(validateFulfillmentUpdate(delivery, { fulfillmentStatus: 'selesai' }).ok).toBe(false);
    expect(validateFulfillmentUpdate(delivery, { fulfillmentStatus: null }).ok).toBe(false);
    expect(validateFulfillmentUpdate({ ...delivery, fulfillmentStatus: 'dikirim' }, { fulfillmentStatus: 'diproses' }).ok).toBe(false);
    expect(validateFulfillmentUpdate({ ...delivery, fulfillmentStatus: 'dikirim' }, { fulfillmentStatus: 'dikirim', shippingCourier: 'J&T', trackingNo: 'Z9' }).ok).toBe(true);
    expect(validateFulfillmentUpdate({ ...pickup, fulfillmentStatus: 'diproses' }, { fulfillmentStatus: 'diproses' }).ok).toBe(true);
    expect(validateFulfillmentUpdate(delivery, { fulfillmentStatus: 'diproses', trackingNo: 'X' }).ok).toBe(false);
  });
});

describe('nextFulfillmentActions & hasFulfillmentKeys', () => {
  it('aksi berikutnya sesuai metode dan posisi', () => {
    expect(nextFulfillmentActions(delivery)).toEqual(['diproses', 'dikirim']);
    expect(nextFulfillmentActions(pickup)).toEqual(['diproses', 'siap_diambil']);
    expect(nextFulfillmentActions({ ...delivery, fulfillmentStatus: 'diproses' })).toEqual(['dikirim']);
    expect(nextFulfillmentActions({ ...delivery, fulfillmentStatus: 'dikirim' })).toEqual([]);
    expect(nextFulfillmentActions({ ...pickup, fulfillmentStatus: 'siap_diambil' })).toEqual([]);
    expect(nextFulfillmentActions({ ...delivery, source: 'kasir' })).toEqual([]);
    expect(nextFulfillmentActions({ ...delivery, status: 'selesai' })).toEqual([]);
  });
  it('deteksi kunci body', () => {
    expect(hasFulfillmentKeys({ status: 'selesai' })).toBe(false);
    expect(hasFulfillmentKeys({ trackingNo: 'x' })).toBe(true);
  });
});

describe('pesan WhatsApp', () => {
  const base = { storeName: 'Cemilan Teh Risma', customerName: 'Budi', invoiceNo: 'INV-1' };
  it('semua templat ASCII murni tanpa blok monospace', () => {
    const msgs = [
      buildFulfillmentMessage({ ...base, state: 'diproses' }),
      buildFulfillmentMessage({ ...base, state: 'dikirim', courier: 'JNE', trackingNo: 'ABC' }),
      buildFulfillmentMessage({ ...base, state: 'siap_diambil', storeAddress: 'Jl. Mawar 1, Bandung' }),
      buildFulfillmentMessage({ ...base, state: 'selesai' }),
    ];
    for (const m of msgs) {
      expect(m).toMatch(/^[\x20-\x7E\n]+$/);
      expect(m).not.toContain('```');
    }
  });
  it('isi per status', () => {
    expect(buildFulfillmentMessage({ ...base, state: 'diproses' })).toContain('Pesanan INV-1 sudah kami terima dan sedang diproses.');
    const kirim = buildFulfillmentMessage({ ...base, state: 'dikirim', courier: 'J&T', trackingNo: 'R123' });
    expect(kirim).toContain('Kurir : J&T');
    expect(kirim).toContain('No. Resi : R123');
    expect(buildFulfillmentMessage({ ...base, state: 'siap_diambil' })).toContain('siap diambil di toko');
    expect(buildFulfillmentMessage({ ...base, state: 'selesai' })).toContain('Terima kasih');
  });
  it('whatsAppStateOf', () => {
    expect(whatsAppStateOf(delivery)).toBeNull();
    expect(whatsAppStateOf({ ...delivery, fulfillmentStatus: 'dikirim' })).toBe('dikirim');
    expect(whatsAppStateOf({ ...delivery, status: 'selesai' })).toBe('selesai');
    expect(whatsAppStateOf({ ...delivery, status: 'dibatalkan', fulfillmentStatus: 'diproses' })).toBeNull();
    expect(whatsAppStateOf({ ...delivery, source: 'kasir', fulfillmentStatus: 'diproses' })).toBeNull();
  });
});

describe('celah validasi resi (review QA)', () => {
  it('resi yang lolos validator tidak boleh merusak pesan WA (ASCII murni, satu baris, tanpa blok monospace)', () => {
    const resi = 'AB\n```‮x';
    const v = validateFulfillmentUpdate(delivery, { fulfillmentStatus: 'dikirim', shippingCourier: 'JNE', trackingNo: resi });
    if (!v.ok) return; // bila validator menolak, aman
    const msg = buildFulfillmentMessage({ storeName: 'Toko', customerName: 'Budi', invoiceNo: 'INV-1', state: 'dikirim', courier: 'JNE', trackingNo: v.columns.tracking_no ?? '' });
    expect(msg).toMatch(/^[\x20-\x7E\n]+$/);
    expect(msg).not.toContain('```');
    expect(msg).not.toMatch(/No\. Resi : [^\n]*\n[^\n]*\n\nTerima kasih/); // resi tidak menambah baris
  });
});

describe('pembatasan Dikirim untuk pesanan belum lunas', () => {
  const base = { source: 'portal', status: 'baru', deliveryMethod: 'delivery', fulfillmentStatus: 'diproses' as string | null, paymentStatus: 'belum_lunas' };
  const kirim = { fulfillmentStatus: 'dikirim', shippingCourier: 'JNE', trackingNo: 'JNE123' };
  it('belum lunas: Dikirim ditolak dan tombol Kirim tidak muncul', () => {
    expect(validateFulfillmentUpdate(base, kirim).ok).toBe(false);
    expect(nextFulfillmentActions(base)).toEqual([]);
  });
  it('lunas: Dikirim boleh', () => {
    expect(validateFulfillmentUpdate({ ...base, paymentStatus: 'lunas' }, kirim).ok).toBe(true);
    expect(nextFulfillmentActions({ ...base, paymentStatus: 'lunas' })).toEqual(['dikirim']);
  });
  it('sudah Dikirim lalu belum lunas: koreksi resi tetap boleh', () => {
    expect(validateFulfillmentUpdate({ ...base, fulfillmentStatus: 'dikirim' }, kirim).ok).toBe(true);
  });
  it('pickup belum lunas: Siap diambil tetap boleh', () => {
    expect(validateFulfillmentUpdate({ ...base, deliveryMethod: 'pickup' }, { fulfillmentStatus: 'siap_diambil' }).ok).toBe(true);
  });
});
