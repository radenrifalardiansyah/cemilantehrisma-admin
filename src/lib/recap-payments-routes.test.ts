import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Tes rute pembayaran sebagian Rekap Mitra (cicilan, Bayar Sisa/PATCH, batal pembayaran, PUT/DELETE rekap ber-cicilan) dan jalur
// Closing HPP (createClosing/reopenClosing/loadClosingLines) memakai "Postgres" palsu di memori: transaksi (sql.begin) menyalin
// state dan mengembalikannya saat melempar error, jadi rollback ikut teruji. Query tak dikenal sengaja melempar error.
// BUKAN pengganti uji terhadap Postgres sungguhan (kunci baris `for update`/advisory tidak ditiru → balapan serentak TIDAK teruji;
// begitu pula SQL agregasi saldo dompet/laporan).

interface RecapItem { productId: string; productName: string; qtySold: number; qtyRetur: number; qtyReject: number; hargaTitip: number; revenue: number; costPrice: number }
interface Recap {
  id: string; location_id: string; location_name: string; items: RecapItem[]; total_sold: string; total_retur: string; total_reject: string;
  total_revenue: string; other_costs: unknown[]; total_other_costs: string; payment_status: string; warehouse_id: string | null; warehouse_name: string | null;
  note: string | null; wallet_id: string | null; due_date: Date | null; overdue_notified_at: Date | null; created_at: Date; updated_at: Date;
  paid_at: Date | null; closing_id: string | null;
}
interface Payment { id: string; recap_id: string; amount: string; paid_at: Date; wallet_id: string | null; note: string; created_by: string | null; created_at: Date; voided: boolean; voided_at: Date | null; closing_id: string | null }
interface Closing { id: string; period_to: string; status: string; is_opening_balance: boolean }
interface FakeState { recaps: Record<string, Recap>; payments: Payment[]; closings: Closing[] }

const h = vi.hoisted(() => ({ state: null as unknown as FakeState, walletFail: false, guardCalls: [] as string[][], history: [] as Record<string, unknown>[] }));

class Helper { constructor(public ids: unknown[]) {} }
const withCount = (n: number) => Object.assign([] as unknown[], { count: n });
const at = (day: string, hour = 10) => new Date(`${day}T${String(hour).padStart(2, '0')}:00:00+07:00`);

const active = (s: FakeState, rid: string) => s.payments.filter(p => p.recap_id === rid && !p.voided);
const poolRecap = (s: FakeState, r: Recap) => r.closing_id === null && (
  active(s, r.id).length === 0 || r.payment_status === 'belum_lunas' || active(s, r.id).some(p => p.closing_id === null));

