import { NextRequest, after } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { writeHistoryEntry, logHistory } from '@/lib/history';
import { revalidateStorefront } from '@/lib/revalidate';
import { writeStockLedgerEntryPg, stockLabel } from '@/lib/stock-pg';

type Ctx = { params: Promise<{ id: string }> };
interface RecapItem { productId: string; productName: string; qtySold: number; qtyRetur: number; qtyReject: number; hargaTitip: number }
interface RecapItemInput { productId: string; productName: string; qtySold: number; qtyRetur: number; qtyReject?: number }

// Tandai Lunas — pendapatan konsinyasi dibaca langsung dari totalRevenue rekap ini di Laporan
// Keuangan, jadi menandai lunas cukup flip status (tidak perlu bikin dokumen tambahan).
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'consignment', 'edit');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const data = await req.json().catch(() => ({})) as { walletId?: string | null };
  const db = getDb();
  const recapRef = db.collection('consignmentRecaps').doc(id);
  const beforeSnap = await recapRef.get();
  const before = beforeSnap.exists ? beforeSnap.data() ?? null : null;
  const payload = {
    paymentStatus: 'lunas',
    walletId: data.walletId ?? null,
    updatedAt: FieldValue.serverTimestamp(),
  };
  await recapRef.update(payload);
  try {
    await logHistory(db, {
      entity: 'consignment',
      entityCollection: 'consignmentRecaps',
      entityId: id,
      entityLabel: (before?.locationName as string | undefined) || id,
      action: 'update',
      actor: guard,
      before,
      after: { ...before, ...payload },
    });
  } catch {}
  return Response.json({ ok: true });
}

interface FullSnapshot { table: 'products' | 'consignment_stock' | 'warehouse_stock'; key: string; oldValues: Record<string, unknown> }

async function compensateFullSnapshots(sql: ReturnType<typeof getSql>, snapshots: FullSnapshot[]) {
  await sql.begin(async pgTx => {
    for (const s of snapshots) {
      if (s.table === 'products') {
        await pgTx`update products set stock_qty = ${s.oldValues.stockQty as number}, stock = ${s.oldValues.stock as string}, updated_at = now() where id = ${s.key}`;
      } else if (s.table === 'consignment_stock') {
        await pgTx`update consignment_stock set stock_qty = ${s.oldValues.stockQty as number}, updated_at = now() where id = ${s.key}`;
      } else {
        await pgTx`update warehouse_stock set stock_qty = ${s.oldValues.stockQty as number}, updated_at = now() where id = ${s.key}`;
      }
    }
  });
}

