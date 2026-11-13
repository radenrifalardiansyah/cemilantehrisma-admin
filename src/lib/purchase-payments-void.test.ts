import { beforeEach, describe, expect, it, vi } from 'vitest';

// Tes void/hapus pembelian ber-cicilan dan batas batal cicilan, memakai Postgres palsu di memori (tanpa kunci baris
// `for update`, jadi balapan TIDAK teruji di sini). Query tak dikenal melempar error supaya tak ada SQL yang lolos diam-diam.

interface Payment { id: string; purchase_id: string; amount: string; date: string; wallet_id: string | null; expense_id: string | null; note: string; created_by: string | null; created_at: Date; voided: boolean; voided_at: Date | null }
interface Expense { id: string; amount: string; wallet_id: string }
interface S { purchase: Record<string, unknown>; payments: Payment[]; expenses: Expense[] }

const h = vi.hoisted(() => ({ s: null as unknown as S }));

vi.mock('@/lib/wallet-balance', () => ({
  guardWalletBalances: vi.fn(async (_tx: unknown, _ids: unknown, mutate: () => Promise<void>) => { await mutate(); }),
  WalletBalanceError: class extends Error {},
}));

const isTemplate = (a: unknown): a is TemplateStringsArray => Array.isArray(a) && 'raw' in (a as object);

function exec(text: string, v: unknown[]): unknown[] {
  const s = h.s;
  if (text.startsWith('select * from material_purchases where id = ? for update')) return [s.purchase];
  if (text.startsWith('select coalesce(sum(amount), 0) as s from material_purchase_payments')) {
    return [{ s: String(s.payments.filter(p => !p.voided).reduce((n, p) => n + Number(p.amount), 0)) }];
  }
  if (text.startsWith('select * from material_purchase_payments where id = ? and purchase_id = ? for update')) return s.payments.filter(p => p.id === v[0]);
  if (text.startsWith('select * from material_purchase_payments where purchase_id = ? and not voided for update')) return s.payments.filter(p => !p.voided);
  if (text.startsWith('select id from wallets')) return [{ id: v[0] }];
  if (text.startsWith('select id from expenses where id = ?')) return s.expenses.filter(e => e.id === v[0]);
  if (text.startsWith('select items from material_purchases where created_at >')) return [];
  if (text.startsWith('select materials_used from production_batches')) return [];
  if (text.startsWith('delete from expenses where id in ?')) { const ids = v[0] as string[]; s.expenses = s.expenses.filter(e => !ids.includes(e.id)); return []; }
  if (text.startsWith('delete from expenses where id = ?')) { s.expenses = s.expenses.filter(e => e.id !== v[0]); return []; }
  if (text.startsWith("update material_purchase_payments set voided = true, voided_at = now(), expense_id = null where purchase_id = ? and not voided")) {
    s.payments.filter(p => !p.voided).forEach(p => { p.voided = true; p.expense_id = null; }); return [];
  }
  if (text.startsWith("update material_purchase_payments set voided = true, voided_at = now(), expense_id = null where id = ?")) {
    const p = s.payments.find(x => x.id === v[0])!; p.voided = true; p.expense_id = null; return [];
  }
  if (text.startsWith('delete from material_purchase_payments where purchase_id = ?')) { s.payments = []; return []; }
  if (text.startsWith('update material_purchases set voided = true')) { s.purchase.voided = true; s.purchase.payment_status = 'belum_lunas'; s.purchase.expense_id = null; return []; }
  if (text.startsWith("update material_purchases set payment_status = 'belum_lunas'")) { s.purchase.payment_status = 'belum_lunas'; return []; }
  if (text.startsWith("update material_purchases set payment_status = 'lunas'")) { s.purchase.payment_status = 'lunas'; return []; }
  if (text.startsWith('update material_purchases set updated_at')) return [];
  if (text.startsWith('insert into expenses')) { s.expenses.push({ id: v[0] as string, amount: String(v[2]), wallet_id: v[5] as string }); return []; }
  if (text.startsWith('insert into material_purchase_payments')) {
    s.payments.push({ id: v[0] as string, purchase_id: v[1] as string, amount: String(v[2]), date: v[3] as string, wallet_id: v[4] as string, expense_id: v[5] as string, note: '', created_by: 'x', created_at: new Date(), voided: false, voided_at: null }); return [];
  }
  throw new Error(`SQL tak dikenal di fake: ${text}`);
}

