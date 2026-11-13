import { randomUUID } from 'crypto';
import type postgres from 'postgres';
import { parseJsonb } from '@/lib/db';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- lihat catatan yang sama di src/lib/wallet-balance.ts
type PgClient = postgres.ISql<{}>;

// ── Closing HPP (Laporan Produk) ─────────────────────────────────────────────────────────────
// "Item closing" adalah satu dari tiga hal, masing-masing punya kolom `closing_id`:
//  - 'payment' : satu baris order_payments (cicilan/DP/pelunasan sisa) — HPP & omzet diakui PROPORSIONAL
//                (amount / total pesanan), sama seperti Laporan Keuangan (lib/installment-payments-report.ts).
//  - 'order'   : pesanan lunas TANPA baris cicilan (lunas sekaligus) — diakui penuh. Pesanan yang punya
//                cicilan tidak pernah ditandai di level pesanan (hindari dobel hitung).
//  - 'recap'   : rekap konsinyasi Mitra yang lunas.
// Tanggal bayar efektif: payment = paid_at; order/recap = coalesce(paid_at, created_at) (paid_at diisi saat
// "Tandai Lunas" tanpa cicilan; kosong = lunas sejak dibuat). Closing mengambil semua item belum-closing yang
// tanggal bayarnya (WIB) <= tanggal yang dipilih. Kasir Lapak (stall_sales) TIDAK ikut.
// Aturan yang sama dipakai skrip backfill saldo awal (scripts/backfill-opening-closing.mjs).

export type ClosingKind = 'order' | 'payment' | 'recap';

export interface ClosingLine {
  key: string;
  kind: ClosingKind;
  orderId?: string; paymentId?: string; recapId?: string;
  invoiceNo: string;
  party: string;
  txDate: string;          // yyyy-mm-dd (WIB) — tanggal transaksi
  paidDate: string | null; // yyyy-mm-dd (WIB) — null = belum dibayar (piutang)
  qty: number; cogs: number; revenue: number;
  note?: string;
}

export interface LineTotals { count: number; qty: number; cogs: number; revenue: number }

export class ClosingError extends Error {}

const r2 = (n: number) => Math.round(n * 100) / 100;
export const wibDate = (d: Date): string => new Date(d.getTime() + 7 * 3600_000).toISOString().slice(0, 10);

interface OrderItemLike { productId?: string; qty: number; price?: number; subtotal?: number; costPrice?: number }
interface RecapItemLike { productId?: string; qtySold: number; revenue?: number; hargaTitip?: number; costPrice?: number }
export type CostOf = (stored: number | undefined, productId: string | undefined) => number;

// Sama dengan perhitungan per item di analytics/product-report: diskon dipotong dari total pesanan,
// jadi omzet item diprorata (total / subtotal item); item tanpa productId (ongkir dll.) tidak dihitung.
// `fraction` = porsi pesanan yang diakui (1 = penuh, 0.5 = cicilan 50%).
export function orderTotals(items: OrderItemLike[], total: number, fraction: number, costOf: CostOf) {
  const itemsSubtotal = items.reduce((s, it) => s + (it.subtotal ?? (it.price ?? 0) * it.qty), 0);
  const scale = itemsSubtotal > 0 ? total / itemsSubtotal : 1;
  let qty = 0, revenue = 0, cogs = 0;
  for (const it of items) {
    if (!it.productId) continue;
    qty += it.qty;
    revenue += (it.subtotal ?? (it.price ?? 0) * it.qty) * scale;
    cogs += it.qty * costOf(it.costPrice, it.productId);
  }
  return { qty: r2(qty * fraction), revenue: Math.round(revenue * fraction), cogs: Math.round(cogs * fraction) };
}

export function recapTotals(items: RecapItemLike[], costOf: CostOf) {
  let qty = 0, revenue = 0, cogs = 0;
  for (const it of items) {
    qty += it.qtySold;
    revenue += it.revenue ?? (it.hargaTitip ?? 0) * it.qtySold;
    cogs += it.qtySold * costOf(it.costPrice, it.productId);
  }
  return { qty: r2(qty), revenue: Math.round(revenue), cogs: Math.round(cogs) };
}

