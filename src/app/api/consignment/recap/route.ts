import { NextRequest, after } from 'next/server';
import { unstable_cache } from 'next/cache';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { CONSIGNMENT_RECAP_VIEW_KEYS } from '@/lib/permissions';
import { FieldValue, Timestamp, Query, DocumentData } from 'firebase-admin/firestore';
import { wibDayStart, wibDayEnd } from '@/lib/date';
import { writeHistoryEntry } from '@/lib/history';
import { notify, writeNotification, sendPush } from '@/lib/notifications';
import { revalidateStorefront } from '@/lib/revalidate';
import {
  writeStockLedgerEntryPg, stockLabel, captureAndSetWs, compensateStock,
  type ProductSnapshot, type WsSnapshot,
} from '@/lib/stock-pg';

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
// src/app/api/orders/route.ts. `dueDate` di-serialize ke {seconds,nanoseconds} di sini (sama
// seperti createdAt) karena nilai balik unstable_cache lewat JSON round-trip — instance
// Timestamp asli (dengan method .toMillis()) tidak akan selamat kalau dibiarkan apa adanya.
const getCachedRecaps = unstable_cache(
  async (from: string | null, to: string | null, limit: number) => {
    const db = getDb();
    let query: Query<DocumentData> = db.collection('consignmentRecaps').orderBy('createdAt', 'desc');
    if (from) query = query.where('createdAt', '>=', wibDayStart(from));
    if (to)   query = query.where('createdAt', '<=', wibDayEnd(to));
    if (!from && !to) query = query.limit(limit);

    const snap = await query.get();
    return snap.docs.map(d => {
      const data = d.data();
      const createdAt = data.createdAt as Timestamp | undefined;
      const dueDate = data.dueDate as Timestamp | undefined | null;
      return {
        ...(data as { paymentStatus?: 'lunas' | 'belum_lunas'; locationName?: string; totalRevenue?: number; overdueNotifiedAt?: unknown }),
        id: d.id,
        createdAt: createdAt ? { seconds: createdAt.seconds, nanoseconds: createdAt.nanoseconds } : null,
        dueDate: dueDate ? { seconds: dueDate.seconds, nanoseconds: dueDate.nanoseconds } : null,
      };
    });
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

  const recaps = await getCachedRecaps(from, to, limit);

  // Lazy overdue check — dijalankan tiap daftar rekap dibuka (dalam window cache 15 detik di
  // atas, bukan tiap request persis), bukan lewat cron (tidak ada infra scheduler saat ini).
  // `overdueNotifiedAt` jadi flag idempoten supaya notifikasi cuma ditulis sekali per rekap.
  const now = Timestamp.now();
  await Promise.all(recaps.map(async r => {
    if (r.paymentStatus !== 'belum_lunas' || !r.dueDate || r.overdueNotifiedAt) return;
    if (r.dueDate.seconds * 1000 > now.toMillis()) return;
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
    await db.collection('consignmentRecaps').doc(r.id).update({ overdueNotifiedAt: FieldValue.serverTimestamp() });
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
  const recapRef = db.collection('consignmentRecaps').doc();

  // `consignmentStock`/`products`/`warehouse_stock`/`stock_ledger` sudah pindah ke Postgres
  // (Tahap 8-10 Fase 2) — divalidasi & dipotong DULU di sana, baru dokumen rekap (Firestore, masih
  // di sana untuk sementara) ditulis. Kompensasi (kembalikan stok) dijalankan best-effort kalau
  // langkah Firestore gagal setelah Postgres berhasil. Lihat pola yang sama di orders/route.ts.
  interface RecapItemWithCost extends RecapItemInput { hargaTitip: number; revenue: number; costPrice: number; cogs: number }
  let recapItems: RecapItemWithCost[] = [];
  const productSnapshots: ProductSnapshot[] = [];
  const wsSnapshots: WsSnapshot[] = [];
  const consignmentStockSnapshots: { key: string; oldQty: number }[] = [];
  let stockCommitted = false;

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
        consignmentStockSnapshots.push({ key: stockKeys[i], oldQty: stockQty });
        const newQty = stockQty - it.qtySold - it.qtyRetur - it.qtyReject;
        await pgTx`update consignment_stock set stock_qty = ${newQty}, updated_at = now() where id = ${stockKeys[i]}`;
      }

      // Retur (kondisi baik) dikreditkan ke gudang tujuan — sinkron dengan endpoint stok masuk gudang.
      for (const it of items.filter(it => it.qtyRetur > 0)) {
        const row = productById.get(it.productId);
        if (!row) continue;
        const oldQty = Number(row.stock_qty) || 0;
        productSnapshots.push({ productId: it.productId, oldQty, oldCost: row.cost_price != null ? Number(row.cost_price) : 0, openPO: row.open_po });
        const newQty = oldQty + it.qtyRetur;
        await pgTx`update products set stock_qty = ${newQty}, stock = ${stockLabel(row.open_po, newQty)}, updated_at = now() where id = ${it.productId}`;

        await captureAndSetWs(pgTx, wsSnapshots, `${data.warehouseId}_${it.productId}`, data.warehouseId!, it.productId, it.productName,
          old => old + it.qtyRetur);
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
    });
    stockCommitted = true;
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal menyimpan rekap.' }, { status: 400 });
  }

  const totalSold    = recapItems.reduce((s, it) => s + it.qtySold, 0);
  const totalRetur   = recapItems.reduce((s, it) => s + it.qtyRetur, 0);
  const totalReject  = recapItems.reduce((s, it) => s + (it.qtyReject ?? 0), 0);
  const totalRevenue = recapItems.reduce((s, it) => s + it.revenue, 0);

  let pushPayload: { title: string; message: string } | null = null;
  try {
    await db.runTransaction(async tx => {
      const recapDoc = {
        locationId: data.locationId, locationName: data.locationName,
        items: recapItems, totalSold, totalRetur, totalReject, totalRevenue,
        paymentStatus,
        warehouseId: data.warehouseId ?? '', warehouseName: data.warehouseName ?? '',
        note: data.note ?? '',
        walletId: data.walletId ?? null,
        createdAt: data.date ? Timestamp.fromDate(new Date(data.date)) : FieldValue.serverTimestamp(),
        dueDate: data.dueDate ? Timestamp.fromDate(new Date(data.dueDate)) : null,
      };
      tx.set(recapRef, recapDoc);

      pushPayload = writeNotification(tx, db, {
        type: 'consignment_recap',
        title: 'Rekap konsinyasi baru',
        message: `Rekap ${data.locationName} senilai Rp${totalRevenue.toLocaleString('id-ID')} (${paymentStatus === 'lunas' ? 'lunas' : 'belum lunas'}) — oleh ${guard.username}.`,
        link: 'consignment',
        entityCollection: 'consignmentRecaps', entityId: recapRef.id,
        actor: guard,
      });

      writeHistoryEntry(tx, db, {
        entity: 'consignment',
        entityCollection: 'consignmentRecaps',
        entityId: recapRef.id,
        entityLabel: `${data.locationName ?? 'Rekap'}${data.date ? ` - ${data.date}` : ''}`,
        action: 'create',
        actor: guard,
        after: recapDoc,
      });
    });
  } catch (err) {
    // Dokumen rekap gagal tersimpan SETELAH stok Postgres sudah dipotong — kompensasi: kembalikan
    // consignment_stock/products/warehouse_stock ke kondisi semula.
    if (stockCommitted) {
      try {
        await Promise.all([
          compensateStock(sql, productSnapshots, wsSnapshots),
          sql.begin(async pgTx => {
            for (const s of consignmentStockSnapshots) {
              await pgTx`update consignment_stock set stock_qty = ${s.oldQty}, updated_at = now() where id = ${s.key}`;
            }
          }),
        ]);
      } catch (compErr) {
        console.error('CRITICAL: gagal kompensasi stok setelah rekap konsinyasi gagal tersimpan', compErr);
      }
    }
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal menyimpan rekap.' }, { status: 400 });
  }

  if (pushPayload) await sendPush(db, pushPayload).catch(err => console.error('Failed to send push for consignment recap', err));
  if (items.some(it => it.qtyRetur > 0)) after(() => revalidateStorefront('products'));
  // "Terjual" di beranda storefront juga menghitung totalSold dari consignmentRecaps.
  after(() => revalidateStorefront('stats'));

  return Response.json({ id: recapRef.id });
}
