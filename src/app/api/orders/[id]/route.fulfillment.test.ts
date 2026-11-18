import { beforeEach, describe, expect, it, vi } from 'vitest';

// Tes integrasi ringan cabang PUT "status layanan" di route pesanan: DB dan layanan luar di-mock
// (tidak ada koneksi nyata). Yang dibuktikan: SQL apa saja yang dijalankan, bukan perilaku Postgres.

const state = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  queries: [] as { text: string; values: unknown[] }[],
  updates: [] as { cols: Record<string, unknown> }[],
  perm: { username: 'admin' } as unknown,
  stockFns: { apply: 0, ledger: 0, restore: 0, closing: 0, history: 0 },
}));

vi.mock('@/lib/firebase-admin', () => ({ getDb: () => ({}) }));
vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }));
vi.mock('next/server', () => ({ NextRequest: class {}, after: (fn: () => void) => fn() }));
vi.mock('@/lib/rbac', () => ({ requirePermission: async () => state.perm }));
vi.mock('@/lib/history', () => ({ logHistory: async () => { state.stockFns.history++; } }));
vi.mock('@/lib/closing', () => ({ orderClosingLock: async () => { state.stockFns.closing++; return null; } }));
vi.mock('@/lib/settings-pg', () => ({ getSettings: async () => ({}) }));
vi.mock('@/lib/revalidate', () => ({ revalidateStorefront: vi.fn(), revalidateProductStock: vi.fn() }));
vi.mock('@/lib/low-stock', () => ({ notifyProductLowStock: vi.fn() }));
vi.mock('@/lib/order-payments-pg', () => ({ paidAmountOf: async () => 0 }));
vi.mock('@/lib/store-consign', () => ({ voidStoreConsignSaleForOrder: vi.fn() }));
vi.mock('@/lib/order-stock-pg', () => ({ restoreOrderStockInTxPg: async () => { state.stockFns.restore++; } }));
vi.mock('@/lib/stock-pg', () => ({
  readProductsForDeltasPg: async () => ({ products: new Map(), shortages: [] }),
  readWarehouseShortagesPg: async () => [],
  applyStockDeltaPg: async () => { state.stockFns.apply++; },
  writeStockLedgerEntryPg: async () => { state.stockFns.ledger++; },
}));
vi.mock('@/lib/orders-pg', async () => {
  const actual = await vi.importActual<typeof import('@/lib/orders-pg')>('@/lib/orders-pg');
  return { ...actual, syncInvoicePaymentStatus: vi.fn() };
});
vi.mock('@/lib/db', () => {
  const tx = (strings: TemplateStringsArray | Record<string, unknown>, ...values: unknown[]) => {
    if (!Array.isArray(strings)) return { helper: strings, keys: values };
    const text = (strings as unknown as string[]).join('?');
    state.queries.push({ text, values });
    if (/select \* from orders/.test(text)) return Promise.resolve(state.row ? [state.row] : []);
    if (/update orders set/.test(text)) {
      const h = values[0] as { helper: Record<string, unknown> };
      state.updates.push({ cols: h.helper });
    }
    return Promise.resolve([]);
  };
  return {
    getSql: () => ({ begin: async (cb: (t: unknown) => unknown) => cb(tx) }),
    parseJsonb: (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v),
  };
});

import { PUT } from './route';

function req(body: unknown) {
  return { json: async () => body } as never;
}
const ctx = { params: Promise.resolve({ id: 'o1' }) };

function order(over: Record<string, unknown> = {}) {
  return {
    id: 'o1', invoice_no: 'INV-1', source: 'portal', status: 'baru', delivery_method: 'delivery',
    items: [], payment_status: 'lunas', stock_cut: false, fulfillment_status: null, ...over,
  };
}

beforeEach(() => {
  state.row = order();
  state.queries = [];
  state.updates = [];
  state.perm = { username: 'admin' };
  state.stockFns = { apply: 0, ledger: 0, restore: 0, closing: 0, history: 0 };
});

