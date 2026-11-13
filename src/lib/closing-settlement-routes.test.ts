import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Tes rute status transfer closing memakai "Postgres" palsu di memori: transaksi (sql.begin) menyalin state dan
// mengembalikannya saat melempar error, jadi rollback ikut teruji. Query tak dikenal sengaja melempar error.
// BUKAN pengganti uji terhadap Postgres sungguhan (penguncian baris/deadlock tidak ditiru).

interface Closing { id: string; status: string; is_opening_balance: boolean; total_cogs: string | null; period_from: string | null; period_to: string }
interface Transfer { id: string; amount: string; from_wallet_id: string; to_wallet_id: string; date: string; note: string | null }
interface Settlement { id: string; closing_id: string; wallet_transfer_id: string; amount: string }
interface FakeState { closings: Record<string, Closing>; transfers: Record<string, Transfer>; settlements: Settlement[]; locks: string[] }

const h = vi.hoisted(() => ({ state: null as unknown as FakeState, reportView: true, history: [] as Record<string, unknown>[] }));

class Helper { constructor(public ids: unknown[]) {} }
const idsOf = (x: unknown) => (x as Helper).ids as string[];

function exec(s: FakeState, text: string, v: unknown[]): unknown[] {
  if (text.includes('pg_advisory_xact_lock')) { s.locks.push(text.includes("'closings'") ? 'closings' : 'wallet'); return []; }
  if (text.startsWith('select id, amount, from_wallet_id, to_wallet_id, date from wallet_transfers where id = ? for update')) {
    const t = s.transfers[v[0] as string]; return t ? [{ ...t }] : [];
  }
  if (text.startsWith('select * from wallet_transfers where id = ?')) { const t = s.transfers[v[0] as string]; return t ? [{ ...t, created_at: new Date(), updated_at: null }] : []; }
  if (text.startsWith('select name, initial_balance from wallets')) return [{ name: String(v[0]).toUpperCase(), initial_balance: '0' }];
  if (text.startsWith('select name from wallets')) return [{ name: String(v[0]).toUpperCase() }];
  if (text.startsWith('select id, closing_id, amount from closing_settlements where wallet_transfer_id = ?') || text.startsWith('select closing_id, amount from closing_settlements where wallet_transfer_id = ?')) {
    return s.settlements.filter(x => x.wallet_transfer_id === v[0]).map(x => ({ ...x }));
  }
  if (text.startsWith('select coalesce(sum(amount), 0) as s from closing_settlements where wallet_transfer_id = ?')) {
    return [{ s: String(s.settlements.filter(x => x.wallet_transfer_id === v[0]).reduce((n, x) => n + Number(x.amount), 0)) }];
  }
  if (text.includes('from closings where id in ? order by id for update')) {
    return idsOf(v[0]).filter(id => s.closings[id]).sort().map(id => ({ ...s.closings[id] }));
  }
  if (text.startsWith('select closing_id, sum(amount) as s from closing_settlements where closing_id in ?')) {
    const out: Record<string, number> = {};
    for (const x of s.settlements) if (idsOf(v[0]).includes(x.closing_id) && x.wallet_transfer_id !== v[1]) out[x.closing_id] = (out[x.closing_id] ?? 0) + Number(x.amount);
    return Object.entries(out).map(([closing_id, n]) => ({ closing_id, s: String(n) }));
  }
  if (text.startsWith('delete from closing_settlements where wallet_transfer_id = ? and closing_id in ?')) {
    s.settlements = s.settlements.filter(x => !(x.wallet_transfer_id === v[0] && idsOf(v[1]).includes(x.closing_id))); return [];
  }
  if (text.startsWith('update closing_settlements set amount')) {
    const x = s.settlements.find(y => y.wallet_transfer_id === v[1] && y.closing_id === v[2]); if (x) x.amount = String(v[0]); return [];
  }
  if (text.startsWith('insert into closing_settlements')) {
    s.settlements.push({ id: v[0] as string, closing_id: v[1] as string, wallet_transfer_id: v[2] as string, amount: String(v[3]) }); return [];
  }
  if (text.startsWith('select id, period_to from closings where id in ?')) return idsOf(v[0]).filter(id => s.closings[id]).map(id => ({ id, period_to: s.closings[id].period_to }));
  if (text.startsWith('select wallet_transfer_id from closing_settlements where id = ? and closing_id = ?')) {
    return s.settlements.filter(y => y.id === v[0] && y.closing_id === v[1]).map(y => ({ wallet_transfer_id: y.wallet_transfer_id }));
  }
  if (text.startsWith('with del as ( delete from closing_settlements where id = ? and closing_id = ?')) {
    const x = s.settlements.find(y => y.id === v[0] && y.closing_id === v[1]); if (!x) return [];
    s.settlements = s.settlements.filter(y => y !== x);
    return [{ id: x.id, wallet_transfer_id: x.wallet_transfer_id, amount: x.amount, period_to: s.closings[x.closing_id].period_to }];
  }
  if (text.startsWith('with del as ( delete from closing_settlements where wallet_transfer_id in ?')) {
    const gone = s.settlements.filter(y => idsOf(v[0]).includes(y.wallet_transfer_id));
    s.settlements = s.settlements.filter(y => !gone.includes(y));
    return gone.map(x => ({ wallet_transfer_id: x.wallet_transfer_id, closing_id: x.closing_id, amount: x.amount, period_to: s.closings[x.closing_id].period_to }));
  }
  if (text.startsWith('insert into wallet_transfers')) {
    s.transfers[v[0] as string] = { id: v[0] as string, from_wallet_id: v[1] as string, to_wallet_id: v[2] as string, amount: String(v[3]), date: v[4] as string, note: v[5] as string }; return [];
  }
  if (text.startsWith('update wallet_transfers set')) {
    const t = s.transfers[v[5] as string]; t.from_wallet_id = v[0] as string; t.to_wallet_id = v[1] as string; t.amount = String(v[2]); t.date = v[3] as string; t.note = v[4] as string; return [];
  }
  if (text.startsWith('delete from wallet_transfers where id = ?')) { delete s.transfers[v[0] as string]; return []; }
  if (text.startsWith('delete from wallet_transfers where id in ?')) { for (const id of idsOf(v[0])) delete s.transfers[id]; return []; }
  // buka ulang closing
  if (text.startsWith('select id, status, is_opening_balance, period_to, total_cogs, total_revenue from closings where id = ? for update')) { const c = s.closings[v[0] as string]; return c ? [{ ...c, total_revenue: null }] : []; }
  if (text.startsWith("select id, period_to from closings where status = 'aktif' order by")) {
    const a = Object.values(s.closings).filter(c => c.status === 'aktif').sort((x, y) => y.period_to.localeCompare(x.period_to)); return a[0] ? [{ id: a[0].id, period_to: a[0].period_to }] : [];
  }
  if (text.startsWith('select count(*)::int as n from closing_settlements where closing_id = ?')) return [{ n: s.settlements.filter(x => x.closing_id === v[0]).length }];
  if (text.startsWith('update orders set closing_id = null') || text.startsWith('update order_payments set closing_id = null') || text.startsWith('update consignment_recaps set closing_id = null')) return [];
  if (text.startsWith("update closings set status = 'dibuka_ulang'")) { s.closings[v[2] as string].status = 'dibuka_ulang'; return []; }
  throw new Error(`SQL tak dikenal di fake: ${text}`);
}

