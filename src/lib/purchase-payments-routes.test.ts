import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Tes rute pembayaran hutang supplier (cicilan, Tandai Lunas, batal cicilan) memakai "Postgres" palsu di memori:
// transaksi (sql.begin) menyalin state dan mengembalikannya saat melempar error, jadi rollback ikut teruji. Query tak
// dikenal sengaja melempar error. BUKAN pengganti uji terhadap Postgres sungguhan (kunci baris `for update` tidak ditiru,
// jadi balapan dua pembayaran serentak TIDAK teruji di sini).

interface Purchase { id: string; total: string; payment_status: string; voided: boolean; wallet_id: string | null; date: string; expense_id: string | null }
interface Payment { id: string; purchase_id: string; amount: string; date: string; wallet_id: string | null; expense_id: string | null; note: string; created_by: string | null; voided: boolean }
interface Expense { id: string; amount: string; date: string; wallet_id: string | null; source_id: string; source_type: string; category: string }
interface FakeState { purchases: Record<string, Purchase>; payments: Payment[]; expenses: Expense[] }

const h = vi.hoisted(() => ({ state: null as unknown as FakeState, walletFail: false, history: [] as Record<string, unknown>[] }));

const purchaseRow = (p: Purchase) => ({
  id: p.id, supplier_id: 's1', supplier_name: 'Toko A', items: [{ materialId: 'm1', materialName: 'Tepung', unit: 'kg', qty: 1, price: Number(p.total), subtotal: Number(p.total) }],
  total: p.total, date: p.date, payment_status: p.payment_status, expense_id: p.expense_id, note: '', wallet_id: p.wallet_id,
  voided: p.voided, voided_at: null, void_note: null, source: 'manual', po_id: null, gr_id: null, due_date: null,
  created_at: new Date('2026-11-01T00:00:00Z'), updated_at: null,
});
const activeSum = (s: FakeState, pid: string) => s.payments.filter(x => x.purchase_id === pid && !x.voided).reduce((n, x) => n + Number(x.amount), 0);

function exec(s: FakeState, text: string, v: unknown[]): unknown[] {
  if (text === 'select * from material_purchases where id = ? for update') { const p = s.purchases[v[0] as string]; return p ? [purchaseRow(p)] : []; }
  if (text.startsWith('select payment_status, voided, wallet_id, date from material_purchases where id = ? for update')) { const p = s.purchases[v[0] as string]; return p ? [{ ...p }] : []; }
  if (text.startsWith('select coalesce(sum(amount), 0) as s from material_purchase_payments where purchase_id = ? and not voided')) return [{ s: String(activeSum(s, v[0] as string)) }];
  if (text.startsWith('select count(*)::int as n from material_purchase_payments where purchase_id = ? and not voided')) return [{ n: s.payments.filter(x => x.purchase_id === v[0] && !x.voided).length }];
  if (text.startsWith('select id from wallets where id = ?')) return v[0] === 'kas' || v[0] === 'bca' ? [{ id: v[0] }] : [];
  if (text.startsWith("insert into expenses") && text.includes("'material-purchase'")) {
    s.expenses.push({ id: v[0] as string, category: 'Bahan Baku', amount: String(v[2]), date: v[3] as string, wallet_id: v[5] as string, source_type: 'material-purchase', source_id: v[6] as string }); return [];
  }
  if (text.startsWith('insert into material_purchase_payments')) {
    s.payments.push({ id: v[0] as string, purchase_id: v[1] as string, amount: String(v[2]), date: v[3] as string, wallet_id: v[4] as string, expense_id: v[5] as string, note: v[6] as string, created_by: v[7] as string, voided: false }); return [];
  }
  if (text.startsWith("update material_purchases set payment_status = 'lunas', updated_at = now() where id = ?")) { s.purchases[v[0] as string].payment_status = 'lunas'; return []; }
  if (text.startsWith("update material_purchases set payment_status = 'belum_lunas', updated_at = now() where id = ?")) { s.purchases[v[0] as string].payment_status = 'belum_lunas'; return []; }
  if (text.startsWith('update material_purchases set updated_at = now() where id = ?')) return [];
  if (text.startsWith('select * from material_purchase_payments where id = ? and purchase_id = ? for update')) {
    const x = s.payments.find(y => y.id === v[0] && y.purchase_id === v[1]);
    return x ? [{ ...x, created_at: new Date('2026-11-02T00:00:00Z'), voided_at: null }] : [];
  }
  if (text.startsWith('delete from expenses where id = ?')) { s.expenses = s.expenses.filter(e => e.id !== v[0]); return []; }
  if (text.startsWith('update material_purchase_payments set voided = true, voided_at = now(), expense_id = null where id = ?')) {
    const x = s.payments.find(y => y.id === v[0])!; x.voided = true; x.expense_id = null; return [];
  }
  throw new Error(`SQL tak dikenal di fake: ${text}`);
}