// Hapus riwayat rekap — mengembalikan stok titip di lokasi, dan membalik stok gudang/produk
// yang sudah ditambah dari retur. Ditolak jika stok retur tersebut sudah terpakai lebih lanjut.
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'consignment', 'delete');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const db = getDb();
  const sql = getSql();
  const recapRef = db.collection('consignmentRecaps').doc(id);

  const recapSnap = await recapRef.get();
  if (!recapSnap.exists) return Response.json({ error: 'Riwayat rekap tidak ditemukan.' }, { status: 404 });
  const recapFull = recapSnap.data();
  const recap = recapSnap.data()! as { locationId: string; warehouseId?: string; items: RecapItem[] };
  const items = recap.items ?? [];
  const returItems = items.filter(it => it.qtyRetur > 0);
  const stockTouched = returItems.length > 0;

  const snapshots: FullSnapshot[] = [];
  try {
    await sql.begin(async pgTx => {
      const stockKeys = items.map(it => `${recap.locationId}_${it.productId}`);
      const productIds = returItems.map(it => it.productId);
      const wsKeys = returItems.map(it => `${recap.warehouseId}_${it.productId}`);

      const [stockRows, productRows, wsRows] = await Promise.all([
        stockKeys.length > 0 ? pgTx<{ id: string; stock_qty: string }[]>`select id, stock_qty from consignment_stock where id in ${pgTx(stockKeys)} order by id for update` : [],
        productIds.length > 0 ? pgTx<{ id: string; stock_qty: string; open_po: boolean }[]>`select id, stock_qty, open_po from products where id in ${pgTx(productIds)} order by id for update` : [],
        wsKeys.length > 0 ? pgTx<{ id: string; stock_qty: string }[]>`select id, stock_qty from warehouse_stock where id in ${pgTx(wsKeys)} order by id for update` : [],
      ]);
      const stockById = new Map(stockRows.map(r => [r.id, r]));
      const productById = new Map(productRows.map(r => [r.id, r]));
      const wsById = new Map(wsRows.map(r => [r.id, r]));

      const shortages: string[] = [];
      returItems.forEach((it, i) => {
        const productQty = Number(productById.get(productIds[i])?.stock_qty) || 0;
        if (productQty < it.qtyRetur) shortages.push(`${it.productName} (stok toko tersisa ${productQty}, retur ${it.qtyRetur})`);
        const wsQty = Number(wsById.get(wsKeys[i])?.stock_qty) || 0;
        if (wsQty < it.qtyRetur) shortages.push(`${it.productName} (stok gudang tujuan tersisa ${wsQty}, retur ${it.qtyRetur})`);
      });
      if (shortages.length > 0) {
        throw new Error(`Tidak bisa menghapus — stok retur dari rekap ini sudah terpakai: ${shortages.join(', ')}`);
      }

      for (const [i, it] of items.entries()) {
        const key = stockKeys[i];
        const row = stockById.get(key);
        const restore = it.qtySold + it.qtyRetur + it.qtyReject;
        const oldQty = row ? Number(row.stock_qty) || 0 : 0;
        snapshots.push({ table: 'consignment_stock', key, oldValues: { stockQty: oldQty } });
        await pgTx`
          insert into consignment_stock (id, location_id, product_id, product_name, stock_qty, harga_titip, updated_at)
          values (${key}, ${recap.locationId}, ${it.productId}, ${it.productName}, ${oldQty + restore}, ${it.hargaTitip ?? 0}, now())
          on conflict (id) do update set stock_qty = ${oldQty + restore}, updated_at = now()
        `;
      }

      for (const [i, it] of returItems.entries()) {
        const productRow = productById.get(productIds[i]);
        if (productRow) {
          const oldQty = Number(productRow.stock_qty) || 0;
          snapshots.push({ table: 'products', key: it.productId, oldValues: { stockQty: oldQty, stock: stockLabel(productRow.open_po, oldQty) } });
          const newQty = oldQty - it.qtyRetur;
          await pgTx`update products set stock_qty = ${newQty}, stock = ${stockLabel(productRow.open_po, newQty)}, updated_at = now() where id = ${it.productId}`;
        }
        const wsKey = wsKeys[i];
        const wsRow = wsById.get(wsKey);
        if (wsRow) {
          const oldQty = Number(wsRow.stock_qty) || 0;
          snapshots.push({ table: 'warehouse_stock', key: wsKey, oldValues: { stockQty: oldQty } });
          await pgTx`update warehouse_stock set stock_qty = ${oldQty - it.qtyRetur}, updated_at = now() where id = ${wsKey}`;
        }
      }
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal menghapus riwayat rekap.' }, { status: 400 });
  }

  try {
    await db.runTransaction(async tx => {
      const freshSnap = await tx.get(recapRef);
      tx.delete(recapRef);
      writeHistoryEntry(tx, db, {
        entity: 'consignment',
        entityCollection: 'consignmentRecaps',
        entityId: id,
        entityLabel: (recapFull?.locationName as string | undefined) || id,
        action: 'delete',
        actor: guard,
        before: freshSnap.exists ? freshSnap.data() ?? null : (recapFull ?? null),
      });
    });
  } catch (err) {
    try { await compensateFullSnapshots(sql, snapshots); }
    catch (compErr) { console.error('CRITICAL: gagal kompensasi stok setelah hapus rekap konsinyasi gagal tersimpan', compErr); }
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal menghapus riwayat rekap.' }, { status: 400 });
  }

  if (stockTouched) after(() => revalidateStorefront('products'));
  // Menghapus rekap mengubah total totalSold yang dijumlah di beranda storefront.
  after(() => revalidateStorefront('stats'));
  return Response.json({ ok: true });
}

// Edit riwayat rekap — membalik efek stok yang lama (stok titip & retur/reject ke gudang),
// lalu menerapkan efek stok yang baru dalam satu transaksi. Log gudang lama untuk retur/reject
// dibiarkan sebagai riwayat historis; edit yang menghasilkan retur/reject baru dicatat sebagai log baru.
export async function PUT(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'consignment', 'edit');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const data = await req.json() as {
    locationId: string; locationName: string; note?: string; items: RecapItemInput[];
    paymentStatus?: 'lunas' | 'belum_lunas'; walletId?: string | null;
    warehouseId?: string; warehouseName?: string; date?: string; dueDate?: string;
  };
  const newItems = (data.items ?? [])
    .map(it => ({ ...it, qtyReject: it.qtyReject ?? 0 }))
    .filter(it => it.qtySold > 0 || it.qtyRetur > 0 || it.qtyReject > 0);
  if (newItems.length === 0) return Response.json({ error: 'Isi minimal 1 produk dengan qty terjual, retur, atau reject.' }, { status: 400 });
  const paymentStatus = data.paymentStatus === 'belum_lunas' ? 'belum_lunas' : 'lunas';
  const newHasReturnOrReject = newItems.some(it => it.qtyRetur > 0 || it.qtyReject > 0);
  if (newHasReturnOrReject && !data.warehouseId) {
    return Response.json({ error: 'Pilih gudang tujuan untuk retur/reject.' }, { status: 400 });
  }

  const db = getDb();
  const sql = getSql();
  const recapRef = db.collection('consignmentRecaps').doc(id);

  const recapSnap = await recapRef.get();
  if (!recapSnap.exists) return Response.json({ error: 'Riwayat rekap tidak ditemukan.' }, { status: 404 });
  const oldRecapFull = recapSnap.data();
  const oldRecap = recapSnap.data()! as { locationId: string; warehouseId?: string; items: RecapItem[] };
  const oldItems = oldRecap.items ?? [];
  const oldReturItems = oldItems.filter(it => it.qtyRetur > 0);
  const newReturItems = newItems.filter(it => it.qtyRetur > 0);

  const productIds = [...new Set([...oldReturItems.map(it => it.productId), ...newReturItems.map(it => it.productId)])];
  const stockTouched = productIds.length > 0;

  const stockMeta = new Map<string, { locationId: string; productId: string; productName: string }>();
  oldItems.forEach(it => {
    const key = `${oldRecap.locationId}_${it.productId}`;
    if (!stockMeta.has(key)) stockMeta.set(key, { locationId: oldRecap.locationId, productId: it.productId, productName: it.productName });
  });
  newItems.forEach(it => {
    const key = `${data.locationId}_${it.productId}`;
    if (!stockMeta.has(key)) stockMeta.set(key, { locationId: data.locationId, productId: it.productId, productName: it.productName });
  });
  const stockKeys = [...stockMeta.keys()];

  const wsMeta = new Map<string, { warehouseId: string; productId: string; productName: string }>();
  oldReturItems.forEach(it => {
    const key = `${oldRecap.warehouseId}_${it.productId}`;
    if (!wsMeta.has(key)) wsMeta.set(key, { warehouseId: oldRecap.warehouseId ?? '', productId: it.productId, productName: it.productName });
  });
  newReturItems.forEach(it => {
    const key = `${data.warehouseId}_${it.productId}`;
    if (!wsMeta.has(key)) wsMeta.set(key, { warehouseId: data.warehouseId ?? '', productId: it.productId, productName: it.productName });
  });
  const wsKeys = [...wsMeta.keys()];

  interface RecapItemComputed extends RecapItemInput { hargaTitip: number; revenue: number }
  let recapItems: RecapItemComputed[] = [];
  let totalSold = 0, totalRetur = 0, totalReject = 0, totalRevenue = 0;
  const snapshots: FullSnapshot[] = [];

  try {
    await sql.begin(async pgTx => {
      const [productRows, stockRows, wsRows] = await Promise.all([
        productIds.length > 0 ? pgTx<{ id: string; stock_qty: string; open_po: boolean }[]>`select id, stock_qty, open_po from products where id in ${pgTx(productIds)} order by id for update` : [],
        stockKeys.length > 0 ? pgTx<{ id: string; stock_qty: string; harga_titip: string | null }[]>`select id, stock_qty, harga_titip from consignment_stock where id in ${pgTx(stockKeys)} order by id for update` : [],
        wsKeys.length > 0 ? pgTx<{ id: string; stock_qty: string }[]>`select id, stock_qty from warehouse_stock where id in ${pgTx(wsKeys)} order by id for update` : [],
      ]);
      const productById = new Map(productRows.map(r => [r.id, r]));
      const stockById = new Map(stockRows.map(r => [r.id, r]));
      const wsById = new Map(wsRows.map(r => [r.id, r]));

      const productState = new Map(productIds.map(pid => {
        const row = productById.get(pid);
        return [pid, { exists: !!row, stockQty: row ? Number(row.stock_qty) || 0 : 0, openPO: row?.open_po ?? false }];
      }));
      const stockState = new Map(stockKeys.map(k => {
        const row = stockById.get(k);
        return [k, { stockQty: row ? Number(row.stock_qty) || 0 : 0, hargaTitip: row?.harga_titip != null ? Number(row.harga_titip) : 0 }];
      }));
      const wsState = new Map(wsKeys.map(k => {
        const row = wsById.get(k);
        return [k, { stockQty: row ? Number(row.stock_qty) || 0 : 0 }];
      }));

      // Snapshot sebelum diubah — untuk kompensasi kalau langkah Firestore setelahnya gagal.
      productIds.forEach(pid => {
        const st = productState.get(pid)!;
        snapshots.push({ table: 'products', key: pid, oldValues: { stockQty: st.stockQty, stock: stockLabel(st.openPO, st.stockQty) } });
      });
      stockKeys.forEach(k => snapshots.push({ table: 'consignment_stock', key: k, oldValues: { stockQty: stockState.get(k)!.stockQty } }));
      wsKeys.forEach(k => snapshots.push({ table: 'warehouse_stock', key: k, oldValues: { stockQty: wsState.get(k)!.stockQty } }));

      // 1) Balik efek rekap lama
      oldItems.forEach(it => {
        const key = `${oldRecap.locationId}_${it.productId}`;
        const s = stockState.get(key)!;
        s.stockQty += it.qtySold + it.qtyRetur + it.qtyReject;
      });
      oldReturItems.forEach(it => {
        const p = productState.get(it.productId)!;
        if (p.stockQty < it.qtyRetur) throw new Error(`Tidak bisa mengubah — stok retur dari rekap lama sudah terpakai: ${it.productName}.`);
        p.stockQty -= it.qtyRetur;
        const ws = wsState.get(`${oldRecap.warehouseId}_${it.productId}`)!;
        if (ws.stockQty < it.qtyRetur) throw new Error(`Tidak bisa mengubah — stok gudang dari retur rekap lama sudah terpakai: ${it.productName}.`);
        ws.stockQty -= it.qtyRetur;
      });

      // 2) Validasi & terapkan rekap baru — qty diminta digabung dulu per produk (per lokasi_produk)
      // supaya baris ganda untuk produk yang sama tidak lolos validasi ganda dari angka stok awal
      // yang sama, yang baru jadi minus saat masing-masing baris diterapkan berurutan.
      const requestedByKey = new Map<string, number>();
      newItems.forEach(it => {
        const key = `${data.locationId}_${it.productId}`;
        requestedByKey.set(key, (requestedByKey.get(key) ?? 0) + it.qtySold + it.qtyRetur + it.qtyReject);
      });

      const shortages: string[] = [];
      requestedByKey.forEach((requested, key) => {
        const s = stockState.get(key)!;
        if (s.stockQty < requested) shortages.push(`${stockMeta.get(key)!.productName} (stok di lokasi ${s.stockQty}, diminta ${requested})`);
      });
      if (shortages.length > 0) throw new Error(`Qty melebihi stok di lokasi: ${shortages.join(', ')}`);

      recapItems = newItems.map(it => {
        const s = stockState.get(`${data.locationId}_${it.productId}`)!;
        const hargaTitip = s.hargaTitip;
        s.stockQty -= (it.qtySold + it.qtyRetur + it.qtyReject);
        return { ...it, hargaTitip, revenue: it.qtySold * hargaTitip };
      });
      totalSold    = recapItems.reduce((s, it) => s + it.qtySold, 0);
      totalRetur   = recapItems.reduce((s, it) => s + it.qtyRetur, 0);
      totalReject  = recapItems.reduce((s, it) => s + (it.qtyReject ?? 0), 0);
      totalRevenue = recapItems.reduce((s, it) => s + it.revenue, 0);

      newReturItems.forEach(it => {
        const p = productState.get(it.productId)!;
        p.stockQty += it.qtyRetur;
        const ws = wsState.get(`${data.warehouseId}_${it.productId}`)!;
        ws.stockQty += it.qtyRetur;
      });

      // 3) Tulis ulang state produk, stok titip & stok gudang
      for (const pid of productIds) {
        const p = productState.get(pid)!;
        if (!p.exists) continue;
        // Math.max(0, ...) — jaring pengaman terakhir, seharusnya tidak pernah terpakai kalau validasi
        // di atas benar, tapi mencegah stok minus tersimpan kalau ada celah lain yang belum ketahuan.
        const qty = Math.max(0, p.stockQty);
        await pgTx`update products set stock_qty = ${qty}, stock = ${stockLabel(p.openPO, qty)}, updated_at = now() where id = ${pid}`;
      }
      for (const key of stockKeys) {
        const meta = stockMeta.get(key)!;
        const s = stockState.get(key)!;
        await pgTx`
          insert into consignment_stock (id, location_id, product_id, product_name, stock_qty, harga_titip, updated_at)
          values (${key}, ${meta.locationId}, ${meta.productId}, ${meta.productName}, ${s.stockQty}, ${s.hargaTitip}, now())
          on conflict (id) do update set stock_qty = ${s.stockQty}, updated_at = now()
        `;
      }
      for (const key of wsKeys) {
        const meta = wsMeta.get(key)!;
        const ws = wsState.get(key)!;
        await pgTx`
          insert into warehouse_stock (id, warehouse_id, product_id, product_name, stock_qty, updated_at)
          values (${key}, ${meta.warehouseId}, ${meta.productId}, ${meta.productName}, ${ws.stockQty}, now())
          on conflict (id) do update set stock_qty = ${ws.stockQty}, product_name = excluded.product_name, updated_at = now()
        `;
      }

      // Log gudang baru untuk retur/reject hasil edit — log lama dari rekap sebelum diedit
      // dibiarkan sebagai riwayat historis (tidak dihapus/diubah).
      for (const it of newReturItems) {
        await writeStockLedgerEntryPg(pgTx, {
          productId: it.productId, productName: it.productName, warehouseId: data.warehouseId, warehouseName: data.warehouseName,
          type: 'in', qty: it.qtyRetur, note: `Retur konsinyasi (diedit) – ${data.locationName}${data.note ? `: ${data.note}` : ''}`,
        });
      }
      for (const it of newItems.filter(it => (it.qtyReject ?? 0) > 0)) {
        await writeStockLedgerEntryPg(pgTx, {
          productId: it.productId, productName: it.productName, warehouseId: data.warehouseId, warehouseName: data.warehouseName,
          type: 'reject', qty: it.qtyReject ?? 0, note: `Reject konsinyasi (diedit) – ${data.locationName}${data.note ? `: ${data.note}` : ''}`,
        });
      }
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal mengubah rekap.' }, { status: 400 });
  }

  try {
    await db.runTransaction(async tx => {
      const updatePayload = {
        locationId: data.locationId, locationName: data.locationName,
        items: recapItems, totalSold, totalRetur, totalReject, totalRevenue,
        paymentStatus,
        warehouseId: data.warehouseId ?? '', warehouseName: data.warehouseName ?? '',
        note: data.note ?? '',
        walletId: data.walletId ?? null,
        ...(data.date ? { createdAt: Timestamp.fromDate(new Date(data.date)) } : {}),
        dueDate: data.dueDate ? Timestamp.fromDate(new Date(data.dueDate)) : null,
        overdueNotifiedAt: null, // reset flag idempoten — biar bisa dinotifikasi ulang kalau dueDate/status berubah
        updatedAt: FieldValue.serverTimestamp(),
      };
      tx.update(recapRef, updatePayload);

      writeHistoryEntry(tx, db, {
        entity: 'consignment',
        entityCollection: 'consignmentRecaps',
        entityId: id,
        entityLabel: `${data.locationName ?? oldRecapFull?.locationName ?? id}${data.date ? ` - ${data.date}` : ''}`,
        action: 'update',
        actor: guard,
        before: oldRecapFull ?? null,
        after: { ...oldRecapFull, ...updatePayload },
      });
    });
  } catch (err) {
    try { await compensateFullSnapshots(sql, snapshots); }
    catch (compErr) { console.error('CRITICAL: gagal kompensasi stok setelah edit rekap konsinyasi gagal tersimpan', compErr); }
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal mengubah rekap.' }, { status: 400 });
  }

  if (stockTouched) after(() => revalidateStorefront('products'));
  // Edit rekap menghitung ulang totalSold yang dijumlah di beranda storefront.
  after(() => revalidateStorefront('stats'));
  return Response.json({ ok: true });
}
