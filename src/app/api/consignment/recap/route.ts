import { randomUUID } from 'crypto';
import { NextRequest, after } from 'next/server';
import { unstable_cache } from 'next/cache';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { CONSIGNMENT_RECAP_VIEW_KEYS } from '@/lib/permissions';
import { wibDayStart, wibDayEnd } from '@/lib/date';
import { logHistory } from '@/lib/history';
import { notify } from '@/lib/notifications';
import { revalidateStorefront } from '@/lib/revalidate';
import { writeStockLedgerEntryPg, stockLabel } from '@/lib/stock-pg';
import { rowToRecap, type RecapRow } from '@/lib/recaps-pg';

interface RecapItemInput { productId: string; productName: string; qtySold: number; qtyRetur: number; qtyReject?: number }

// Gabungkan baris ganda untuk produk yang sama SEBELUM dipakai di tx.get/tx.update — tanpa ini,
// tiap baris dibaca & divalidasi dari snapshot stok titip yang sama, lalu tx.update dengan nilai
// literal per baris (bukan akumulatif), sehingga baris kedua menimpa hasil baris pertama pada
// `consignmentStock` sementara `totalRevenue` (dipakai langsung Laporan Keuangan) tetap
// menjumlahkan SEMUA baris termasuk yang duplikat — pendapatan bisa dobel terhitung padahal
// pengurangan stok cuma sekali. Pola sama seperti mergeItems di consignment/send/route.ts.
function mergeRecapItems(items: RecapItemInput[]): RecapItemInput[] {
  const merged = new Map<string, RecapItemInput>();
  for (const it of items) {
    const qtySold = Number(it.qtySold) || 0;
    const qtyRetur = Number(it.qtyRetur) || 0;
    const qtyReject = Number(it.qtyReject) || 0;
    const existing = merged.get(it.productId);
    if (existing) {
      existing.qtySold += qtySold;
      existing.qtyRetur += qtyRetur;
      existing.qtyReject = (existing.qtyReject ?? 0) + qtyReject;
    } else {
      merged.set(it.productId, { ...it, qtySold, qtyRetur, qtyReject });
    }
  }
  return [...merged.values()];
}

// Dibaca dengan from=2000-01-01 (seluruh riwayat) oleh useWalletBalances di 7 tab setiap kali ada
// transaksi baru — cache waktu murni (bukan revalidateTag) karena koleksi ini juga ditulis dari
// PATCH/PUT/DELETE di consignment/recap/[id]/route.ts. Lihat komentar serupa di
// src/app/api/orders/route.ts. (Tahap 13 migrasi Fase 2 — lihat plan gleaming-wondering-quokka.md.)
const getCachedRecaps = unstable_cache(
  async (from: string | null, to: string | null, limit: number) => {
    const sql = getSql();
    let rows: RecapRow[];
    if (from && to) {
      rows = await sql<RecapRow[]>`select * from consignment_recaps where created_at >= ${wibDayStart(from).toDate()} and created_at <= ${wibDayEnd(to).toDate()} order by created_at desc`;
    } else if (from) {
      rows = await sql<RecapRow[]>`select * from consignment_recaps where created_at >= ${wibDayStart(from).toDate()} order by created_at desc`;
    } else if (to) {
      rows = await sql<RecapRow[]>`select * from consignment_recaps where created_at <= ${wibDayEnd(to).toDate()} order by created_at desc`;
    } else {
      rows = await sql<RecapRow[]>`select * from consignment_recaps order by created_at desc limit ${limit}`;
    }
    return rows.map(rowToRecap);
  },
  ['admin-consignment-recap-list'],
  { revalidate: 15 },
);