function makeTx() {
  return (strings: unknown, ...values: unknown[]) => {
    const text = (strings as string[]).join('?').replace(/\s+/g, ' ').trim();
    try { return Promise.resolve(exec(h.state, text, values)); } catch (e) { return Promise.reject(e); }
  };
}

vi.mock('@/lib/db', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/db')>()),
  getSql: () => Object.assign(makeTx(), {
    begin: async (fn: (tx: unknown) => Promise<unknown>) => {
      const snapshot = structuredClone(h.state);
      try { return await fn(makeTx()); } catch (e) { h.state = snapshot; throw e; }
    },
  }),
}));
vi.mock('@/lib/firebase-admin', () => ({ getDb: () => ({}) }));
vi.mock('@/lib/history', () => ({ logHistory: vi.fn(async (_db: unknown, o: Record<string, unknown>) => { h.history.push(o); }) }));
vi.mock('next/cache', () => ({ unstable_cache: (fn: () => unknown) => fn, revalidateTag: vi.fn() }));
vi.mock('@/lib/rbac', () => ({ requirePermission: vi.fn(async () => ({ username: 'rifal', role: 'admin' })) }));
vi.mock('@/lib/wallet-balance', async () => {
  class WalletBalanceError extends Error {}
  return {
    WalletBalanceError,
    computeWalletBalance: vi.fn(async () => 1_000_000),
    guardWalletBalances: vi.fn(async (_tx: unknown, _ids: unknown, mutate: () => Promise<void>) => {
      await mutate();
      if (h.walletFail) throw new WalletBalanceError('Saldo dompet tidak cukup.');
    }),
  };
});

import { POST as payPost } from '@/app/api/material-purchases/[id]/payments/route';
import { DELETE as payDelete } from '@/app/api/material-purchases/[id]/payments/[paymentId]/route';
import { POST as markLunas } from '@/app/api/material-purchases/[id]/mark-lunas/route';

const purchase = (over: Partial<Purchase> = {}): Purchase => ({ id: 'p1', total: '1000000', payment_status: 'belum_lunas', voided: false, wallet_id: 'kas', date: '2026-11-01', expense_id: null, ...over });

beforeEach(() => {
  h.walletFail = false; h.history = [];
  h.state = { purchases: { p1: purchase() }, payments: [], expenses: [] };
  vi.clearAllMocks();
});

const ctx = (id: string, paymentId = '') => ({ params: Promise.resolve({ id, paymentId }) });
const json = (method: string, body?: unknown) =>
  new NextRequest('http://x/api', { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const pay = (amount: unknown, over: Record<string, unknown> = {}, id = 'p1') =>
  payPost(json('POST', { amount, date: '2026-11-13', walletId: 'kas', note: 'termin', ...over }), ctx(id));
const err = async (r: Response) => (await r.json() as { error: string }).error;
const expenseTotal = () => h.state.expenses.reduce((n, e) => n + Number(e.amount), 0);

describe('POST /api/material-purchases/[id]/payments (cicilan)', () => {
  it('cicilan sebagian: satu pengeluaran persis seperti Tandai Lunas, status tetap belum_lunas', async () => {
    const res = await pay(400_000);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, amount: 400_000, remaining: 600_000, settled: false });
    expect(h.state.payments).toHaveLength(1);
    expect(h.state.expenses).toEqual([{ id: h.state.payments[0].expense_id, category: 'Bahan Baku', amount: '400000', date: '2026-11-13', wallet_id: 'kas', source_type: 'material-purchase', source_id: 'p1' }]);
    expect(h.state.purchases.p1.payment_status).toBe('belum_lunas');
    expect(h.history).toHaveLength(1);
  });

  it('cicilan terakhir melunasi (status lunas); setelah itu ditolak', async () => {
    await pay(400_000);
    const res = await pay(600_000);
    expect(await res.json()).toMatchObject({ remaining: 0, settled: true });
    expect(h.state.purchases.p1.payment_status).toBe('lunas');
    expect(expenseTotal()).toBe(1_000_000);
    const again = await pay(1);
    expect(again.status).toBe(400); expect(await err(again)).toMatch(/sudah lunas/);
  });

  it('toleransi Rp 1: bayar 999.999 melunasi', async () => {
    const res = await pay(999_999);
    expect(await res.json()).toMatchObject({ settled: true });
    expect(h.state.purchases.p1.payment_status).toBe('lunas');
  });

  it('menolak melebihi sisa, nol, negatif, tanpa dompet/tanggal tak valid, dompet tak ada, pembelian void — tanpa mengubah apa pun', async () => {
    await pay(400_000);
    const over = await pay(600_001);
    expect(over.status).toBe(400); expect(await err(over)).toMatch(/melebihi sisa/);
    expect((await pay(0)).status).toBe(400);
    expect((await pay(-5)).status).toBe(400);
    expect((await pay(100, { walletId: null })).status).toBe(400);
    expect((await pay(100, { walletId: 'hantu' })).status).toBe(400);
    expect((await pay(100, { date: '13-11-2026' })).status).toBe(400);
    h.state.purchases.p1.voided = true;
    const voided = await pay(100);
    expect(voided.status).toBe(400); expect(await err(voided)).toMatch(/dibatalkan/);
    expect(h.state.payments).toHaveLength(1);
    expect(expenseTotal()).toBe(400_000);
  });

  it('pembelian tidak ditemukan', async () => {
    expect((await pay(100, {}, 'nope')).status).toBe(400);
  });

  it('saldo dompet tidak cukup: rollback total (tak ada pengeluaran/pembayaran)', async () => {
    h.walletFail = true;
    const res = await pay(400_000);
    expect(res.status).toBe(400); expect(await err(res)).toMatch(/Saldo dompet/);
    expect(h.state.payments).toHaveLength(0);
    expect(h.state.expenses).toHaveLength(0);
  });
});