// Dipanggil sebagai tag template (query) ATAU sebagai fungsi biasa `pgTx(array)` (helper `in ${pgTx(ids)}`).
const tx = ((a: unknown, ...v: unknown[]) => {
  if (!isTemplate(a)) return a;
  const text = (a as unknown as string[]).join('?').replace(/\s+/g, ' ').trim();
  try { return Promise.resolve(exec(text, v)); } catch (e) { return Promise.reject(e); }
}) as never;

import { addPurchasePaymentTx, cancelPurchasePaymentTx, removePurchasePaymentsTx } from '@/lib/purchase-payments';
import { voidPurchaseTx } from '@/lib/material-purchase-core';
import { parseDueDate } from '@/lib/payables-core';

const pay = (id: string, amount: number, over: Partial<Payment> = {}): Payment => ({
  id, purchase_id: 'p1', amount: String(amount), date: '2026-11-05', wallet_id: 'kas', expense_id: `e-${id}`, note: '', created_by: 'x',
  created_at: new Date('2026-11-05T00:00:00Z'), voided: false, voided_at: null, ...over,
});
const expense = (id: string, amount: number): Expense => ({ id, amount: String(amount), wallet_id: 'kas' });

beforeEach(() => {
  h.s = {
    purchase: {
      id: 'p1', supplier_id: 's1', supplier_name: 'Toko A', items: [], total: '1000', date: '2026-11-01', payment_status: 'belum_lunas', expense_id: null,
      note: '', wallet_id: 'kas', voided: false, voided_at: null, void_note: null, source: 'manual', po_id: null, gr_id: null, due_date: '2026-11-20',
      created_at: new Date('2026-11-01T00:00:00Z'), updated_at: null,
    },
    payments: [pay('a', 300), pay('b', 200)],
    expenses: [expense('e-a', 300), expense('e-b', 200), expense('lain', 999)],
  };
});

describe('removePurchasePaymentsTx', () => {
  it('mode void: pengeluaran semua cicilan aktif dihapus, baris ditandai voided, pengeluaran lain utuh', async () => {
    const r = await removePurchasePaymentsTx(tx, 'p1', 'void');
    expect(r).toEqual({ count: 2, amount: 500 });
    expect(h.s.expenses.map(e => e.id)).toEqual(['lain']);
    expect(h.s.payments).toHaveLength(2);
    expect(h.s.payments.every(p => p.voided && p.expense_id === null)).toBe(true);
  });

  it('mode void: cicilan yang sudah dibatalkan tidak dihitung ulang', async () => {
    h.s.payments.push(pay('c', 100, { voided: true, expense_id: null }));
    const r = await removePurchasePaymentsTx(tx, 'p1', 'void');
    expect(r).toEqual({ count: 2, amount: 500 });
  });

  it('mode delete: semua baris pembayaran dibuang (FK restrict aman) dan pengeluaran aktif dihapus', async () => {
    const r = await removePurchasePaymentsTx(tx, 'p1', 'delete');
    expect(r.count).toBe(2);
    expect(h.s.payments).toHaveLength(0);
    expect(h.s.expenses.map(e => e.id)).toEqual(['lain']);
  });

  it('tanpa cicilan: tidak menyentuh apa pun', async () => {
    h.s.payments = [];
    expect(await removePurchasePaymentsTx(tx, 'p1', 'void')).toEqual({ count: 0, amount: 0 });
    expect(h.s.expenses).toHaveLength(3);
  });
});