function makeTx() {
  return (strings: unknown, ...values: unknown[]) => {
    if (!(strings as { raw?: unknown }).raw) return new Helper(strings as unknown[]);
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
vi.mock('@/lib/rbac', () => ({
  requirePermission: vi.fn(async () => ({ username: 'rifal', role: 'admin' })),
  hasPermission: vi.fn(async (_u: unknown, key: string) => key !== 'product-report' || h.reportView),
}));
vi.mock('@/lib/wallet-balance', () => ({
  computeWalletBalance: vi.fn(async () => 1_000_000),
  guardWalletBalances: vi.fn(async (_tx: unknown, _ids: unknown, mutate: () => Promise<void>) => { await mutate(); }),
  WalletBalanceError: class extends Error {},
}));

import { revalidateTag } from 'next/cache';
import { POST as settlePost, DELETE as settleDelete } from '@/app/api/closings/[id]/settlements/route';
import { POST as transferPost } from '@/app/api/wallet-transfers/route';
import { PUT as transferPut, DELETE as transferDelete } from '@/app/api/wallet-transfers/[id]/route';
import { POST as bulkDelete } from '@/app/api/wallet-transfers/bulk-delete/route';
import { reopenClosing } from '@/lib/closing';

const closing = (id: string, cogs: number, over: Partial<Closing> = {}): Closing =>
  ({ id, status: 'aktif', is_opening_balance: false, total_cogs: String(cogs), period_from: '2026-11-12', period_to: '2026-11-13', ...over });
const transfer = (id: string, amount: number): Transfer => ({ id, amount: String(amount), from_wallet_id: 'kas', to_wallet_id: 'bca', date: '2026-11-13', note: null });

beforeEach(() => {
  h.reportView = true; h.history = [];
  h.state = {
    closings: { c1: closing('c1', 118_750), c2: closing('c2', 50_000, { period_from: '2026-11-14', period_to: '2026-11-14' }), c0: closing('c0', 1000, { is_opening_balance: true }) },
    transfers: { t1: transfer('t1', 118_750), t2: transfer('t2', 30_000) },
    settlements: [], locks: [],
  };
  vi.clearAllMocks();
});

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const json = (url: string, method: string, body?: unknown) =>
  new NextRequest(`http://x${url}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const link = (closingId: string, walletTransferId: string, amount: number) => settlePost(json(`/api/closings/${closingId}/settlements`, 'POST', { mode: 'link', walletTransferId, amount }), ctx(closingId));
const total = (cid: string) => h.state.settlements.filter(x => x.closing_id === cid).reduce((n, x) => n + Number(x.amount), 0);

describe('POST /api/closings/[id]/settlements (tautkan transfer yang sudah ada)', () => {
  it('menautkan sebagian lalu sisanya (cicilan), tanpa melebihi HPP', async () => {
    expect((await link('c1', 't1', 60_000)).status).toBe(200);
    expect((await link('c1', 't2', 30_000)).status).toBe(200);
    expect(total('c1')).toBe(90_000);
    const over = await link('c1', 't1', 30_000); // t1 sudah tertaut ke c1
    expect(over.status).toBe(400);
    expect(h.history.some(x => x.entity === 'closings')).toBe(true);
    expect(revalidateTag).toHaveBeenCalledWith('admin-wallet-transfers', { expire: 0 });
  });
  it('menolak nominal melebihi sisa HPP, sisa transfer, closing saldo awal/dibuka ulang, dan tanpa akses baca closing', async () => {
    await link('c1', 't1', 100_000);
    const r1 = await link('c1', 't2', 30_000); // sisa c1 = 18.750
    expect(r1.status).toBe(400); expect((await r1.json() as { error: string }).error).toMatch(/melebihi HPP/);
    const r2 = await link('c2', 't1', 30_000); // t1 hanya punya 18.750 belum teralokasi
    expect(r2.status).toBe(400); expect((await r2.json() as { error: string }).error).toMatch(/melebihi jumlah transfer/);
    expect((await link('c0', 't2', 10)).status).toBe(400);
    h.state.closings.c2.status = 'dibuka_ulang';
    expect((await link('c2', 't2', 10)).status).toBe(400);
    h.reportView = false;
    expect((await link('c1', 't2', 10)).status).toBe(403);
    expect(total('c1')).toBe(100_000);
  });
  it('transfer satu menutup beberapa closing (alokasi ke dua closing)', async () => {
    expect((await link('c1', 't1', 100_000)).status).toBe(200);
    expect((await link('c2', 't1', 18_750)).status).toBe(200);
    expect(h.state.settlements.filter(x => x.wallet_transfer_id === 't1')).toHaveLength(2);
  });
});

describe('POST mode "new" dari Closing', () => {
  const body = (over: Record<string, unknown> = {}) => ({ mode: 'new', fromWalletId: 'kas', toWalletId: 'bca', amount: 118_750, date: '2026-11-14', note: 'setor', ...over });
  it('membuat transfer + tautan dalam satu transaksi', async () => {
    const res = await settlePost(json('/api/closings/c1/settlements', 'POST', body()), ctx('c1'));
    expect(res.status).toBe(200);
    const { transferId } = await res.json() as { transferId: string };
    expect(h.state.transfers[transferId].amount).toBe('118750');
    expect(total('c1')).toBe(118_750);
  });
  it('tautan gagal (closing sudah penuh) -> transfer ikut dibatalkan (rollback)', async () => {
    await link('c1', 't1', 118_750);
    const before = Object.keys(h.state.transfers).length;
    const res = await settlePost(json('/api/closings/c1/settlements', 'POST', body()), ctx('c1'));
    expect(res.status).toBe(400);
    expect(Object.keys(h.state.transfers)).toHaveLength(before);
    expect(h.state.settlements).toHaveLength(1);
  });
  it('validasi sama dengan POST wallet-transfers: dompet sama / nominal 0', async () => {
    expect((await settlePost(json('/api/closings/c1/settlements', 'POST', body({ toWalletId: 'kas' })), ctx('c1'))).status).toBe(400);
    expect((await settlePost(json('/api/closings/c1/settlements', 'POST', body({ amount: 0 })), ctx('c1'))).status).toBe(400);
  });
  it('nominal transfer lebih besar dari sisa: tautan dipotong ke sisa HPP bila linkAmount dikirim', async () => {
    const res = await settlePost(json('/api/closings/c1/settlements', 'POST', body({ amount: 200_000, linkAmount: 118_750 })), ctx('c1'));
    expect(res.status).toBe(200);
    expect(total('c1')).toBe(118_750);
  });
});

describe('POST /api/wallet-transfers dengan closingLinks', () => {
  it('transfer dan tautan dibuat bersama; melebihi HPP membatalkan semuanya', async () => {
    const mk = (amount: number) => transferPost(json('/api/wallet-transfers', 'POST', { fromWalletId: 'kas', toWalletId: 'bca', amount, date: '2026-11-14', closingLinks: [{ closingId: 'c1', amount }] }));
    expect((await mk(118_750)).status).toBe(200);
    expect(total('c1')).toBe(118_750);
    const n = Object.keys(h.state.transfers).length;
    expect((await mk(1_000)).status).toBe(400); // c1 sudah penuh
    expect(Object.keys(h.state.transfers)).toHaveLength(n);
  });
  it('tanpa closingLinks tidak menyentuh tabel tautan maupun mengunci closings', async () => {
    const res = await transferPost(json('/api/wallet-transfers', 'POST', { fromWalletId: 'kas', toWalletId: 'bca', amount: 5_000, date: '2026-11-14' }));
    expect(res.status).toBe(200);
    expect(h.state.locks).not.toContain('closings');
  });
});

describe('PUT /api/wallet-transfers/[id]', () => {
  const put = (id: string, body: Record<string, unknown>) => transferPut(json(`/api/wallet-transfers/${id}`, 'PUT', { fromWalletId: 'kas', toWalletId: 'bca', date: '2026-11-13', ...body }), ctx(id));
  it('menolak menurunkan jumlah di bawah total tautan; menaikkan boleh', async () => {
    await link('c1', 't1', 100_000);
    const low = await put('t1', { amount: 99_999 });
    expect(low.status).toBe(400); expect((await low.json() as { error: string }).error).toMatch(/tidak boleh kurang/);
    expect(h.state.transfers.t1.amount).toBe('118750');
    expect((await put('t1', { amount: 100_000 })).status).toBe(200);
    expect((await put('t1', { amount: 200_000 })).status).toBe(200);
  });
  it('tautan susulan, ubah nominal, lalu lepas lewat set pengganti', async () => {
    expect((await put('t1', { amount: 118_750, closingLinks: [{ closingId: 'c1', amount: 118_750 }] })).status).toBe(200);
    expect(total('c1')).toBe(118_750);
    expect((await put('t1', { amount: 118_750, closingLinks: [{ closingId: 'c1', amount: 100_000 }] })).status).toBe(200);
    expect(total('c1')).toBe(100_000);
    expect((await put('t1', { amount: 118_750, closingLinks: [] })).status).toBe(200);
    expect(h.state.settlements).toHaveLength(0);
  });
  it('set pengganti dengan jumlah baru yang lebih kecil dari tautan ditolak', async () => {
    const res = await put('t1', { amount: 50_000, closingLinks: [{ closingId: 'c1', amount: 60_000 }] });
    expect(res.status).toBe(400);
    expect(h.state.settlements).toHaveLength(0);
  });
});

describe('hapus transfer / lepas tautan / buka ulang', () => {
  it('DELETE transfer melepas tautan otomatis dan mencatat riwayat closings', async () => {
    await link('c1', 't1', 118_750);
    h.history = [];
    const res = await transferDelete(json('/api/wallet-transfers/t1', 'DELETE'), ctx('t1'));
    expect(res.status).toBe(200);
    expect(h.state.transfers.t1).toBeUndefined();
    expect(h.state.settlements).toHaveLength(0);
    expect(h.history.some(x => x.entity === 'closings' && String(x.entityLabel).includes('dilepas'))).toBe(true);
  });
  it('bulk-delete melepas tautan semua transfer yang dihapus', async () => {
    await link('c1', 't1', 100_000); await link('c2', 't2', 30_000);
    const res = await bulkDelete(json('/api/wallet-transfers/bulk-delete', 'POST', { ids: ['t1', 't2'] }));
    expect(res.status).toBe(200);
    expect(h.state.settlements).toHaveLength(0);
    expect(Object.keys(h.state.transfers)).toHaveLength(0);
  });
  it('DELETE settlements melepas satu tautan; id salah = 404', async () => {
    await link('c1', 't1', 100_000);
    const id = h.state.settlements[0].id;
    expect((await settleDelete(json(`/api/closings/c1/settlements?settlementId=nope`, 'DELETE'), ctx('c1'))).status).toBe(404);
    expect((await settleDelete(json(`/api/closings/c2/settlements?settlementId=${id}`, 'DELETE'), ctx('c2'))).status).toBe(404); // closing lain
    expect((await settleDelete(json(`/api/closings/c1/settlements?settlementId=${id}`, 'DELETE'), ctx('c1'))).status).toBe(200);
    expect(h.state.settlements).toHaveLength(0);
    expect(h.state.transfers.t1).toBeDefined(); // transfer dompet tetap ada
  });
  it('reopenClosing ditolak selama ada tautan; berhasil setelah tautan dilepas', async () => {
    h.state.closings.c1.period_to = '2026-11-20'; // jadikan c1 closing aktif terakhir
    await link('c1', 't1', 10_000);
    const sql = (await import('@/lib/db')).getSql();
    await expect(reopenClosing(sql as never, { id: 'c1', reason: 'salah', username: 'rifal', isSuperAdmin: false })).rejects.toThrow(/Lepas tautan transfer dulu/);
    expect(h.state.closings.c1.status).toBe('aktif');
    h.state.settlements = [];
    await expect(reopenClosing(sql as never, { id: 'c1', reason: 'salah', username: 'rifal', isSuperAdmin: false })).resolves.toMatchObject({ id: 'c1' });
  });
});

// ── Tambahan Syahla: izin di API, validasi input, urutan kunci, atomisitas, PUT tanpa closingLinks ──────────
import { requirePermission } from '@/lib/rbac';
import { GET as payableGet } from '@/app/api/closings/payable/route';

const denied = () => new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });

describe('izin ditegakkan di API (bukan hanya UI)', () => {
  it('POST settlements minta wallets:create; DELETE settlements minta wallets:edit; payable minta product-report:view', async () => {
    await link('c1', 't1', 1_000);
    await settleDelete(json(`/api/closings/c1/settlements?settlementId=${h.state.settlements[0].id}`, 'DELETE'), ctx('c1'));
    const calls = vi.mocked(requirePermission).mock.calls.map(c => `${c[1]}:${c[2]}`);
    expect(calls).toContain('wallets:create');
    expect(calls).toContain('wallets:edit');
    vi.mocked(requirePermission).mockResolvedValueOnce(denied());
    expect((await payableGet(json('/api/closings/payable', 'GET') as never)).status).toBe(403);
    expect(vi.mocked(requirePermission).mock.calls.at(-1)?.slice(1)).toEqual(['product-report', 'view']);
  });
  it('izin ditolak -> tidak ada perubahan data (POST link, DELETE unlink, bulk-delete, DELETE transfer)', async () => {
    await link('c1', 't1', 1_000);
    const sid = h.state.settlements[0].id;
    for (const call of [
      () => link('c1', 't2', 500),
      () => settleDelete(json(`/api/closings/c1/settlements?settlementId=${sid}`, 'DELETE'), ctx('c1')),
      () => bulkDelete(json('/api/wallet-transfers/bulk-delete', 'POST', { ids: ['t1'] })),
      () => transferDelete(json('/api/wallet-transfers/t1', 'DELETE'), ctx('t1')),
    ]) {
      vi.mocked(requirePermission).mockResolvedValueOnce(denied());
      expect((await call()).status).toBe(403);
    }
    expect(h.state.settlements).toHaveLength(1);
    expect(h.state.transfers.t1).toBeDefined();
  });
  it('DELETE settlements tanpa akses baca closing = 403 dan tautan tidak lepas', async () => {
    await link('c1', 't1', 1_000);
    h.reportView = false;
    const res = await settleDelete(json(`/api/closings/c1/settlements?settlementId=${h.state.settlements[0].id}`, 'DELETE'), ctx('c1'));
    expect(res.status).toBe(403);
    expect(h.state.settlements).toHaveLength(1);
  });
  it('POST/PUT transfer dengan tautan tanpa akses baca closing = 403, tanpa efek samping', async () => {
    h.reportView = false;
    const n = Object.keys(h.state.transfers).length;
    const post = await transferPost(json('/api/wallet-transfers', 'POST', { fromWalletId: 'kas', toWalletId: 'bca', amount: 1_000, closingLinks: [{ closingId: 'c1', amount: 1_000 }] }));
    expect(post.status).toBe(403);
    expect(Object.keys(h.state.transfers)).toHaveLength(n);
    const put = await transferPut(json('/api/wallet-transfers/t1', 'PUT', { fromWalletId: 'kas', toWalletId: 'bca', amount: 118_750, closingLinks: [{ closingId: 'c1', amount: 1_000 }] }), ctx('t1'));
    expect(put.status).toBe(403);
    expect(h.state.settlements).toHaveLength(0);
  });
});

describe('validasi input rute tautan', () => {
  const bad: [string, unknown][] = [
    ['bukan array', 'c1'], ['null', null], ['objek', { closingId: 'c1', amount: 1 }],
    ['nominal NaN (string)', [{ closingId: 'c1', amount: 'abc' }]], ['nominal negatif', [{ closingId: 'c1', amount: -5 }]],
    ['nominal 0', [{ closingId: 'c1', amount: 0 }]], ['nominal Infinity (string)', [{ closingId: 'c1', amount: 'Infinity' }]],
    ['nominal membulat ke 0', [{ closingId: 'c1', amount: 0.001 }]], ['closingId bukan string', [{ closingId: 7, amount: 5 }]],
    ['elemen null', [null]], ['closing dobel', [{ closingId: 'c1', amount: 1 }, { closingId: 'c1', amount: 2 }]],
  ];
  it.each(bad)('PUT transfer menolak closingLinks %s (400) dan tautan lama tetap', async (_n, closingLinks) => {
    await link('c1', 't1', 1_000);
    const res = await transferPut(json('/api/wallet-transfers/t1', 'PUT', { fromWalletId: 'kas', toWalletId: 'bca', amount: 118_750, closingLinks }), ctx('t1'));
    expect(res.status).toBe(400);
    expect(total('c1')).toBe(1_000);
  });
  it('POST settlements mode link: nominal/transfer tidak valid -> 400; transfer tak ada -> 400 tanpa membocorkan SQL', async () => {
    for (const amount of ['abc', -1, 0, 'Infinity', null]) {
      expect((await settlePost(json('/api/closings/c1/settlements', 'POST', { mode: 'link', walletTransferId: 't1', amount }), ctx('c1'))).status).toBe(400);
    }
    expect((await settlePost(json('/api/closings/c1/settlements', 'POST', { mode: 'link', walletTransferId: '', amount: 5 }), ctx('c1'))).status).toBe(400);
    const res = await settlePost(json('/api/closings/c1/settlements', 'POST', { mode: 'link', walletTransferId: 'tidak-ada', amount: 5 }), ctx('c1'));
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).not.toMatch(/select|insert|closing_settlements/i);
    expect((await settlePost(json('/api/closings/c1/settlements', 'POST', { mode: 'xyz' }), ctx('c1'))).status).toBe(400);
    expect((await settlePost(json('/api/closings/tidak-ada/settlements', 'POST', { mode: 'link', walletTransferId: 't1', amount: 5 }), ctx('tidak-ada'))).status).toBe(400);
    expect(h.state.settlements).toHaveLength(0);
  });
  it('DELETE settlements tanpa settlementId = 400', async () => {
    expect((await settleDelete(json('/api/closings/c1/settlements', 'DELETE'), ctx('c1'))).status).toBe(400);
  });
  it('bulk-delete menolak ids bukan array / kosong dan tidak menghapus apa pun', async () => {
    expect((await bulkDelete(json('/api/wallet-transfers/bulk-delete', 'POST', { ids: 't1' }))).status).toBe(400);
    expect((await bulkDelete(json('/api/wallet-transfers/bulk-delete', 'POST', { ids: [] }))).status).toBe(400);
    expect(Object.keys(h.state.transfers)).toHaveLength(2);
  });
});

describe('PUT transfer tanpa closingLinks & urutan kunci', () => {
  const put = (id: string, body: Record<string, unknown>) => transferPut(json(`/api/wallet-transfers/${id}`, 'PUT', { fromWalletId: 'kas', toWalletId: 'bca', date: '2026-11-13', ...body }), ctx(id));
  it('ubah catatan/tanggal tanpa mengirim closingLinks: tautan tidak berubah dan closings tidak dikunci', async () => {
    await link('c1', 't1', 100_000);
    h.state.locks = []; h.history = [];
    expect((await put('t1', { amount: 118_750, date: '2026-11-15', note: 'revisi' })).status).toBe(200);
    expect(total('c1')).toBe(100_000);
    expect(h.state.locks).not.toContain('closings');
    expect(h.history.filter(x => x.entity === 'closings')).toHaveLength(0);
  });
  it('transfer tanpa tautan tidak pernah mengunci closings pada PUT/DELETE/bulk-delete', async () => {
    h.state.locks = [];
    await put('t2', { amount: 40_000 });
    await transferDelete(json('/api/wallet-transfers/t2', 'DELETE'), ctx('t2'));
    await bulkDelete(json('/api/wallet-transfers/bulk-delete', 'POST', { ids: ['t1'] }));
    expect(h.state.locks).not.toContain('closings');
  });
  it('urutan kunci: dompet asal lebih dulu, baru advisory closings (POST dengan tautan, PUT dengan tautan, mode new)', async () => {
    await transferPost(json('/api/wallet-transfers', 'POST', { fromWalletId: 'kas', toWalletId: 'bca', amount: 1_000, closingLinks: [{ closingId: 'c1', amount: 1_000 }] }));
    expect(h.state.locks).toEqual(['wallet', 'closings']);
    h.state.locks = [];
    await put('t1', { amount: 118_750, closingLinks: [{ closingId: 'c1', amount: 500 }] });
    expect(h.state.locks).toEqual(['wallet', 'closings']);
    h.state.locks = [];
    await settlePost(json('/api/closings/c1/settlements', 'POST', { mode: 'new', fromWalletId: 'kas', toWalletId: 'bca', amount: 1_000 }), ctx('c1'));
    expect(h.state.locks).toEqual(['wallet', 'closings']);
  });
  it('PUT dengan closingLinks [] melepas semua tautan tanpa mengunci closings (melepas tidak butuh akses baca closing)', async () => {
    await link('c1', 't1', 100_000);
    h.state.locks = []; h.reportView = false;
    expect((await put('t1', { amount: 118_750, closingLinks: [] })).status).toBe(200);
    expect(h.state.settlements).toHaveLength(0);
    expect(h.state.locks).not.toContain('closings');
  });
  it('PUT transfer yang tidak ada = 404', async () => {
    expect((await put('nope', { amount: 1_000 })).status).toBe(404);
  });
});

describe('mode "new": rollback & batas nominal', () => {
  const body = (over: Record<string, unknown> = {}) => ({ mode: 'new', fromWalletId: 'kas', toWalletId: 'bca', amount: 10_000, date: '2026-11-14', ...over });
  it('closing dibuka ulang / saldo awal / tidak ada -> 400 dan transfer baru dibatalkan', async () => {
    h.state.closings.c2.status = 'dibuka_ulang';
    const n = Object.keys(h.state.transfers).length;
    for (const id of ['c2', 'c0', 'tidak-ada']) {
      expect((await settlePost(json(`/api/closings/${id}/settlements`, 'POST', body()), ctx(id))).status).toBe(400);
    }
    expect(Object.keys(h.state.transfers)).toHaveLength(n);
    expect(h.state.settlements).toHaveLength(0);
  });
  it('linkAmount lebih besar dari jumlah transfer dipotong ke jumlah transfer; linkAmount tidak valid -> 400', async () => {
    const ok = await settlePost(json('/api/closings/c1/settlements', 'POST', body({ linkAmount: 99_999 })), ctx('c1'));
    expect(ok.status).toBe(200);
    expect(total('c1')).toBe(10_000);
    for (const linkAmount of [0, -1, 'abc']) {
      expect((await settlePost(json('/api/closings/c1/settlements', 'POST', body({ linkAmount })), ctx('c1'))).status).toBe(400);
    }
  });
  it('tanpa linkAmount dan jumlah > sisa HPP: seluruh transfer ditolak (rollback), bukan transfer tanpa tautan', async () => {
    const n = Object.keys(h.state.transfers).length;
    const res = await settlePost(json('/api/closings/c1/settlements', 'POST', body({ amount: 200_000 })), ctx('c1'));
    expect(res.status).toBe(400);
    expect(Object.keys(h.state.transfers)).toHaveLength(n);
  });
});

describe('riwayat hapus transfer', () => {
  it('DELETE transfer menyimpan closingLinks yang dilepas di snapshot sebelum (audit)', async () => {
    await link('c1', 't1', 100_000); await link('c2', 't1', 18_750);
    h.history = [];
    await transferDelete(json('/api/wallet-transfers/t1', 'DELETE'), ctx('t1'));
    const del = h.history.find(x => x.entity === 'wallet-transfers' && x.action === 'delete');
    expect((del?.before as { closingLinks?: unknown[] }).closingLinks).toHaveLength(2);
    expect(h.history.filter(x => x.entity === 'closings')).toHaveLength(2);
  });
});