describe('PUT /api/orders/[id] cabang status layanan', () => {
  it('diproses: hanya meng-update 3 kolom fulfillment + updated_at, tanpa stok/status/closing', async () => {
    const res = await PUT(req({ fulfillmentStatus: 'diproses' }), ctx);
    expect(res.status).toBe(200);
    expect(state.updates).toHaveLength(1);
    expect(Object.keys(state.updates[0].cols).sort()).toEqual(['fulfillment_status', 'shipping_courier', 'tracking_no', 'updated_at']);
    expect(state.stockFns.apply + state.stockFns.ledger + state.stockFns.restore).toBe(0);
    expect(state.queries.some(q => /for update/.test(q.text))).toBe(true);
  });

  it('dikirim lengkap tersimpan, resi di-trim', async () => {
    const res = await PUT(req({ fulfillmentStatus: 'dikirim', shippingCourier: 'JNE', trackingNo: '  R1 ' }), ctx);
    expect(res.status).toBe(200);
    expect(state.updates[0].cols).toMatchObject({ fulfillment_status: 'dikirim', shipping_courier: 'JNE', tracking_no: 'R1' });
  });

  it('digabung dengan status / paymentStatus / walletId ditolak 400 tanpa query ke DB', async () => {
    for (const extra of [{ status: 'selesai' }, { paymentStatus: 'lunas' }, { walletId: 'w1' }]) {
      const res = await PUT(req({ fulfillmentStatus: 'diproses', ...extra }), ctx);
      expect(res.status).toBe(400);
    }
    expect(state.queries).toHaveLength(0);
  });

  it('pesanan tidak ada -> 404; sudah selesai/dibatalkan/kasir -> 400 dan tidak ada update', async () => {
    state.row = null;
    expect((await PUT(req({ fulfillmentStatus: 'diproses' }), ctx)).status).toBe(404);
    for (const over of [{ status: 'selesai' }, { status: 'dibatalkan' }, { source: 'kasir' }]) {
      state.row = order(over);
      expect((await PUT(req({ fulfillmentStatus: 'diproses' }), ctx)).status).toBe(400);
    }
    expect(state.updates).toHaveLength(0);
  });

  it('pesanan lama tanpa kolom fulfillment (undefined) diperlakukan sebagai menunggu', async () => {
    const r = order();
    delete (r as Record<string, unknown>).fulfillment_status;
    state.row = r;
    expect((await PUT(req({ fulfillmentStatus: 'diproses' }), ctx)).status).toBe(200);
  });

  it('izin ditolak (RBAC) -> respons guard diteruskan, tidak menyentuh DB', async () => {
    state.perm = new Response('forbidden', { status: 403 });
    const res = await PUT(req({ fulfillmentStatus: 'diproses' }), ctx);
    expect(res.status).toBe(403);
    expect(state.queries).toHaveLength(0);
  });

  it('double-submit dikirim dua kali berurutan: kedua kali idempotent dan tetap tidak menyentuh stok', async () => {
    const body = { fulfillmentStatus: 'dikirim', shippingCourier: 'J&T', trackingNo: 'Z1' };
    expect((await PUT(req(body), ctx)).status).toBe(200);
    state.row = order({ fulfillment_status: 'dikirim', shipping_courier: 'J&T', tracking_no: 'Z1' });
    expect((await PUT(req(body), ctx)).status).toBe(200);
    expect(state.stockFns.apply + state.stockFns.ledger).toBe(0);
  });

  it('body berisi items + kunci fulfillment ditolak 400 dan tidak ada update', async () => {
    const res = await PUT(req({ items: [], fulfillmentStatus: 'dikirim', shippingCourier: 'JNE', trackingNo: 'X' }), ctx);
    expect(res.status).toBe(400);
    expect(state.updates).toHaveLength(0);
  });
});