function exec(s: FakeState, text: string, v: unknown[]): unknown[] {
  if (text === '' || text.startsWith('for update')) return [];
  if (text.includes('pg_advisory_xact_lock')) return [];
  if (text === 'select * from consignment_recaps where id = ? for update') { const r = s.recaps[v[0] as string]; return r ? [{ ...r }] : []; }
  if (text === 'select * from consignment_recaps where id = ?') { const r = s.recaps[v[0] as string]; return r ? [{ ...r }] : []; }
  if (text === 'select payment_status from consignment_recaps where id = ? for update') { const r = s.recaps[v[0] as string]; return r ? [{ payment_status: r.payment_status }] : []; }
  if (text === 'select updated_at from consignment_recaps where id = ? for update') { const r = s.recaps[v[0] as string]; return r ? [{ updated_at: r.updated_at }] : []; }
  if (text === 'select total_revenue, payment_status from consignment_recaps where id = ?') { const r = s.recaps[v[0] as string]; return r ? [{ total_revenue: r.total_revenue, payment_status: r.payment_status }] : []; }
  if (text.startsWith('select c.period_to from consignment_recaps r join closings c on c.id = r.closing_id where r.id = ?')) {
    const r = s.recaps[v[0] as string]; const c = r?.closing_id ? s.closings.find(x => x.id === r.closing_id) : undefined; return c ? [{ period_to: c.period_to }] : [];
  }
  if (text.startsWith('select c.period_to from closings c where c.id in ( select closing_id from consignment_recaps')) {
    const rid = v[0] as string; const r = s.recaps[rid];
    const ids = [r?.closing_id, ...s.payments.filter(p => p.recap_id === rid).map(p => p.closing_id)].filter(Boolean);
    const c = s.closings.find(x => ids.includes(x.id)); return c ? [{ period_to: c.period_to }] : [];
  }
  if (text.startsWith('select c.period_to from consignment_recap_payments p join closings c on c.id = p.closing_id where p.id = ?')) {
    const p = s.payments.find(x => x.id === v[0]); const c = p?.closing_id ? s.closings.find(x => x.id === p.closing_id) : undefined; return c ? [{ period_to: c.period_to }] : [];
  }
  if (text.startsWith("select id, period_to from closings where status = 'aktif'")) {
    const c = [...s.closings].filter(x => x.status === 'aktif').sort((a, b) => b.period_to.localeCompare(a.period_to))[0]; return c ? [{ id: c.id, period_to: c.period_to }] : [];
  }
  if (text.startsWith('select id, is_active from wallets where id = ?')) return v[0] === 'kas' || v[0] === 'bca' ? [{ id: v[0], is_active: true }] : v[0] === 'mati' ? [{ id: 'mati', is_active: false }] : [];
  if (text.startsWith('select coalesce(sum(amount), 0) as s from consignment_recap_payments where recap_id = ? and not voided')) {
    return [{ s: String(active(s, v[0] as string).reduce((n, p) => n + Number(p.amount), 0)) }];
  }
  if (text.startsWith('select count(*)::int as n from consignment_recap_payments where recap_id = ? and not voided')) return [{ n: active(s, v[0] as string).length }];
  if (text.startsWith('insert into consignment_recap_payments')) {
    s.payments.push({ id: v[0] as string, recap_id: v[1] as string, amount: String(v[2]), paid_at: v[3] as Date, wallet_id: v[4] as string | null, note: v[5] as string, created_by: v[6] as string, created_at: new Date(), voided: false, voided_at: null, closing_id: null });
    return [];
  }
  if (text.startsWith("update consignment_recaps set payment_status = 'lunas', wallet_id = ?, paid_at = ?, updated_at = now() where id = ?")) {
    const r = s.recaps[v[2] as string]; r.payment_status = 'lunas'; r.wallet_id = v[0] as string | null; r.paid_at = v[1] as Date; return [];
  }
  if (text.startsWith("update consignment_recaps set payment_status = 'belum_lunas', paid_at = null, wallet_id = null, updated_at = now() where id = ?")) {
    const r = s.recaps[v[0] as string]; r.payment_status = 'belum_lunas'; r.paid_at = null; r.wallet_id = null; return [];
  }
  if (text.startsWith('update consignment_recaps set updated_at = now() where id = ?')) return [];
  if (text.startsWith('update consignment_recaps set note = ?, created_at = ?, due_date = ?, overdue_notified_at = null, updated_at = now() where id = ?')) {
    const r = s.recaps[v[3] as string]; r.note = v[0] as string | null; return [];
  }
  if (text.startsWith('select * from consignment_recap_payments where id = ? and recap_id = ? for update')) {
    const p = s.payments.find(x => x.id === v[0] && x.recap_id === v[1]); return p ? [{ ...p }] : [];
  }
  if (text.startsWith('select * from consignment_recap_payments where recap_id = ? order by paid_at, created_at')) return s.payments.filter(p => p.recap_id === v[0]).map(p => ({ ...p }));
  if (text.startsWith('update consignment_recap_payments set voided = true, voided_at = now() where id = ?')) {
    const p = s.payments.find(x => x.id === v[0])!; p.voided = true; p.voided_at = new Date(); return [];
  }
  if (text.startsWith('select distinct wallet_id from consignment_recap_payments where recap_id = ? and not voided')) {
    return [...new Set(active(s, v[0] as string).map(p => p.wallet_id))].map(w => ({ wallet_id: w }));
  }
  if (text.startsWith('select * from consignment_recap_payments where recap_id = ? for update')) return s.payments.filter(p => p.recap_id === v[0]).map(p => ({ ...p }));
  if (text.startsWith('delete from consignment_recap_payments where recap_id = ?')) { s.payments = s.payments.filter(p => p.recap_id !== v[0]); return []; }
  if (text.startsWith('delete from consignment_recaps where id = ?')) {
    if (s.payments.some(p => p.recap_id === v[0])) throw new Error('FK restrict: masih ada pembayaran');
    delete s.recaps[v[0] as string]; return [];
  }
  // ── Closing ──
  if (text.startsWith('select id, cost_price from products')) return [];
  if (text.startsWith('select o.id, o.invoice_no')) return [];
  if (text.startsWith('select r.id, r.location_name, r.items, r.payment_status, r.total_revenue, r.created_at, r.paid_at, r.closing_id from consignment_recaps r where r.closing_id is null')) {
    return Object.values(s.recaps).filter(r => poolRecap(s, r)).map(r => ({ ...r }));
  }
  if (text.startsWith('select r.id, r.location_name, r.items, r.payment_status, r.total_revenue, r.created_at, r.paid_at, r.closing_id from consignment_recaps r where r.closing_id = ?')) {
    return Object.values(s.recaps).filter(r => r.closing_id === v[0] || s.payments.some(p => p.recap_id === r.id && p.closing_id === v[0])).map(r => ({ ...r }));
  }
  if (text.startsWith('select id, recap_id, amount, paid_at, closing_id from consignment_recap_payments where recap_id in ?')) {
    const ids = (v[0] as Helper).ids as string[];
    return s.payments.filter(p => ids.includes(p.recap_id) && !p.voided).sort((a, b) => a.paid_at.getTime() - b.paid_at.getTime()).map(p => ({ ...p }));
  }
  if (text.startsWith('insert into closings')) {
    s.closings.push({ id: v[0] as string, period_to: v[2] as string, status: 'aktif', is_opening_balance: false }); return [];
  }
  if (text.startsWith('update consignment_recap_payments set closing_id = ? where id in ? and closing_id is null')) {
    const ids = (v[1] as Helper).ids as string[]; let n = 0;
    for (const p of s.payments) if (ids.includes(p.id) && p.closing_id === null) { p.closing_id = v[0] as string; n++; }
    return withCount(n);
  }
  if (text.startsWith('update consignment_recaps set closing_id = ? where id in ? and closing_id is null')) {
    const ids = (v[1] as Helper).ids as string[]; let n = 0;
    for (const r of Object.values(s.recaps)) if (ids.includes(r.id) && r.closing_id === null) { r.closing_id = v[0] as string; n++; }
    return withCount(n);
  }
  if (text.startsWith('select id, status, is_opening_balance, period_to, total_cogs, total_revenue from closings where id = ? for update')) {
    const c = s.closings.find(x => x.id === v[0]); return c ? [{ ...c, total_cogs: '0', total_revenue: '0' }] : [];
  }
  if (text.startsWith('select count(*)::int as n from closing_settlements where closing_id = ?')) return [{ n: 0 }];
  if (text.startsWith('update orders set closing_id = null') || text.startsWith('update order_payments set closing_id = null')) return withCount(0);
  if (text.startsWith('update consignment_recaps set closing_id = null where closing_id = ?')) {
    let n = 0; for (const r of Object.values(s.recaps)) if (r.closing_id === v[0]) { r.closing_id = null; n++; } return withCount(n);
  }
  if (text.startsWith('update consignment_recap_payments set closing_id = null where closing_id = ?')) {
    let n = 0; for (const p of s.payments) if (p.closing_id === v[0]) { p.closing_id = null; n++; } return withCount(n);
  }
  if (text.startsWith('update closings set status')) { s.closings.find(x => x.id === v[1] || x.id === v[2] || x.id === v[0])!.status = 'dibuka_ulang'; return []; }
  throw new Error(`SQL tak dikenal di fake: ${text}`);
}

