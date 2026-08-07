import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { validateAdminAuth, unauthorized } from '@/lib/admin-auth';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';

type Ctx = { params: Promise<{ id: string }> };
interface ShipmentItem { productId: string; productName: string; qty: number }
interface SendItemInput { productId: string; productName: string; qty: number; hargaTitip: number }

// Hapus riwayat kirim — mengembalikan stok toko & stok gudang asal, dan mengurangi stok titip di lokasi.
// Ditolak jika stok titip sudah terpakai (terjual/direkap) sehingga tidak cukup untuk dibalik.
export async function DELETE(req: NextRequest, ctx: Ctx) {
  if (!validateAdminAuth(req)) return unauthorized();
  const { id } = await ctx.params;
  const db = getDb();
  const shipmentRef = db.collection('consignmentShipments').doc(id);

  try {
    await db.runTransaction(async tx => {
      const shipmentSnap = await tx.get(shipmentRef);
      if (!shipmentSnap.exists) throw new Error('Riwayat kirim tidak ditemukan.');
      const shipment = shipmentSnap.data()! as { locationId: string; warehouseId?: string; items: ShipmentItem[] };
      const items = shipment.items ?? [];

      const productRefs = items.map(it => db.collection('products').doc(it.productId));
      const stockRefs   = items.map(it => db.collection('consignmentStock').doc(`${shipment.locationId}_${it.productId}`));
      const [productSnaps, stockSnaps] = await Promise.all([
        Promise.all(productRefs.map(r => tx.get(r))),
        Promise.all(stockRefs.map(r => tx.get(r))),
      ]);

      const shortages: string[] = [];
      items.forEach((it, i) => {
        const stockQty = stockSnaps[i].exists ? Number(stockSnaps[i].data()!.stockQty) || 0 : 0;
        if (stockQty < it.qty) shortages.push(`${it.productName} (stok titip tersisa ${stockQty}, butuh ${it.qty})`);
      });
      if (shortages.length > 0) {
        throw new Error(`Tidak bisa menghapus — sebagian stok kiriman ini sudah terjual/direkap: ${shortages.join(', ')}`);
      }

      items.forEach((it, i) => {
        if (productSnaps[i].exists) {
          const product = productSnaps[i].data()!;
          const newQty = (Number(product.stockQty) || 0) + it.qty;
          tx.update(productRefs[i], {
            stockQty: newQty,
            stock: product.openPO ? 'open_po' : newQty > 0 ? 'ready' : 'habis',
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
        const stockQty = Number(stockSnaps[i].data()!.stockQty) || 0;
        tx.update(stockRefs[i], { stockQty: stockQty - it.qty, updatedAt: FieldValue.serverTimestamp() });

        // Kiriman lama (sebelum fitur gudang asal) tidak pernah mengurangi warehouse_stock — jangan dibalik.
        if (shipment.warehouseId) {
          tx.set(db.collection('warehouse_stock').doc(`${shipment.warehouseId}_${it.productId}`), {
            warehouseId: shipment.warehouseId, productId: it.productId, productName: it.productName,
            stockQty: FieldValue.increment(it.qty), updatedAt: FieldValue.serverTimestamp(),
          }, { merge: true });
        }
      });

      tx.delete(shipmentRef);
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal menghapus riwayat kirim.' }, { status: 400 });
  }

  return Response.json({ ok: true });
}

// Edit riwayat kirim — membalik efek stok yang lama (termasuk stok gudang asal lama, jika ada),
// lalu menerapkan efek stok yang baru dalam satu transaksi. Ditolak jika stok lama sudah terpakai
// atau stok toko tidak cukup. Log gudang lama dibiarkan sebagai riwayat historis.
export async function PUT(req: NextRequest, ctx: Ctx) {
  if (!validateAdminAuth(req)) return unauthorized();
  const { id } = await ctx.params;
  const data = await req.json() as {
    locationId: string; locationName: string; warehouseId: string; warehouseName?: string;
    note?: string; items: SendItemInput[]; date?: string;
  };
  const newItems = data.items ?? [];
  if (newItems.length === 0) return Response.json({ error: 'Minimal 1 produk dikirim.' }, { status: 400 });
  if (!data.warehouseId) return Response.json({ error: 'Pilih gudang asal pengiriman.' }, { status: 400 });

  const db = getDb();
  const shipmentRef = db.collection('consignmentShipments').doc(id);

  try {
    await db.runTransaction(async tx => {
      const shipmentSnap = await tx.get(shipmentRef);
      if (!shipmentSnap.exists) throw new Error('Riwayat kirim tidak ditemukan.');
      const oldShipment = shipmentSnap.data()! as { locationId: string; warehouseId?: string; items: ShipmentItem[] };
      const oldItems = oldShipment.items ?? [];

      const productIds = [...new Set([...oldItems.map(it => it.productId), ...newItems.map(it => it.productId)])];
      const productNameByPid = new Map<string, string>();
      [...oldItems, ...newItems].forEach(it => { if (!productNameByPid.has(it.productId)) productNameByPid.set(it.productId, it.productName); });

      const stockMeta = new Map<string, { locationId: string; productId: string; productName: string }>();
      oldItems.forEach(it => {
        const key = `${oldShipment.locationId}_${it.productId}`;
        if (!stockMeta.has(key)) stockMeta.set(key, { locationId: oldShipment.locationId, productId: it.productId, productName: it.productName });
      });
      newItems.forEach(it => {
        const key = `${data.locationId}_${it.productId}`;
        if (!stockMeta.has(key)) stockMeta.set(key, { locationId: data.locationId, productId: it.productId, productName: it.productName });
      });
      const stockKeys = [...stockMeta.keys()];

      const productRefs = productIds.map(pid => db.collection('products').doc(pid));
      const stockRefs   = stockKeys.map(k => db.collection('consignmentStock').doc(k));
      const [productSnaps, stockSnaps] = await Promise.all([
        Promise.all(productRefs.map(r => tx.get(r))),
        Promise.all(stockRefs.map(r => tx.get(r))),
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
      // key = doc id `${warehouseId}_${productId}` — kept alongside the parsed pair so we never
      // have to split it back apart (warehouse/product IDs could theoretically contain '_').
      const wsDelta = new Map<string, { warehouseId: string; productId: string; delta: number }>();
      const bumpWs = (warehouseId: string, productId: string, delta: number) => {
        const key = `${warehouseId}_${productId}`;
        const cur = wsDelta.get(key);
        if (cur) cur.delta += delta;
        else wsDelta.set(key, { warehouseId, productId, delta });
      };

      // 1) Balik efek kiriman lama
      for (const it of oldItems) {
        const key = `${oldShipment.locationId}_${it.productId}`;
        const s = stockState.get(key)!;
        if (s.stockQty < it.qty) {
          throw new Error(`Tidak bisa mengubah — sebagian stok kiriman lama sudah terjual/direkap: ${it.productName}.`);
        }
        s.stockQty -= it.qty;
        const p = productState.get(it.productId)!;
        p.stockQty += it.qty;

        // Kiriman lama (sebelum fitur gudang asal) tidak pernah mengurangi warehouse_stock — jangan dibalik.
        if (oldShipment.warehouseId) bumpWs(oldShipment.warehouseId, it.productId, it.qty);
      }

      // 2) Validasi & terapkan kiriman baru — qty digabung dulu per produk supaya baris ganda untuk
      // produk yang sama di form yang sama ikut terhitung (sebelumnya divalidasi terpisah dari angka
      // stok awal yang sama, jadi bisa lolos validasi tapi jadi minus saat diterapkan berturut-turut).
      const newQtyByProduct = new Map<string, number>();
      newItems.forEach(it => newQtyByProduct.set(it.productId, (newQtyByProduct.get(it.productId) ?? 0) + it.qty));

      const shortages: string[] = [];
      newQtyByProduct.forEach((qty, pid) => {
        const p = productState.get(pid);
        const name = productNameByPid.get(pid) ?? pid;
        if (!p || !p.exists) { shortages.push(`${name} (produk tidak ditemukan)`); return; }
        if (p.stockQty < qty) shortages.push(`${name} (stok toko ${p.stockQty}, butuh ${qty})`);
      });
      if (shortages.length > 0) throw new Error(`Stok produk tidak cukup untuk dikirim: ${shortages.join(', ')}`);

      newQtyByProduct.forEach((qty, pid) => {
        productState.get(pid)!.stockQty -= qty;
        bumpWs(data.warehouseId, pid, -qty);
      });

      newItems.forEach(it => {
        const key = `${data.locationId}_${it.productId}`;
        const s = stockState.get(key)!;
        const newQty = s.stockQty + it.qty;
        s.hargaTitip = newQty > 0 ? (s.stockQty * s.hargaTitip + it.qty * it.hargaTitip) / newQty : 0;
        s.stockQty = newQty;
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
      wsDelta.forEach(({ warehouseId, productId, delta }, key) => {
        if (delta === 0) return;
        tx.set(db.collection('warehouse_stock').doc(key), {
          warehouseId, productId, productName: productNameByPid.get(productId) ?? '',
          stockQty: FieldValue.increment(delta), updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      });

      // Log gudang baru untuk kiriman hasil edit — log lama dari kiriman sebelum diedit
      // dibiarkan sebagai riwayat historis (tidak dihapus/diubah).
      newItems.forEach(it => {
        const logRef = db.collection('stock').doc();
        tx.set(logRef, {
          warehouseId: data.warehouseId, warehouseName: data.warehouseName ?? '',
          productId: it.productId, productName: it.productName,
          type: 'out', qty: it.qty,
          note: `Kirim konsinyasi (diedit) – ${data.locationName}${data.note ? `: ${data.note}` : ''}`,
          createdAt: FieldValue.serverTimestamp(),
        });
      });

      const itemsWithSubtotal = newItems.map(it => ({ ...it, subtotal: it.qty * it.hargaTitip }));
      tx.update(shipmentRef, {
        locationId: data.locationId, locationName: data.locationName,
        warehouseId: data.warehouseId, warehouseName: data.warehouseName ?? '',
        items: itemsWithSubtotal, note: data.note ?? '',
        ...(data.date ? { createdAt: Timestamp.fromDate(new Date(`${data.date}T12:00:00`)) } : {}),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal mengubah pengiriman.' }, { status: 400 });
  }

  return Response.json({ ok: true });
}