export interface PoolOrderRow {
  id: string; invoice_no: string | null; customer_name: string; items: unknown; total: string; payment_status: string;
  created_at: Date; paid_at: Date | null; closing_id: string | null;
}
export interface PoolPaymentRow { id: string; order_id: string; amount: string; paid_at: Date; closing_id: string | null }
export interface PoolRecapRow {
  id: string; location_name: string; items: unknown; payment_status: string;
  created_at: Date; paid_at: Date | null; closing_id: string | null;
}

// Satu pesanan → baris "sudah dibayar & belum closing" (per cicilan, atau satu baris bila lunas sekaligus)
// dan baris piutang (porsi yang belum dibayar). Murni (tanpa DB) supaya bisa diuji.
export function buildOrderLines(order: PoolOrderRow, payments: PoolPaymentRow[], costOf: CostOf): { paid: ClosingLine[]; receivable: ClosingLine | null } {
  const items = (parseJsonb(order.items as OrderItemLike[] | string | null) ?? []) as OrderItemLike[];
  const total = Number(order.total) || 0;
  const base = {
    orderId: order.id, invoiceNo: order.invoice_no ?? '', party: order.customer_name, txDate: wibDate(order.created_at),
  };
  const paid: ClosingLine[] = [];
  let receivable: ClosingLine | null = null;

  if (payments.length > 0) {
    // Pembulatan: nilai tiap cicilan = selisih nilai KUMULATIF yang diakui (dibulatkan) sebelum & sesudahnya,
    // jadi total semua cicilan persis sama dengan pesanan penuh (cicilan terakhir/pelunasan menyerap sisa
    // pembulatan) dan nilai sebuah cicilan tidak bergantung pada cicilan lain yang datang sesudahnya.
    // Pesanan yang sudah lunas: cicilan terakhir dianggap melunasi (kumulatif = 100%). `payments` harus urut paid_at.
    const settled = order.payment_status === 'lunas' && total > 0;
    let cum = 0;
    let prev = orderTotals(items, total, 0, costOf);
    payments.forEach((p, i) => {
      const amount = Number(p.amount) || 0;
      cum += amount;
      const cumFraction = total > 0 ? (settled && i === payments.length - 1 ? 1 : Math.min(1, cum / total)) : 0;
      const upTo = orderTotals(items, total, cumFraction, costOf);
      const t = { qty: r2(upTo.qty - prev.qty), revenue: upTo.revenue - prev.revenue, cogs: upTo.cogs - prev.cogs };
      prev = upTo;
      if (p.closing_id) return;
      const fraction = total > 0 ? Math.min(1, amount / total) : 0;
      paid.push({ ...base, key: `payment:${p.id}`, kind: 'payment', paymentId: p.id, paidDate: wibDate(p.paid_at), ...t, note: `Cicilan ${Math.round(fraction * 100)}%` });
    });
    if (order.payment_status === 'belum_lunas') {
      const rest = total > 0 ? Math.max(0, 1 - cum / total) : 0;
      if (rest > 0) {
        const full = orderTotals(items, total, 1, costOf);
        const t = { qty: r2(full.qty - prev.qty), revenue: full.revenue - prev.revenue, cogs: full.cogs - prev.cogs };
        receivable = { ...base, key: `order:${order.id}`, kind: 'order', paidDate: null, ...t, note: `Sisa ${Math.round(rest * 100)}%` };
      }
    }
  } else if (order.payment_status === 'lunas') {
    if (!order.closing_id) {
      const t = orderTotals(items, total, 1, costOf);
      paid.push({ ...base, key: `order:${order.id}`, kind: 'order', paidDate: wibDate(order.paid_at ?? order.created_at), ...t });
    }
  } else {
    receivable = { ...base, key: `order:${order.id}`, kind: 'order', paidDate: null, ...orderTotals(items, total, 1, costOf) };
  }
  return { paid, receivable };
}

export function buildRecapLine(recap: PoolRecapRow, costOf: CostOf): { paid: ClosingLine | null; receivable: ClosingLine | null } {
  const items = (parseJsonb(recap.items as RecapItemLike[] | string | null) ?? []) as RecapItemLike[];
  const base = {
    key: `recap:${recap.id}`, kind: 'recap' as const, recapId: recap.id, invoiceNo: 'Rekap Mitra', party: recap.location_name,
    txDate: wibDate(recap.created_at), ...recapTotals(items, costOf),
  };
  if (recap.payment_status === 'lunas') {
    if (recap.closing_id) return { paid: null, receivable: null };
    return { paid: { ...base, paidDate: wibDate(recap.paid_at ?? recap.created_at) }, receivable: null };
  }
  return { paid: null, receivable: { ...base, paidDate: null } };
}