// Read by IncomeTab & FinanceReportTab (not just the Konsinyasi tab) to roll
// consignment revenue into their totals — gate view with OR semantics so a
// Finance role without `consignment` access doesn't get its totals silently
// understated by a swallowed 401/403.
export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, CONSIGNMENT_RECAP_VIEW_KEYS, 'view');
  if (guard instanceof Response) return guard;
  const { searchParams } = new URL(req.url);
  const from = searchParams.get('from'); // ISO yyyy-mm-dd — dipakai Laporan Keuangan untuk filter per periode
  const to   = searchParams.get('to');
  const limit = parseInt(searchParams.get('limit') ?? '50');
  const db = getDb();
  const sql = getSql();

  const recaps = await getCachedRecaps(from, to, limit);

  // Lazy overdue check — dijalankan tiap daftar rekap dibuka (dalam window cache 15 detik di
  // atas, bukan tiap request persis), bukan lewat cron (tidak ada infra scheduler saat ini).
  // `overdueNotifiedAt` jadi flag idempoten supaya notifikasi cuma ditulis sekali per rekap.
  const now = Date.now();
  await Promise.all(recaps.map(async r => {
    if (r.paymentStatus !== 'belum_lunas' || !r.dueDate || r.overdueNotifiedAt) return;
    if (r.dueDate.seconds * 1000 > now) return;
    await notify(db, {
      type: 'consignment_overdue',
      title: 'Konsinyasi jatuh tempo',
      message: `Rekap konsinyasi ${r.locationName ?? r.id} senilai Rp${(r.totalRevenue ?? 0).toLocaleString('id-ID')} sudah lewat tenggat pembayaran.`,
      link: 'consignment',
      entityCollection: 'consignmentRecaps', entityId: r.id,
      // Bukan aksi si pembuka halaman — ini terdeteksi otomatis oleh waktu yang lewat, jadi
      // actor-nya "system", bukan `guard` (yang cuma kebetulan sedang membuka daftar rekap).
      actor: { username: 'system', role: 'system' },
    });
    await sql`update consignment_recaps set overdue_notified_at = now() where id = ${r.id}`;
  }));

  return Response.json({ recaps });
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'consignment', 'create');
  if (guard instanceof Response) return guard;
  const data = await req.json() as {
    locationId: string; locationName: string; note?: string; items: RecapItemInput[];
    paymentStatus?: 'lunas' | 'belum_lunas'; walletId?: string | null;
    warehouseId?: string; warehouseName?: string; date?: string; dueDate?: string;
  };
  const items = mergeRecapItems(data.items ?? [])
    .map(it => ({ ...it, qtyReject: it.qtyReject ?? 0 }))
    .filter(it => it.qtySold > 0 || it.qtyRetur > 0 || it.qtyReject > 0);
  if (items.length === 0) return Response.json({ error: 'Isi minimal 1 produk dengan qty terjual, retur, atau reject.' }, { status: 400 });
  const paymentStatus = data.paymentStatus === 'belum_lunas' ? 'belum_lunas' : 'lunas';

  const hasReturnOrReject = items.some(it => it.qtyRetur > 0 || it.qtyReject > 0);
  if (hasReturnOrReject && !data.warehouseId) {
    return Response.json({ error: 'Pilih gudang tujuan untuk retur/reject.' }, { status: 400 });
  }

  const db = getDb();
  const sql = getSql();

  // Stok (consignmentStock/products/warehouse_stock/stock_ledger, Tahap 8-10) DAN dokumen rekap
  // (Tahap 13) sekarang sama-sama di Postgres, jadi digabung jadi SATU transaksi atomic — tidak
  // ada lagi kompensasi cross-database seperti versi sebelumnya. Lihat pola yang sama di
  // orders/route.ts (Tahap 12).
  interface RecapItemWithCost extends RecapItemInput { hargaTitip: number; revenue: number; costPrice: number; cogs: number }
  let recapItems: RecapItemWithCost[] = [];
  let totalSold = 0, totalRetur = 0, totalReject = 0, totalRevenue = 0;
  const recapId = randomUUID();

  try {
    await sql.begin(async pgTx => {
      const stockKeys = items.map(it => `${data.locationId}_${it.productId}`);
      const stockRows = await pgTx<{ id: string; stock_qty: string; harga_titip: string | null }[]>`
        select id, stock_qty, harga_titip from consignment_stock where id in ${pgTx(stockKeys)} order by id for update
      `;
      const stockById = new Map(stockRows.map(r => [r.id, r]));

      const shortages: string[] = [];
      items.forEach((it, i) => {
        const row = stockById.get(stockKeys[i]);
        if (!row) { shortages.push(`${it.productName} (tidak ada stok titip tercatat)`); return; }
        const stockQty = Number(row.stock_qty) || 0;
        const requested = it.qtySold + it.qtyRetur + it.qtyReject;
        if (requested > stockQty) shortages.push(`${it.productName} (stok di lokasi ${stockQty}, diminta ${requested})`);
      });
      if (shortages.length > 0) throw new Error(`Qty melebihi stok di lokasi: ${shortages.join(', ')}`);

      // Snapshot HPP (costPrice) tiap produk saat rekap terjadi — dipakai Laporan Keuangan untuk
      // menghitung HPP barang konsinyasi yang benar-benar terjual (costPrice produk adalah rata-rata
      // bergerak, jadi HPP historis tidak bisa direkonstruksi ulang kalau tidak disimpan di sini).
      const productIds = [...new Set(items.map(it => it.productId))];
      const productRows = await pgTx<{ id: string; stock_qty: string; cost_price: string | null; open_po: boolean }[]>`
        select id, stock_qty, cost_price, open_po from products where id in ${pgTx(productIds)} order by id for update
      `;
      const productById = new Map(productRows.map(r => [r.id, r]));

      recapItems = items.map((it, i) => {
        const stockRow = stockById.get(stockKeys[i])!;
        const hargaTitip = Number(stockRow.harga_titip) || 0;
        const productRow = productById.get(it.productId);
        const costPrice = productRow?.cost_price != null ? Number(productRow.cost_price) : 0;
        return { ...it, hargaTitip, revenue: it.qtySold * hargaTitip, costPrice, cogs: it.qtySold * costPrice };
      });

      for (const [i, it] of items.entries()) {
        const row = stockById.get(stockKeys[i])!;
        const stockQty = Number(row.stock_qty) || 0;
        const newQty = stockQty - it.qtySold - it.qtyRetur - it.qtyReject;
        await pgTx`update consignment_stock set stock_qty = ${newQty}, updated_at = now() where id = ${stockKeys[i]}`;
      }

      // Retur (kondisi baik) dikreditkan ke gudang tujuan — sinkron dengan endpoint stok masuk gudang.
      for (const it of items.filter(it => it.qtyRetur > 0)) {
        const row = productById.get(it.productId);
        if (!row) continue;
        const oldQty = Number(row.stock_qty) || 0;
        const newQty = oldQty + it.qtyRetur;
        await pgTx`update products set stock_qty = ${newQty}, stock = ${stockLabel(row.open_po, newQty)}, updated_at = now() where id = ${it.productId}`;

        const wsKey = `${data.warehouseId}_${it.productId}`;
        await pgTx`
          insert into warehouse_stock (id, warehouse_id, product_id, product_name, stock_qty, updated_at)
          values (${wsKey}, ${data.warehouseId!}, ${it.productId}, ${it.productName}, ${it.qtyRetur}, now())
          on conflict (id) do update set stock_qty = warehouse_stock.stock_qty + excluded.stock_qty, updated_at = now()
        `;
        await writeStockLedgerEntryPg(pgTx, {
          productId: it.productId, productName: it.productName, warehouseId: data.warehouseId, warehouseName: data.warehouseName,
          type: 'in', qty: it.qtyRetur, note: `Retur konsinyasi – ${data.locationName}${data.note ? `: ${data.note}` : ''}`,
        });
      }

      // Reject (rusak/tidak layak jual) — tidak menambah stok jual, hanya tercatat sebagai kerugian
      // di riwayat gudang (badge "Reject") supaya tetap terlihat, tanpa mengubah warehouse_stock.
      for (const it of items.filter(it => it.qtyReject > 0)) {
        await writeStockLedgerEntryPg(pgTx, {
          productId: it.productId, productName: it.productName, warehouseId: data.warehouseId, warehouseName: data.warehouseName,
          type: 'reject', qty: it.qtyReject, note: `Reject konsinyasi – ${data.locationName}${data.note ? `: ${data.note}` : ''}`,
        });
      }

      totalSold    = recapItems.reduce((s, it) => s + it.qtySold, 0);
      totalRetur   = recapItems.reduce((s, it) => s + it.qtyRetur, 0);
      totalReject  = recapItems.reduce((s, it) => s + (it.qtyReject ?? 0), 0);
      totalRevenue = recapItems.reduce((s, it) => s + it.revenue, 0);

      await pgTx`
        insert into consignment_recaps (
          id, location_id, location_name, items, total_sold, total_retur, total_reject, total_revenue,
          payment_status, warehouse_id, warehouse_name, note, wallet_id, due_date, created_at
        ) values (
          ${recapId}, ${data.locationId}, ${data.locationName}, ${JSON.stringify(recapItems)},
          ${totalSold}, ${totalRetur}, ${totalReject}, ${totalRevenue}, ${paymentStatus},
          ${data.warehouseId ?? null}, ${data.warehouseName ?? null}, ${data.note ?? null}, ${data.walletId ?? null},
          ${data.dueDate ? new Date(data.dueDate) : null}, ${data.date ? new Date(data.date) : new Date()}
        )
      `;
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal menyimpan rekap.' }, { status: 400 });
  }

  // History/notifikasi tetap Firestore (di luar cakupan Tahap 13) — best-effort setelah transaksi
  // Postgres commit, sama pola dengan orders/route.ts.
  try {
    await logHistory(db, {
      entity: 'consignment',
      entityCollection: 'consignmentRecaps',
      entityId: recapId,
      entityLabel: `${data.locationName ?? 'Rekap'}${data.date ? ` - ${data.date}` : ''}`,
      action: 'create',
      actor: guard,
      after: { locationId: data.locationId, locationName: data.locationName, items: recapItems, totalSold, totalRetur, totalReject, totalRevenue, paymentStatus },
    });
  } catch (err) {
    console.error('Failed to write history for consignment recap create', err);
  }
  try {
    await notify(db, {
      type: 'consignment_recap',
      title: 'Rekap konsinyasi baru',
      message: `Rekap ${data.locationName} senilai Rp${totalRevenue.toLocaleString('id-ID')} (${paymentStatus === 'lunas' ? 'lunas' : 'belum lunas'}) — oleh ${guard.username}.`,
      link: 'consignment',
      entityCollection: 'consignmentRecaps', entityId: recapId,
      actor: guard,
    });
  } catch (err) {
    console.error('Failed to send notification for new consignment recap', err);
  }

  if (items.some(it => it.qtyRetur > 0)) after(() => revalidateStorefront('products'));
  // "Terjual" di beranda storefront juga menghitung totalSold dari consignmentRecaps.
  after(() => revalidateStorefront('stats'));

  return Response.json({ id: recapId });
}