describe('voidPurchaseTx pada pembelian ber-cicilan', () => {
  it('void mengembalikan uang semua cicilan (pengeluaran terhapus), melaporkan jumlah, dan pembelian tidak lagi jadi hutang aktif', async () => {
    const r = await voidPurchaseTx(tx, 'p1', 'salah input');
    expect(r.paymentsVoided).toBe(2);
    expect(r.expenseDeleted).toBe(true);
    expect(h.s.expenses.map(e => e.id)).toEqual(['lain']);
    expect(h.s.payments.every(p => p.voided)).toBe(true);
    expect(h.s.purchase.voided).toBe(true);
  });

  it('void pembelian tanpa cicilan: paymentsVoided 0 dan tak ada pengeluaran terhapus', async () => {
    h.s.payments = []; h.s.expenses = [expense('lain', 5)];
    const r = await voidPurchaseTx(tx, 'p1', '');
    expect(r.paymentsVoided).toBe(0);
    expect(r.expenseDeleted).toBe(false);
    expect(h.s.expenses).toHaveLength(1);
  });

  it('void dua kali ditolak (tidak membereskan cicilan lagi)', async () => {
    await voidPurchaseTx(tx, 'p1', '');
    await expect(voidPurchaseTx(tx, 'p1', '')).rejects.toThrow(/sudah dibatalkan/);
  });
});

describe('batal cicilan: status turunan', () => {
  it('membatalkan satu dari beberapa cicilan pada pembelian belum lunas: tetap belum lunas, hanya pengeluaran cicilan itu hilang', async () => {
    const r = await cancelPurchasePaymentTx(tx, 'p1', 'a');
    expect(r.reopened).toBe(false);
    expect(r.paidAfter).toBe(200);
    expect(h.s.expenses.map(e => e.id)).toEqual(['e-b', 'lain']);
    expect(h.s.purchase.payment_status).toBe('belum_lunas');
  });

  it('batal cicilan pelunasan toleransi Rp1: lunas karena 999.999 dari 1.000.000 dibuka lagi bila cicilan itu dibatalkan', async () => {
    h.s.purchase.total = '1000000'; h.s.purchase.payment_status = 'lunas';
    h.s.payments = [pay('a', 999_999)];
    h.s.expenses = [expense('e-a', 999_999)];
    const r = await cancelPurchasePaymentTx(tx, 'p1', 'a');
    expect(r.reopened).toBe(true);
    expect(h.s.purchase.payment_status).toBe('belum_lunas');
    expect(h.s.expenses).toHaveLength(0);
  });

  it('cicilan lunas (3 termin) lalu termin tengah dibatalkan: sisa = nominal termin itu, bisa dibayar ulang tepat sebesar sisa', async () => {
    h.s.payments = [pay('a', 400), pay('b', 300)];
    h.s.expenses = [expense('e-a', 400), expense('e-b', 300)];
    await addPurchasePaymentTx(tx, { purchaseId: 'p1', amount: 300, date: '2026-11-10', walletId: 'kas', note: '', actor: 'x' });
    expect(h.s.purchase.payment_status).toBe('lunas');
    await cancelPurchasePaymentTx(tx, 'p1', 'b');
    expect(h.s.purchase.payment_status).toBe('belum_lunas');
    await expect(addPurchasePaymentTx(tx, { purchaseId: 'p1', amount: 301, date: '2026-11-11', walletId: 'kas', note: '', actor: 'x' })).rejects.toThrow(/melebihi sisa/);
    const ok = await addPurchasePaymentTx(tx, { purchaseId: 'p1', amount: 300, date: '2026-11-11', walletId: 'kas', note: '', actor: 'x' });
    expect(ok.settled).toBe(true);
    expect(h.s.expenses.reduce((n, e) => n + Number(e.amount), 0)).toBe(1000);
  });
});

describe('validasi jatuh tempo', () => {
  it('menolak tanggal kalender yang tidak ada (30/31 Februari) — jangan lolos lalu bergeser ke Maret', () => {
    expect(parseDueDate('2026-02-31')).toEqual({ error: expect.any(String) });
    expect(parseDueDate('2026-04-31')).toEqual({ error: expect.any(String) });
    expect(parseDueDate('2026-02-28')).toEqual({ value: '2026-02-28' });
  });
});