function makeTx() {
  return (strings: unknown, ...values: unknown[]) => {
    if (!Array.isArray(strings) || !('raw' in (strings as object))) return new Helper(strings as unknown[]);
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
vi.mock('next/server', async importOriginal => ({ ...(await importOriginal<typeof import('next/server')>()), after: vi.fn() }));
vi.mock('@/lib/revalidate', () => ({ revalidateStorefront: vi.fn(), revalidateProductStock: vi.fn() }));
vi.mock('@/lib/stock-pg', () => ({ writeStockLedgerEntryPg: vi.fn(), stockLabel: vi.fn() }));
vi.mock('@/lib/rbac', () => ({ requirePermission: vi.fn(async () => ({ username: 'rifal', role: 'admin' })) }));
vi.mock('@/lib/wallet-balance', async () => {
  class WalletBalanceError extends Error {}
  return {
    WalletBalanceError,
    computeWalletBalance: vi.fn(async () => 1_000_000),
    guardWalletBalances: vi.fn(async (_tx: unknown, ids: string[], mutate: () => Promise<void>) => {
      h.guardCalls.push(ids);
      await mutate();
      if (h.walletFail) throw new WalletBalanceError('Saldo dompet tidak cukup.');
    }),
  };
});

import { GET as payList, POST as payPost } from '@/app/api/consignment/recap/[id]/payments/route';
import { DELETE as payDelete } from '@/app/api/consignment/recap/[id]/payments/[paymentId]/route';
import { PATCH as bayarSisa, PUT as putRecap, DELETE as deleteRecap } from '@/app/api/consignment/recap/[id]/route';
import { createClosing, loadClosingLines, reopenClosing } from '@/lib/closing';
import { getSql } from '@/lib/db';

const item = (qty = 10): RecapItem => ({ productId: 'p1', productName: 'Teh', qtySold: qty, qtyRetur: 0, qtyReject: 0, hargaTitip: 14_000, revenue: qty * 14_000, costPrice: 1_000 });
const recap = (over: Partial<Recap> = {}): Recap => ({
  id: 'r1', location_id: 'l1', location_name: 'Toko A', items: [item()], total_sold: '10', total_retur: '0', total_reject: '0',
  total_revenue: '140000', other_costs: [], total_other_costs: '0', payment_status: 'belum_lunas', warehouse_id: null, warehouse_name: null,
  note: null, wallet_id: null, due_date: null, overdue_notified_at: null, created_at: at('2026-11-01'), updated_at: at('2026-11-01'),
  paid_at: null, closing_id: null, ...over,
});
const payment = (over: Partial<Payment> & { id: string }): Payment => ({
  recap_id: 'r1', amount: '100000', paid_at: at('2026-11-10'), wallet_id: 'kas', note: '', created_by: 'rifal', created_at: new Date(), voided: false, voided_at: null, closing_id: null, ...over,
});

beforeEach(() => {
  h.walletFail = false; h.history = []; h.guardCalls = [];
  h.state = { recaps: { r1: recap() }, payments: [], closings: [] };
  vi.clearAllMocks();
});

const ctx = (id: string, paymentId = '') => ({ params: Promise.resolve({ id, paymentId }) });
const json = (method: string, body?: unknown) =>
  new NextRequest('http://x/api', { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const pay = (amount: unknown, over: Record<string, unknown> = {}, id = 'r1') =>
  payPost(json('POST', { amount, date: '2026-11-10', walletId: 'kas', note: 'termin', ...over }), ctx(id));
const err = async (r: Response) => (await r.json() as { error: string }).error;
const paidSum = () => h.state.payments.filter(p => !p.voided).reduce((n, p) => n + Number(p.amount), 0);

describe('POST /api/consignment/recap/[id]/payments (cicilan)', () => {
  it('kasus pengguna: rekap 140.000, bayar 100.000 → sisa 40.000 tetap piutang, status belum_lunas', async () => {
    const res = await pay(100_000);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, amount: 100_000, remaining: 40_000, settled: false });
    expect(h.state.payments).toHaveLength(1);
    expect(h.state.payments[0]).toMatchObject({ recap_id: 'r1', amount: '100000', wallet_id: 'kas', note: 'termin', created_by: 'rifal', voided: false });
    expect(h.state.recaps.r1.payment_status).toBe('belum_lunas');
    expect(h.state.recaps.r1.paid_at).toBeNull();
    expect(h.history).toHaveLength(1);
  });

  it('GET: riwayat + sisa; rekap lunas lama tanpa pembayaran = sisa 0', async () => {
    await pay(100_000);
    const body = await (await payList(json('GET'), ctx('r1'))).json() as { payments: unknown[]; remaining: number; paid: number; total: number };
    expect(body).toMatchObject({ paid: 100_000, remaining: 40_000, total: 140_000 });
    expect(body.payments).toHaveLength(1);
    h.state.recaps.r2 = recap({ id: 'r2', payment_status: 'lunas' });
    expect(await (await payList(json('GET'), ctx('r2'))).json()).toMatchObject({ payments: [], remaining: 0, paid: 0 });
    expect((await payList(json('GET'), ctx('hantu'))).status).toBe(404);
  });

  it('pembayaran pelunas: status lunas, paid_at = tanggal pelunas, wallet_id = dompet pelunas; setelah itu ditolak', async () => {
    await pay(100_000, { date: '2026-11-10' });
    const res = await pay(40_000, { date: '2026-11-12', walletId: 'bca' });
    expect(await res.json()).toMatchObject({ remaining: 0, settled: true });
    expect(h.state.recaps.r1.payment_status).toBe('lunas');
    expect(h.state.recaps.r1.paid_at?.toISOString()).toBe(at('2026-11-12', 12).toISOString());
    expect(h.state.recaps.r1.wallet_id).toBe('bca');
    expect(paidSum()).toBe(140_000);
    const again = await pay(1);
    expect(again.status).toBe(400); expect(await err(again)).toMatch(/sudah lunas/);
  });

  it('toleransi Rp 1: bayar 139.999 melunasi', async () => {
    expect(await (await pay(139_999)).json()).toMatchObject({ settled: true });
    expect(h.state.recaps.r1.payment_status).toBe('lunas');
  });

  it('menolak melebihi sisa, nol, negatif, tanpa dompet, dompet tak ada/nonaktif, tanggal salah/masa depan — tanpa mengubah apa pun', async () => {
    await pay(100_000);
    const over = await pay(40_001);
    expect(over.status).toBe(400); expect(await err(over)).toMatch(/melebihi sisa piutang/);
    expect((await pay(0)).status).toBe(400);
    expect((await pay(-5)).status).toBe(400);
    const noWallet = await pay(100, { walletId: null });
    expect(noWallet.status).toBe(400); expect(await err(noWallet)).toMatch(/Dompet/);
    expect((await pay(100, { walletId: 'hantu' })).status).toBe(400);
    expect(await err(await pay(100, { walletId: 'mati' }))).toMatch(/tidak aktif/);
    expect((await pay(100, { date: '10-11-2026' })).status).toBe(400);
    expect(await err(await pay(100, { date: '2999-01-01' }))).toMatch(/masa depan/);
    expect(h.state.payments).toHaveLength(1);
  });

  it('rekap tidak ditemukan; rekap sudah closing sendiri (lunas sekaligus) tak bisa dibayar lagi', async () => {
    expect((await pay(100, {}, 'nope')).status).toBe(400);
    h.state.closings.push({ id: 'c1', period_to: '2026-11-05', status: 'aktif', is_opening_balance: false });
    h.state.recaps.r1.closing_id = 'c1';
    expect(await err(await pay(100))).toMatch(/sudah masuk Closing/);
  });

  it('pembayaran sebelum closing terakhir ditolak', async () => {
    h.state.closings.push({ id: 'c1', period_to: '2026-11-08', status: 'aktif', is_opening_balance: false });
    const res = await pay(100, { date: '2026-11-07' });
    expect(res.status).toBe(400); expect(await err(res)).toMatch(/sebelum closing terakhir/);
  });
});

describe('PATCH /api/consignment/recap/[id] (Bayar Sisa / Tandai Lunas)', () => {
  it('tanpa cicilan: satu pembayaran sebesar total, lunas penuh (hasil sama seperti dulu), dompet tersimpan', async () => {
    const res = await bayarSisa(json('PATCH', { walletId: 'kas' }), ctx('r1'));
    expect(res.status).toBe(200);
    expect(h.state.payments).toHaveLength(1);
    expect(h.state.payments[0]).toMatchObject({ amount: '140000', wallet_id: 'kas' });
    expect(h.state.recaps.r1).toMatchObject({ payment_status: 'lunas', wallet_id: 'kas' });
    expect(h.state.recaps.r1.paid_at).toBeInstanceOf(Date);
  });

  it('setelah cicilan: hanya SISA yang dibayar (total pembayaran = total rekap, bukan dobel)', async () => {
    await pay(100_000);
    expect((await bayarSisa(json('PATCH', { walletId: 'bca', date: '2026-11-12' }), ctx('r1'))).status).toBe(200);
    expect(h.state.payments.map(p => Number(p.amount))).toEqual([100_000, 40_000]);
    expect(paidSum()).toBe(140_000);
    expect(h.state.recaps.r1.payment_status).toBe('lunas');
  });

  it('dompet kosong tetap diterima (perilaku lama: bucket Belum Ditentukan); idempoten saat sudah lunas; rekap tak ada → 400', async () => {
    expect((await bayarSisa(json('PATCH', {}), ctx('r1'))).status).toBe(200);
    expect(h.state.payments[0].wallet_id).toBeNull();
    expect((await bayarSisa(json('PATCH', {}), ctx('r1'))).status).toBe(200);
    expect(h.state.payments).toHaveLength(1);
    expect((await bayarSisa(json('PATCH', {}), ctx('hantu'))).status).toBe(400);
  });

  it('rekap total 0 / sisa tinggal pembulatan: cukup ditandai lunas tanpa pembayaran baru', async () => {
    h.state.recaps.r1 = recap({ total_revenue: '0' });
    expect((await bayarSisa(json('PATCH', { walletId: 'kas' }), ctx('r1'))).status).toBe(200);
    expect(h.state.payments).toHaveLength(0);
    expect(h.state.recaps.r1.payment_status).toBe('lunas');
  });

  it('tanggal tidak valid ditolak', async () => {
    expect((await bayarSisa(json('PATCH', { walletId: 'kas', date: 'kemarin' }), ctx('r1'))).status).toBe(400);
  });
});

describe('DELETE /api/consignment/recap/[id]/payments/[paymentId] (batal pembayaran)', () => {
  it('membatalkan pembayaran pelunas: ditandai voided, rekap kembali belum_lunas (paid_at & wallet dikosongkan), dompet dijaga', async () => {
    await pay(100_000); await pay(40_000, { walletId: 'bca' });
    expect(h.state.recaps.r1.payment_status).toBe('lunas');
    const second = h.state.payments[1];
    const res = await payDelete(json('DELETE'), ctx('r1', second.id));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ reopened: true });
    expect(h.state.payments[1].voided).toBe(true);
    expect(h.state.recaps.r1).toMatchObject({ payment_status: 'belum_lunas', paid_at: null, wallet_id: null });
    expect(h.guardCalls.at(-1)).toEqual(['bca']);
    expect(paidSum()).toBe(100_000);
    expect((await pay(40_000)).status).toBe(200); // sisa kembali 40.000
  });

  it('saldo dompet jadi minus → ditolak, rollback (pembayaran tetap aktif)', async () => {
    await pay(100_000);
    h.walletFail = true;
    const res = await payDelete(json('DELETE'), ctx('r1', h.state.payments[0].id));
    expect(res.status).toBe(400); expect(await err(res)).toMatch(/Saldo dompet/);
    expect(h.state.payments[0].voided).toBe(false);
  });

  it('menolak dua kali, tak dikenal, milik rekap lain, dan pembayaran yang sudah masuk Closing', async () => {
    await pay(100_000);
    const id = h.state.payments[0].id;
    expect((await payDelete(json('DELETE'), ctx('r1', id))).status).toBe(200);
    expect((await payDelete(json('DELETE'), ctx('r1', id))).status).toBe(400);
    expect((await payDelete(json('DELETE'), ctx('r1', 'hantu'))).status).toBe(400);
    h.state.recaps.r2 = recap({ id: 'r2' });
    expect((await payDelete(json('DELETE'), ctx('r2', id))).status).toBe(400);
    h.state.closings.push({ id: 'c1', period_to: '2026-11-10', status: 'aktif', is_opening_balance: false });
    h.state.payments.push(payment({ id: 'pc', closing_id: 'c1' }));
    const locked = await payDelete(json('DELETE'), ctx('r1', 'pc'));
    expect(locked.status).toBe(400); expect(await err(locked)).toMatch(/sudah masuk Closing/);
    expect(h.state.payments.find(p => p.id === 'pc')!.voided).toBe(false);
  });
});