describe('POST /api/material-purchases/[id]/mark-lunas (bayar sisa)', () => {
  it('tanpa cicilan: satu pembayaran sebesar total, tanggal = tanggal pembelian (perilaku lama)', async () => {
    const res = await markLunas(json('POST', {}), ctx('p1'));
    expect(res.status).toBe(200);
    expect(h.state.payments).toHaveLength(1);
    expect(h.state.payments[0]).toMatchObject({ amount: '1000000', date: '2026-11-01', wallet_id: 'kas' });
    expect(h.state.expenses[0]).toMatchObject({ amount: '1000000', date: '2026-11-01', source_type: 'material-purchase', source_id: 'p1' });
    expect(h.state.purchases.p1.payment_status).toBe('lunas');
  });

  it('setelah cicilan: membayar hanya SISA (total pengeluaran = total pembelian, bukan dobel)', async () => {
    await pay(400_000);
    expect((await markLunas(json('POST', { date: '2026-11-20' }), ctx('p1'))).status).toBe(200);
    expect(h.state.payments.map(x => Number(x.amount))).toEqual([400_000, 600_000]);
    expect(h.state.payments[1].date).toBe('2026-11-20');
    expect(expenseTotal()).toBe(1_000_000);
    expect(h.state.purchases.p1.payment_status).toBe('lunas');
  });

  it('idempoten: sudah lunas tidak membuat pengeluaran baru; void ditolak', async () => {
    await markLunas(json('POST', {}), ctx('p1'));
    expect((await markLunas(json('POST', {}), ctx('p1'))).status).toBe(200);
    expect(h.state.expenses).toHaveLength(1);
    h.state.purchases.p1 = purchase({ voided: true });
    expect((await markLunas(json('POST', {}), ctx('p1'))).status).toBe(400);
  });

  it('total 0: cukup ditandai lunas tanpa pengeluaran', async () => {
    h.state.purchases.p1 = purchase({ total: '0' });
    expect((await markLunas(json('POST', {}), ctx('p1'))).status).toBe(200);
    expect(h.state.expenses).toHaveLength(0);
    expect(h.state.payments).toHaveLength(0);
    expect(h.state.purchases.p1.payment_status).toBe('lunas');
  });

  it('saldo tidak cukup: rollback (tetap belum lunas)', async () => {
    h.walletFail = true;
    expect((await markLunas(json('POST', {}), ctx('p1'))).status).toBe(400);
    expect(h.state.purchases.p1.payment_status).toBe('belum_lunas');
    expect(h.state.payments).toHaveLength(0);
  });
});

describe('DELETE /api/material-purchases/[id]/payments/[paymentId] (batal cicilan)', () => {
  it('membatalkan satu cicilan: pengeluaran dihapus, baris ditandai voided, lunas kembali belum lunas', async () => {
    await pay(400_000); await pay(600_000);
    expect(h.state.purchases.p1.payment_status).toBe('lunas');
    const second = h.state.payments[1];
    const res = await payDelete(json('DELETE'), ctx('p1', second.id));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ reopened: true });
    expect(h.state.payments[1].voided).toBe(true);
    expect(expenseTotal()).toBe(400_000);
    expect(h.state.purchases.p1.payment_status).toBe('belum_lunas');
    // sisa kembali 600.000 → bisa dibayar lagi
    expect((await pay(600_000)).status).toBe(200);
  });

  it('menolak membatalkan dua kali, pembayaran tak dikenal, atau milik pembelian lain', async () => {
    await pay(100_000);
    const id = h.state.payments[0].id;
    expect((await payDelete(json('DELETE'), ctx('p1', id))).status).toBe(200);
    expect((await payDelete(json('DELETE'), ctx('p1', id))).status).toBe(400);
    expect((await payDelete(json('DELETE'), ctx('p1', 'hantu'))).status).toBe(400);
    h.state.purchases.p2 = purchase({ id: 'p2' });
    expect((await payDelete(json('DELETE'), ctx('p2', id))).status).toBe(400);
  });
});