export const closableLines = (lines: ClosingLine[], upTo: string) => lines.filter(l => l.paidDate !== null && l.paidDate <= upTo);

export function sumLines(lines: ClosingLine[]): LineTotals {
  return lines.reduce((a, l) => ({ count: a.count + 1, qty: r2(a.qty + l.qty), cogs: a.cogs + l.cogs, revenue: a.revenue + l.revenue }), { count: 0, qty: 0, cogs: 0, revenue: 0 });
}

// ── Aturan murni (diuji di closing.test.ts) ──

// yyyy-mm-dd yang benar-benar ada di kalender (menolak 2026-02-31, bulan 13, dst.).
export function isRealDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.toISOString().slice(0, 10) === s;
}

export function closeProblem(upTo: string, today: string, latestActivePeriodTo: string | null): string | null {
  if (!isRealDate(upTo)) return 'Tanggal closing tidak valid.';
  if (upTo > today) return 'Tanggal closing tidak boleh di masa depan.';
  if (latestActivePeriodTo && upTo < latestActivePeriodTo) {
    return `Tanggal closing tidak boleh lebih awal dari closing terakhir (${latestActivePeriodTo}). Pilih tanggal yang sama atau lebih baru, atau buka ulang closing terakhir.`;
  }
  return null;
}

// Tanggal bayar cicilan (paidAt) tidak boleh di masa depan (tanggal WIB) dan tidak boleh sebelum period_to
// closing aktif terakhir — cicilan "mundur" ke periode yang sudah ditutup tidak akan pernah ikut closing mana pun.
export function paidAtProblem(paidAt: Date, now: Date, latestActivePeriodTo: string | null): string | null {
  const day = wibDate(paidAt);
  if (day > wibDate(now)) return 'Tanggal pembayaran tidak boleh di masa depan.';
  if (latestActivePeriodTo && day < latestActivePeriodTo) {
    return `Tanggal pembayaran tidak boleh sebelum closing terakhir (${latestActivePeriodTo}). Pilih tanggal ${latestActivePeriodTo} atau sesudahnya, atau buka ulang closing terakhir lebih dulu.`;
  }
  return null;
}

export function reopenProblem(a: {
  closing: { id: string; status: string; is_opening_balance: boolean; period_to: string } | undefined;
  latestActiveId: string | null; isSuperAdmin: boolean; reason: string;
  settlementCount?: number; // jumlah tautan transfer (closing_settlements) milik closing ini
}): string | null {
  if (!a.closing) return 'Closing tidak ditemukan.';
  if (a.closing.status !== 'aktif') return 'Closing ini sudah dibuka ulang.';
  if (!a.reason.trim()) return 'Alasan buka ulang wajib diisi.';
  if (a.closing.is_opening_balance && !a.isSuperAdmin) return 'Closing saldo awal hanya bisa dibuka ulang oleh Super Admin.';
  if (a.latestActiveId !== a.closing.id) return 'Hanya closing aktif paling terakhir yang bisa dibuka ulang — buka ulang closing yang lebih baru lebih dulu.';
  if ((a.settlementCount ?? 0) > 0) return 'Closing ini sudah punya tautan transfer dompet. Lepas tautan transfer dulu, baru buka ulang.';
  return null;
}

// ── Akses DB ──

export interface ClosingPool { paid: ClosingLine[]; receivable: ClosingLine[] }

// Sama seperti Laporan Produk: snapshot costPrice dipakai; kalau 0/kosong pakai Harga Modal produk terkini.
// Catatan: fallback itu "hidup" (ikut berubah bila Harga Modal produk diubah) dan sengaja TIDAK dibekukan —
// membekukannya berarti menulis ulang items pesanan saat closing dan menyimpang dari Laporan Produk.
// Dampaknya terbatas: total yang disimpan di baris closings tetap (tidak dihitung ulang), dan transaksi yang
// sudah closing tidak tampil lagi di kartu "belum closing"; hanya pembanding Laporan Produk yang bisa bergeser
// bila ada transaksi ber-costPrice 0 dan Harga Modal produknya diubah kemudian.
export function makeCostOf(costRows: { id: string; cost_price: string | null }[]): CostOf {
  const costMap = new Map(costRows.map(r => [r.id, r.cost_price != null ? Number(r.cost_price) : 0]));
  return (stored, pid) => stored ? stored : (pid ? (costMap.get(pid) ?? 0) : 0);
}