describe('PUT / DELETE rekap yang sudah punya pembayaran', () => {
  const putBody = (over: Record<string, unknown> = {}) => ({
    locationId: 'l1', locationName: 'Toko A', note: 'catatan baru', paymentStatus: 'belum_lunas',
    items: [{ productId: 'p1', productName: 'Teh', qtySold: 10, qtyRetur: 0, qtyReject: 0 }], ...over,
  });

  it('PUT: barang/qty/biaya lain terkunci dengan pesan jelas; catatan boleh diubah', async () => {
    await pay(100_000);
    const changed = await putRecap(json('PUT', putBody({ items: [{ productId: 'p1', productName: 'Teh', qtySold: 9, qtyRetur: 0, qtyReject: 0 }] })), ctx('r1'));
    expect(changed.status).toBe(400); expect(await err(changed)).toMatch(/sudah punya pembayaran\/cicilan/);
    const costs = await putRecap(json('PUT', putBody({ otherCosts: [{ label: 'Admin', amount: 1000 }] })), ctx('r1'));
    expect(costs.status).toBe(400);
    const ok = await putRecap(json('PUT', putBody()), ctx('r1'));
    expect(ok.status).toBe(200);
    expect(h.state.recaps.r1.note).toBe('catatan baru');
    expect(h.state.recaps.r1.total_revenue).toBe('140000');
    expect(h.state.recaps.r1.payment_status).toBe('belum_lunas'); // status tak bisa diubah dari form
  });

  it('PUT: rekap ber-cicilan yang sudah masuk Closing (sebagian) terkunci total', async () => {
    await pay(100_000);
    h.state.closings.push({ id: 'c1', period_to: '2026-11-10', status: 'aktif', is_opening_balance: false });
    h.state.payments[0].closing_id = 'c1';
    const res = await putRecap(json('PUT', putBody()), ctx('r1'));
    expect(res.status).toBe(400); expect(await err(res)).toMatch(/sudah masuk Closing/);
  });

  it('DELETE: pembayaran ikut dibereskan (dompet dijaga); saldo minus → rollback; rekap ter-closing ditolak', async () => {
    h.state.recaps.r1.items = []; // tanpa stok supaya jalur stok tak ikut diuji
    await pay(100_000); await pay(40_000, { walletId: 'bca' });
    h.walletFail = true;
    const fail = await deleteRecap(json('DELETE'), ctx('r1'));
    expect(fail.status).toBe(400);
    expect(h.state.recaps.r1).toBeDefined(); expect(h.state.payments).toHaveLength(2);
    h.walletFail = false;
    const ok = await deleteRecap(json('DELETE'), ctx('r1'));
    expect(ok.status).toBe(200);
    expect(h.state.recaps.r1).toBeUndefined(); expect(h.state.payments).toHaveLength(0);
    expect([...h.guardCalls.at(-1)!].sort()).toEqual(['bca', 'kas']);
  });

  it('DELETE rekap tanpa pembayaran (rekap lama): perilaku lama, tak ada dompet yang dijaga', async () => {
    h.state.recaps.r1 = recap({ items: [], payment_status: 'lunas' });
    expect((await deleteRecap(json('DELETE'), ctx('r1'))).status).toBe(200);
    expect(h.guardCalls.at(-1)).toEqual([]);
  });

  it('DELETE: cicilan sudah closing → ditolak', async () => {
    h.state.recaps.r1.items = [];
    await pay(100_000);
    h.state.closings.push({ id: 'c1', period_to: '2026-11-10', status: 'aktif', is_opening_balance: false });
    h.state.payments[0].closing_id = 'c1';
    const res = await deleteRecap(json('DELETE'), ctx('r1'));
    expect(res.status).toBe(400); expect(await err(res)).toMatch(/sudah masuk Closing/);
    expect(h.state.recaps.r1).toBeDefined();
  });
});

