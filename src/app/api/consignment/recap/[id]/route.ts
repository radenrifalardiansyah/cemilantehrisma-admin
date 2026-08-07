import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { validateAdminAuth, unauthorized } from '@/lib/admin-auth';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';

type Ctx = { params: Promise<{ id: string }> };
interface RecapItem { productId: string; productName: string; qtySold: number; qtyRetur: number; qtyReject: number; hargaTitip: number }
interface RecapItemInput { productId: string; productName: string; qtySold: number; qtyRetur: number; qtyReject?: number }

// Tandai Lunas — pendapatan konsinyasi dibaca langsung dari totalRevenue rekap ini di Laporan
// Keuangan, jadi menandai lunas cukup flip status (tidak perlu bikin dokumen tambahan).
export async function PATCH(req: NextRequest, ctx: Ctx) {
  if (!validateAdminAuth(req)) return unauthorized();
  const { id } = await ctx.params;
  await getDb().collection('consignmentRecaps').doc(id).update({
    paymentStatus: 'lunas',
    updatedAt: FieldValue.serverTimestamp(),
  });
  return Response.json({ ok: true });
}

// Hapus riwayat rekap — mengembalikan stok titip di lokasi, dan membalik stok gudang/produk
// yang sudah ditambah dari retur. Ditolak jika stok retur tersebut sudah terpakai lebih lanjut.
export async function DELETE(req: NextRequest, ctx: Ctx) {
  if (!validateAdminAuth(req)) return unauthorized();
  const { id } = await ctx.params;
  const db = getDb();
  const recapRef = db.collection('consignmentRecaps').doc(id);

  try {
    await db.runTransaction(async tx => {
      const recapSnap = await tx.get(recapRef);
      if (!recapSnap.exists) throw new Error('Riwayat rekap tidak ditemukan.');
      const recap = recapSnap.data()! as { locationId: string; warehouseId?: string; items: RecapItem[] };
      const items = recap.items ?? [];
      const returItems = items.filter(it => it.qtyRetur > 0);

      const stockRefs   = items.map(it => db.collection('consignmentStock').doc(`${recap.locationId}_${it.productId}`));
      const productRefs = returItems.map(it => db.collection('products').doc(it.productId));
      const wsRefs       = returItems.map(it => db.collection('warehouse_stock').doc(`${recap.warehouseId}_${it.productId}`));

      const [stockSnaps, productSnaps, wsSnaps] = await Promise.all([
        Promise.all(stockRefs.map(r => tx.get(r))),
        Promise.all(productRefs.map(r => tx.get(r))),
        Promise.all(wsRefs.map(r => tx.get(r))),
      ]);

      const shortages: string[] = [];
      returItems.forEach((it, i) => {
        const productQty = productSnaps[i].exists ? Number(productSnaps[i].data()!.stockQty) || 0 : 0;
        if (productQty < it.qtyRetur) shortages.push(`${it.productName} (stok toko tersisa ${productQty}, retur ${it.qtyRetur})`);
        const wsQty = wsSnaps[i].exists ? Number(wsSnaps[i].data()!.stockQty) || 0 : 0;
        if (wsQty < it.qtyRetur) shortages.push(`${it.productName} (stok gudang tujuan tersisa ${wsQty}, retur ${it.qtyRetur})`);
      });
      if (shortages.length > 0) {
        throw new Error(`Tidak bisa menghapus — stok retur dari rekap ini sudah terpakai: ${shortages.join(', ')}`);
      }

      items.forEach((it, i) => {
        const restore = it.qtySold + it.qtyRetur + it.qtyReject;
        if (stockSnaps[i].exists) {
          const stockQty = Number(stockSnaps[i].data()!.stockQty) || 0;
          tx.update(stockRefs[i], { stockQty: stockQty + restore, updatedAt: FieldValue.serverTimestamp() });
        } else {
          tx.set(stockRefs[i], {
            locationId: recap.locationId, productId: it.productId, productName: it.productName,
            stockQty: restore, hargaTitip: it.hargaTitip ?? 0, updatedAt: FieldValue.serverTimestamp(),
          });
        }
      });

      returItems.forEach((it, i) => {
        if (productSnaps[i].exists) {
          const product = productSnaps[i].data()!;
          const newQty = (Number(product.stockQty) || 0) - it.qtyRetur;
          tx.update(productRefs[i], {
            stockQty: newQty,
            stock: product.openPO ? 'open_po' : newQty > 0 ? 'ready' : 'habis',
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
        if (wsSnaps[i].exists) {
          const wsQty = Number(wsSnaps[i].data()!.stockQty) || 0;
          tx.update(wsRefs[i], { stockQty: wsQty - it.qtyRetur, updatedAt: FieldValue.serverTimestamp() });
        }
      });

      tx.delete(recapRef);
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal menghapus riwayat rekap.' }, { status: 400 });
  }

  return Response.json({ ok: true });
}

// Edit riwayat rekap — membalik efek stok yang lama (stok titip & retur/reject ke gudang),
// lalu menerapkan efek stok yang baru dalam satu transaksi. Log gudang lama untuk retur/reject
// dibiarkan sebagai riwayat historis; edit yang menghasilkan retur/reject baru dicatat sebagai log baru.
export async function PUT(req: NextRequest, ctx: Ctx) {
  if (!validateAdminAuth(req)) return unauthorized();
  const { id } = await ctx.params;
  const data = await req.json() as {
    locationId: string; locationName: string; note?: string; items: RecapItemInput[];
    paymentStatus?: 'lunas' | 'belum_lunas';
    warehouseId?: string; warehouseName?: string; date?: string;
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
  const recapRef = db.collection('consignmentRecaps').doc(id);

  try {
    await db.runTransaction(async tx => {
      const recapSnap = await tx.get(recapRef);
      if (!recapSnap.exists) throw new Error('Riwayat rekap tidak ditemukan.');
      const oldRecap = recapSnap.data()! as { locationId: string; warehouseId?: string; items: RecapItem[] };
      const oldItems = oldRecap.items ?? [];
      const oldReturItems = oldItems.filter(it => it.qtyRetur > 0);
      const newReturItems = newItems.filter(it => it.qtyRetur > 0);

      const productIds = [...new Set([...oldReturItems.map(it => it.productId), ...newReturItems.map(it => it.productId)])];

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

      const productRefs = productIds.map(pid => db.collection('products').doc(pid));
      const stockRefs   = stockKeys.map(k => db.collection('consignmentStock').doc(k));
      const wsRefs       = wsKeys.map(k => db.collection('warehouse_stock').doc(k));

      const [productSnaps, stockSnaps, wsSnaps] = await Promise.all([
        Promise.all(productRefs.map(r => tx.get(r))),
        Promise.all(stockRefs.map(r => tx.get(r))),
        Promise.all(wsRefs.map(r => tx.get(r))),
      ]);

      const productState = new Map(productIds.map((pid, i) => [pid, {
        exists: productSnaps[i].exists,
        stockQty: productSnaps[i].exists ? Number(productSnaps[i].data()!.stockQty) || 0 : 0,
        openPO: productSnaps[i].exists ? !!productSnaps[i].data()!.openPO : false,
      }]));
      const stockState = new Map(stockKeys.map((k, i) => [k, {
        stockQty: stockSnaps[i].exists ? Number(stockSnaps[i].data()!.stockQty) || 0 : 0,
        hargaTitip: stockSnaps[i].exists ? Number(stockSnaps[i].data()!.hargaTitip) || 0 : 0,
      }]));
      const wsState = new Map(wsKeys.map((k, i) => [k, {
        stockQty: wsSnaps[i].exists ? Number(wsSnaps[i].data()!.stockQty) || 0 : 0,
      }]));

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

      const recapItems = newItems.map(it => {
        const s = stockState.get(`${data.locationId}_${it.productId}`)!;
        const hargaTitip = s.hargaTitip;
        s.stockQty -= (it.qtySold + it.qtyRetur + it.qtyReject);
        return { ...it, hargaTitip, revenue: it.qtySold * hargaTitip };
      });
      const totalSold    = recapItems.reduce((s, it) => s + it.qtySold, 0);
      const totalRetur   = recapItems.reduce((s, it) => s + it.qtyRetur, 0);
      const totalReject  = recapItems.reduce((s, it) => s + it.qtyReject, 0);
      const totalRevenue = recapItems.reduce((s, it) => s + it.revenue, 0);

      newReturItems.forEach(it => {
        const p = productState.get(it.productId)!;
        p.stockQty += it.qtyRetur;
        const ws = wsState.get(`${data.warehouseId}_${it.productId}`)!;
        ws.stockQty += it.qtyRetur;
      });

      // 3) Tulis ulang state produk, stok titip & stok gudang
      productIds.forEach(pid => {
        const p = productState.get(pid)!;
        if (!p.exists) return;
        // Math.max(0, ...) — jaring pengaman terakhir, seharusnya tidak pernah terpakai kalau validasi
        // di atas benar, tapi mencegah stok minus tersimpan kalau ada celah lain yang belum ketahuan.
        tx.update(db.collection('products').doc(pid), {
          stockQty: Math.max(0, p.stockQty),
          stock: p.openPO ? 'open_po' : p.stockQty > 0 ? 'ready' : 'habis',
          updatedAt: FieldValue.serverTimestamp(),
        });
      });
      stockKeys.forEach(key => {
        const meta = stockMeta.get(key)!;
        const s = stockState.get(key)!;
        tx.set(db.collection('consignmentStock').doc(key), {
          locationId: meta.locationId, productId: meta.productId, productName: meta.productName,
          stockQty: s.stockQty, hargaTitip: s.hargaTitip, updatedAt: FieldValue.serverTimestamp(),
        });
      });
      wsKeys.forEach(key => {
        const meta = wsMeta.get(key)!;
        const ws = wsState.get(key)!;
        tx.set(db.collection('warehouse_stock').doc(key), {
          warehouseId: meta.warehouseId, productId: meta.productId, productName: meta.productName,
          stockQty: ws.stockQty, updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      });

      // Log gudang baru untuk retur/reject hasil edit — log lama dari rekap sebelum diedit
      // dibiarkan sebagai riwayat historis (tidak dihapus/diubah).
      newReturItems.forEach(it => {
        const logRef = db.collection('stock').doc();
        tx.set(logRef, {
          warehouseId: data.warehouseId, warehouseName: data.warehouseName ?? '',
          productId: it.productId, productName: it.productName,
          type: 'in', qty: it.qtyRetur,
          note: `Retur konsinyasi (diedit) – ${data.locationName}${data.note ? `: ${data.note}` : ''}`,
          createdAt: FieldValue.serverTimestamp(),
        });
      });
      newItems.filter(it => it.qtyReject > 0).forEach(it => {
        const logRef = db.collection('stock').doc();
        tx.set(logRef, {
          warehouseId: data.warehouseId ?? '', warehouseName: data.warehouseName ?? '',
          productId: it.productId, productName: it.productName,
          type: 'reject', qty: it.qtyReject,
          note: `Reject konsinyasi (diedit) – ${data.locationName}${data.note ? `: ${data.note}` : ''}`,
          createdAt: FieldValue.serverTimestamp(),
        });
      });

      tx.update(recapRef, {
        locationId: data.locationId, locationName: data.locationName,
        items: recapItems, totalSold, totalRetur, totalReject, totalRevenue,
        paymentStatus,
        warehouseId: data.warehouseId ?? '', warehouseName: data.warehouseName ?? '',
        note: data.note ?? '',
        ...(data.date ? { createdAt: Timestamp.fromDate(new Date(`${data.date}T12:00:00`)) } : {}),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal mengubah rekap.' }, { status: 400 });
  }

  return Response.json({ ok: true });
}