async function loadPaymentsByOrder(tx: PgClient, orderIds: string[]): Promise<Map<string, PoolPaymentRow[]>> {
  const payRows = orderIds.length > 0
    ? await tx<PoolPaymentRow[]>`select id, order_id, amount, paid_at, closing_id from order_payments where order_id in ${tx(orderIds)} order by paid_at, created_at`
    : [];
  const payByOrder = new Map<string, PoolPaymentRow[]>();
  for (const p of payRows) { const a = payByOrder.get(p.order_id); if (a) a.push(p); else payByOrder.set(p.order_id, [p]); }
  return payByOrder;
}

// Semua item yang BELUM closing (sudah dibayar → `paid`; belum dibayar → `receivable`).
// `lock` = kunci baris pesanan/rekap (for update) — dipakai saat closing supaya edit bersamaan menunggu.
export async function loadPool(tx: PgClient, lock: boolean): Promise<ClosingPool> {
  const forUpdate = lock ? tx`for update of o` : tx``;
  const forUpdateRecap = lock ? tx`for update` : tx``;
  const [costRows, orderRows, recapRows] = await Promise.all([
    tx<{ id: string; cost_price: string | null }[]>`select id, cost_price from products`,
    tx<PoolOrderRow[]>`
      select o.id, o.invoice_no, o.customer_name, o.items, o.total, o.payment_status, o.created_at, o.paid_at, o.closing_id
      from orders o
      where o.status not in ('baru', 'dibatalkan') and coalesce(o.is_free, false) = false
        and (
          (not exists (select 1 from order_payments p where p.order_id = o.id) and o.closing_id is null)
          or (exists (select 1 from order_payments p where p.order_id = o.id)
              and (o.payment_status = 'belum_lunas'
                   or exists (select 1 from order_payments p where p.order_id = o.id and p.closing_id is null)))
        )
      order by o.created_at, o.id
      ${forUpdate}
    `,
    tx<PoolRecapRow[]>`
      select id, location_name, items, payment_status, created_at, paid_at, closing_id
      from consignment_recaps where closing_id is null order by created_at, id ${forUpdateRecap}
    `,
  ]);
  const costOf = makeCostOf(costRows);
  const payByOrder = await loadPaymentsByOrder(tx, orderRows.map(o => o.id));

  const paid: ClosingLine[] = [];
  const receivable: ClosingLine[] = [];
  for (const o of orderRows) {
    const r = buildOrderLines(o, payByOrder.get(o.id) ?? [], costOf);
    paid.push(...r.paid);
    if (r.receivable) receivable.push(r.receivable);
  }
  for (const rc of recapRows) {
    const r = buildRecapLine(rc, costOf);
    if (r.paid) paid.push(r.paid);
    if (r.receivable) receivable.push(r.receivable);
  }
  return { paid, receivable };
}

// Rincian sebuah closing (baris ber-closing_id = id) untuk PDF — memakai pembangun baris yang SAMA dengan
// loadPool/createClosing (buildOrderLines/buildRecapLine) supaya angkanya identik dengan snapshot di tabel closings.
// Pembangun itu membuang baris yang sudah closing, jadi closing_id dikosongkan dulu di salinan lalu hasilnya
// disaring ke item milik closing ini. Closing yang sudah dibuka ulang tidak punya baris lagi (closing_id dikosongkan
// saat buka ulang) → hasilnya kosong. Hanya baca; tidak menulis apa pun.
export async function loadClosingLines(sql: PgClient, closingId: string): Promise<ClosingLine[]> {
  const [costRows, orderRows, recapRows] = await Promise.all([
    sql<{ id: string; cost_price: string | null }[]>`select id, cost_price from products`,
    sql<PoolOrderRow[]>`
      select o.id, o.invoice_no, o.customer_name, o.items, o.total, o.payment_status, o.created_at, o.paid_at, o.closing_id
      from orders o
      where o.closing_id = ${closingId}
        or exists (select 1 from order_payments p where p.order_id = o.id and p.closing_id = ${closingId})
      order by o.created_at, o.id
    `,
    sql<PoolRecapRow[]>`
      select id, location_name, items, payment_status, created_at, paid_at, closing_id
      from consignment_recaps where closing_id = ${closingId} order by created_at, id
    `,
  ]);
  const costOf = makeCostOf(costRows);
  const payByOrder = await loadPaymentsByOrder(sql, orderRows.map(o => o.id));

  const lines: ClosingLine[] = [];
  for (const o of orderRows) {
    const pays = payByOrder.get(o.id) ?? [];
    const mine = new Set(pays.filter(p => p.closing_id === closingId).map(p => p.id));
    const built = buildOrderLines({ ...o, closing_id: null }, pays.map(p => ({ ...p, closing_id: null })), costOf);
    for (const l of built.paid) {
      if (l.kind === 'payment' ? mine.has(l.paymentId!) : o.closing_id === closingId) lines.push(l);
    }
  }
  for (const rc of recapRows) {
    const l = buildRecapLine({ ...rc, closing_id: null }, costOf).paid;
    if (l) lines.push(l);
  }
  return lines.sort((a, b) => (a.paidDate ?? '').localeCompare(b.paidDate ?? '') || a.txDate.localeCompare(b.txDate) || a.invoiceNo.localeCompare(b.invoiceNo));
}