describe('Closing HPP: rekap lama identik, rekap ber-cicilan proporsional per pembayaran', () => {
  const sql = () => getSql() as never;
  const totalsOf = (lines: { qty: number; cogs: number; revenue: number }[]) => lines.reduce((a, l) => ({ qty: a.qty + l.qty, cogs: a.cogs + l.cogs, revenue: a.revenue + l.revenue }), { qty: 0, cogs: 0, revenue: 0 });

  it('regresi: rekap lunas lama (tanpa cicilan) → satu baris recap, closing_id di rekap, angka sama seperti sebelum fitur', async () => {
    h.state.recaps = { old: recap({ id: 'old', payment_status: 'lunas', paid_at: null, created_at: at('2026-11-05') }) };
    const res = await createClosing(sql(), { upTo: '2026-11-12', username: 'rifal' });
    expect(res).toMatchObject({ count: 1, qty: 10, cogs: 10_000, revenue: 140_000, periodFrom: '2026-11-05' });
    expect(h.state.recaps.old.closing_id).toBe(res.id);
    expect(h.state.payments).toHaveLength(0);
    const lines = await loadClosingLines(sql(), res.id);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ kind: 'recap', recapId: 'old', invoiceNo: 'Rekap Mitra', qty: 10, cogs: 10_000, revenue: 140_000 });
  });

  it('rekap ber-cicilan: closing_id ditandai pada PEMBAYARAN (bukan rekap); piutang tidak ikut; sisa tetap receivable', async () => {
    h.state.recaps = { r1: recap({ created_at: at('2026-11-05') }) };
    h.state.payments = [payment({ id: 'p1', amount: '100000', paid_at: at('2026-11-10') })];
    const res = await createClosing(sql(), { upTo: '2026-11-12', username: 'rifal' });
    expect(res).toMatchObject({ count: 1, revenue: 100_000, cogs: 7_143 });
    expect(h.state.payments[0].closing_id).toBe(res.id);
    expect(h.state.recaps.r1.closing_id).toBeNull();
    const lines = await loadClosingLines(sql(), res.id);
    expect(lines.map(l => l.paymentId)).toEqual(['p1']);
    expect(lines[0]).toMatchObject({ kind: 'payment', recapId: 'r1', revenue: 100_000, cogs: 7_143 });
  });

  it('closing kedua mengambil pelunasan: total dua closing = rekap penuh; rekap yang sudah closing semua tak muncul lagi', async () => {
    h.state.recaps = { r1: recap({ created_at: at('2026-11-05') }) };
    h.state.payments = [payment({ id: 'p1', amount: '100000', paid_at: at('2026-11-10') })];
    const c1 = await createClosing(sql(), { upTo: '2026-11-10', username: 'rifal' });
    // pelunasan lewat jalur produksi (PATCH) pada tanggal 12
    expect((await bayarSisa(json('PATCH', { walletId: 'kas', date: '2026-11-12' }), ctx('r1'))).status).toBe(200);
    const c2 = await createClosing(sql(), { upTo: '2026-11-12', username: 'rifal' });
    expect(c2).toMatchObject({ count: 1, revenue: 40_000, cogs: 2_857 });
    expect(c1.cogs + c2.cogs).toBe(10_000);
    expect(c1.revenue + c2.revenue).toBe(140_000);
    await expect(createClosing(sql(), { upTo: '2026-11-12', username: 'rifal' })).rejects.toThrow(/Tidak ada transaksi/);
    const l2 = await loadClosingLines(sql(), c2.id);
    expect(totalsOf(l2)).toMatchObject({ revenue: 40_000, cogs: 2_857 });
  });

  it('rekap lama + rekap ber-cicilan dalam satu closing: angka rekap lama tidak berubah oleh kehadiran rekap ber-cicilan', async () => {
    h.state.recaps = {
      old: recap({ id: 'old', payment_status: 'lunas', created_at: at('2026-11-05') }),
      r1: recap({ id: 'r1', created_at: at('2026-11-06') }),
    };
    h.state.payments = [payment({ id: 'p1', recap_id: 'r1', amount: '70000', paid_at: at('2026-11-10') })];
    const res = await createClosing(sql(), { upTo: '2026-11-12', username: 'rifal' });
    expect(res).toMatchObject({ count: 2, revenue: 140_000 + 70_000, cogs: 10_000 + 5_000 });
    expect(h.state.recaps.old.closing_id).toBe(res.id);
    expect(h.state.payments[0].closing_id).toBe(res.id);
  });

  it('buka ulang: closing_id pembayaran & rekap dikosongkan, item kembali ke pool dengan angka sama', async () => {
    h.state.recaps = { old: recap({ id: 'old', payment_status: 'lunas', created_at: at('2026-11-05') }), r1: recap({ id: 'r1', created_at: at('2026-11-06') }) };
    h.state.payments = [payment({ id: 'p1', recap_id: 'r1', amount: '70000', paid_at: at('2026-11-10') })];
    const c = await createClosing(sql(), { upTo: '2026-11-12', username: 'rifal' });
    const out = await reopenClosing(sql(), { id: c.id, reason: 'salah', username: 'rifal', isSuperAdmin: false });
    expect(out.released).toBe(2);
    expect(h.state.recaps.old.closing_id).toBeNull();
    expect(h.state.payments[0].closing_id).toBeNull();
    expect(h.state.closings[0].status).toBe('dibuka_ulang');
    const again = await createClosing(sql(), { upTo: '2026-11-12', username: 'rifal' });
    expect(again).toMatchObject({ count: 2, revenue: c.revenue, cogs: c.cogs });
  });

  it('kunci edit: rekap ber-cicilan yang cicilannya sudah closing menolak edit/hapus/batal; buka ulang melepasnya', async () => {
    h.state.recaps = { r1: recap({ created_at: at('2026-11-05') }) };
    h.state.payments = [payment({ id: 'p1', amount: '100000', paid_at: at('2026-11-10') })];
    const c = await createClosing(sql(), { upTo: '2026-11-12', username: 'rifal' });
    expect((await payDelete(json('DELETE'), ctx('r1', 'p1'))).status).toBe(400);
    // pelunasan sisa tetap boleh walau cicilan pertama sudah closing
    expect((await bayarSisa(json('PATCH', { walletId: 'kas' }), ctx('r1'))).status).toBe(200);
    await reopenClosing(sql(), { id: c.id, reason: 'x', username: 'rifal', isSuperAdmin: false });
    expect((await payDelete(json('DELETE'), ctx('r1', 'p1'))).status).toBe(200);
  });
});
