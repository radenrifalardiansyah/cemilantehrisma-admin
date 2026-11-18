import { describe, it, expect } from 'vitest';
import { buildShipmentPlanWaMessage, type ShipmentPlanDraft } from './shipment-plan-wa';
import { shoppingWaFits } from './shopping-wa';

const d = (o: Partial<ShipmentPlanDraft> = {}): ShipmentPlanDraft => ({
  locationId: 'a', locationName: 'BGM 1',
  items: [{ productId: 'p1', productName: 'Keripik Pedas', qty: 10 }, { productId: 'p2', productName: 'Basreng', qty: 5 }], ...o,
});

describe('buildShipmentPlanWaMessage', () => {
  it('per mitra tanpa harga, total per produk dan total semua', () => {
    const m = buildShipmentPlanWaMessage([d(), d({ locationId: 'b', locationName: 'Mba Ani', items: [{ productId: 'p1', productName: 'Keripik Pedas', qty: 20 }] })], { storeName: 'Toko A' });
    expect(m).toContain('*RENCANA KIRIM STOK - Toko A*');
    expect(m).toContain('Jumlah mitra: 2');
    expect(m).toContain('1. *BGM 1*');
    expect(m).toContain('   - Keripik Pedas: 10 pcs');
    expect(m).toContain('   Subtotal: 15 pcs');
    expect(m).toContain('- Keripik Pedas: 30 pcs'); // total per produk
    expect(m).toContain('- Basreng: 5 pcs');
    expect(m).toContain('*Total semua: 35 pcs*');
    expect(m).not.toMatch(/Rp/);
  });
  it('draf mitra sama digabung, item sama dijumlahkan', () => {
    const m = buildShipmentPlanWaMessage([d(), d({ items: [{ productId: 'p1', productName: 'Keripik Pedas', qty: 4 }] })]);
    expect(m).toContain('Jumlah mitra: 1');
    expect(m).toContain('   - Keripik Pedas: 14 pcs');
    expect(m).toContain('*Total semua: 19 pcs*');
  });
  it('ASCII murni, tanpa blok monospace, catatan ikut', () => {
    const m = buildShipmentPlanWaMessage([d({ note: 'Kirim pagi – ya \u{1F600}' })], { storeName: 'Toko — A' });
    expect(/^[\x0a\x20-\x7e]*$/.test(m)).toBe(true);
    expect(m).not.toContain('```');
    expect(m).toContain('Catatan: Kirim pagi - ya');
  });
  it('qty nol diabaikan; mitra tanpa item dilewati', () => {
    const m = buildShipmentPlanWaMessage([d({ items: [{ productId: 'p1', productName: 'X', qty: 0 }] })]);
    expect(m).toContain('Jumlah mitra: 0');
    expect(m).toContain('*Total semua: 0 pcs*');
  });
  it('10 mitra masih muat di batas URL WhatsApp', () => {
    const drafts = Array.from({ length: 10 }, (_, i) => d({ locationId: `l${i}`, locationName: `Mitra ${i + 1}`, items: Array.from({ length: 6 }, (_, j) => ({ productId: `p${j}`, productName: `Produk ${j + 1}`, qty: 10 + j })) }));
    expect(shoppingWaFits(buildShipmentPlanWaMessage(drafts))).toBe(true);
  });
});