// Kunci serialisasi closing/buka-ulang (dan skrip backfill) — satu closing berjalan pada satu waktu.
export const lockClosings = (tx: PgClient) => tx`select pg_advisory_xact_lock(hashtext('closings'))`;

// "Closing aktif terakhir" — urutan tunggal yang dipakai di mana-mana: period_to terbesar, lalu closed_at terbaru
// (closed_at memakai clock_timestamp() saat insert, bukan now() awal transaksi, supaya urut sesuai antrean kunci).
export async function latestActiveClosing(tx: PgClient): Promise<{ id: string; period_to: string } | null> {
  const [row] = await tx<{ id: string; period_to: string }[]>`
    select id, period_to from closings where status = 'aktif' order by period_to desc, closed_at desc limit 1
  `;
  return row ?? null;
}

export const todayWib = () => wibDate(new Date());

export async function createClosing(sql: postgres.Sql, a: { upTo: string; note?: string; username: string }) {
  return sql.begin(async tx => {
    await lockClosings(tx);
    const latest = await latestActiveClosing(tx);
    const problem = closeProblem(a.upTo, todayWib(), latest?.period_to ?? null);
    if (problem) throw new ClosingError(problem);

    const pool = await loadPool(tx, true);
    const lines = closableLines(pool.paid, a.upTo);
    if (lines.length === 0) throw new ClosingError('Tidak ada transaksi yang sudah dibayar dan belum closing sampai tanggal itu.');
    const totals = sumLines(lines);
    const periodFrom = lines.reduce((m, l) => (l.paidDate! < m ? l.paidDate! : m), lines[0].paidDate!);
    const id = randomUUID();
    await tx`
      insert into closings (id, period_from, period_to, closed_at, closed_by, total_qty, total_cogs, total_revenue, item_count, note, status, is_opening_balance)
      values (${id}, ${periodFrom}, ${a.upTo}, clock_timestamp(), ${a.username}, ${totals.qty}, ${totals.cogs}, ${totals.revenue}, ${totals.count}, ${a.note?.trim() || null}, 'aktif', false)
    `;
    const orderIds = lines.filter(l => l.kind === 'order').map(l => l.orderId!);
    const paymentIds = lines.filter(l => l.kind === 'payment').map(l => l.paymentId!);
    const recapIds = lines.filter(l => l.kind === 'recap').map(l => l.recapId!);
    // Tiap UPDATE dijaga `closing_id is null` dan jumlah barisnya dicek — kalau ada yang meleset, batalkan semua.
    if (orderIds.length > 0) {
      const res = await tx`update orders set closing_id = ${id} where id in ${tx(orderIds)} and closing_id is null`;
      if (res.count !== orderIds.length) throw new ClosingError('Data pesanan berubah saat closing diproses — coba lagi.');
    }
    if (paymentIds.length > 0) {
      const res = await tx`update order_payments set closing_id = ${id} where id in ${tx(paymentIds)} and closing_id is null`;
      if (res.count !== paymentIds.length) throw new ClosingError('Data pembayaran berubah saat closing diproses — coba lagi.');
    }
    if (recapIds.length > 0) {
      const res = await tx`update consignment_recaps set closing_id = ${id} where id in ${tx(recapIds)} and closing_id is null`;
      if (res.count !== recapIds.length) throw new ClosingError('Data rekap berubah saat closing diproses — coba lagi.');
    }
    return { id, periodFrom, periodTo: a.upTo, ...totals };
  });
}

export async function reopenClosing(sql: postgres.Sql, a: { id: string; reason: string; username: string; isSuperAdmin: boolean }) {
  return sql.begin(async tx => {
    await lockClosings(tx);
    const [closing] = await tx<{ id: string; status: string; is_opening_balance: boolean; period_to: string; total_cogs: string | null; total_revenue: string | null }[]>`
      select id, status, is_opening_balance, period_to, total_cogs, total_revenue from closings where id = ${a.id} for update
    `;
    const latest = await latestActiveClosing(tx);
    // Tautan transfer dibuat di bawah kunci `closings` yang sama, jadi hitungan ini tidak bisa basi.
    const [{ n: settlementCount }] = await tx<{ n: number }[]>`select count(*)::int as n from closing_settlements where closing_id = ${a.id}`;
    const problem = reopenProblem({ closing, latestActiveId: latest?.id ?? null, isSuperAdmin: a.isSuperAdmin, reason: a.reason, settlementCount });
    if (problem) throw new ClosingError(problem);

    const o = await tx`update orders set closing_id = null where closing_id = ${a.id}`;
    const p = await tx`update order_payments set closing_id = null where closing_id = ${a.id}`;
    const r = await tx`update consignment_recaps set closing_id = null where closing_id = ${a.id}`;
    await tx`
      update closings set status = 'dibuka_ulang', reopened_at = now(), reopened_by = ${a.username}, reopen_reason = ${a.reason.trim().slice(0, 500)}
      where id = ${a.id}
    `;
    return { id: a.id, periodTo: closing.period_to, released: o.count + p.count + r.count };
  });
}

// ── Kunci edit ──
// Mengembalikan pesan penolakan bila pesanan/rekap/pembayaran sudah masuk closing AKTIF (closing_id
// terisi hanya selama closing aktif — buka ulang mengosongkannya). Panggil di DALAM transaksi, SETELAH
// baris dikunci (`for update`), supaya hasilnya tidak basi terhadap closing yang sedang berjalan.

const lockMessage = (what: string, periodTo: string) =>
  `${what} sudah masuk Closing (sampai ${periodTo}) — nilai, status, dan tanggalnya terkunci. Buka ulang closing terakhir lebih dulu bila perlu mengubahnya.`;

// Pesanan terkunci bila pesanannya sendiri (lunas sekaligus) ATAU salah satu cicilannya sudah closing.
export async function orderClosingLock(tx: PgClient, orderId: string): Promise<string | null> {
  const [row] = await tx<{ period_to: string }[]>`
    select c.period_to from closings c
    where c.id in (
      select closing_id from orders where id = ${orderId} and closing_id is not null
      union
      select closing_id from order_payments where order_id = ${orderId} and closing_id is not null
    )
    order by c.period_to desc, c.closed_at desc limit 1
  `;
  return row ? lockMessage('Pesanan ini', row.period_to) : null;
}

// Hanya bila pesanannya SENDIRI (orders.closing_id — lunas sekaligus) sudah closing. Cicilan yang sudah closing
// tidak menghalangi pelunasan sisa. Dipakai di POST cicilan sebagai pertahanan berlapis.
export async function orderOwnClosingLock(tx: PgClient, orderId: string): Promise<string | null> {
  const [row] = await tx<{ period_to: string }[]>`
    select c.period_to from orders o join closings c on c.id = o.closing_id where o.id = ${orderId}
  `;
  return row ? lockMessage('Pesanan ini', row.period_to) : null;
}

export async function paymentClosingLock(tx: PgClient, paymentId: string): Promise<string | null> {
  const [row] = await tx<{ period_to: string }[]>`
    select c.period_to from order_payments p join closings c on c.id = p.closing_id where p.id = ${paymentId}
  `;
  return row ? lockMessage('Pembayaran ini', row.period_to) : null;
}

export async function recapClosingLock(tx: PgClient, recapId: string): Promise<string | null> {
  const [row] = await tx<{ period_to: string }[]>`
    select c.period_to from consignment_recaps r join closings c on c.id = r.closing_id where r.id = ${recapId}
  `;
  return row ? lockMessage('Rekap ini', row.period_to) : null;
}
