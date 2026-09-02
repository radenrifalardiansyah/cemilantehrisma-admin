import { NextRequest, after } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logHistory } from '@/lib/history';
import { shipmentPdfTag } from '@/lib/pdf/shipmentPdfTag';
import { revalidateStorefront } from '@/lib/revalidate';
import { writeStockLedgerEntryPg, stockLabel } from '@/lib/stock-pg';
import { rowToShipment, type ShipmentRow } from '@/lib/shipments-pg';

type Ctx = { params: Promise<{ id: string }> };
interface SendItemInput { productId: string; productName: string; qty: number; hargaTitip: number }

// Hapus riwayat kirim — mengembalikan stok toko & stok gudang asal, dan mengurangi stok titip di
// lokasi, lalu menghapus dokumen pengiriman itu sendiri, semuanya dalam SATU transaksi Postgres
// (Tahap 18a — stok & dokumen sama-sama Postgres, tidak perlu lagi kompensasi cross-database
// seperti versi Firestore sebelumnya). Ditolak jika stok titip sudah terpakai (terjual/direkap)
// sehingga tidak cukup untuk dibalik.
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'consignment', 'delete');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const db = getDb();
  const sql = getSql();

  const [shipmentRow] = await sql<ShipmentRow[]>`select * from consignment_shipments where id = ${id}`;
  if (!shipmentRow) return Response.json({ error: 'Riwayat kirim tidak ditemukan.' }, { status: 404 });
  const shipment = rowToShipment(shipmentRow);
  const items = shipment.items;

  try {
    await sql.begin(async pgTx => {
      const productIds = items.map(it => it.productId);
      const stockKeys  = items.map(it => `${shipment.locationId}_${it.productId}`);
      const [productRows, stockRows] = await Promise.all([
        productIds.length > 0 ? pgTx<{ id: string; stock_qty: string; open_po: boolean }[]>`select id, stock_qty, open_po from products where id in ${pgTx(productIds)} order by id for update` : [],
        stockKeys.length > 0 ? pgTx<{ id: string; stock_qty: string }[]>`select id, stock_qty from consignment_stock where id in ${pgTx(stockKeys)} order by id for update` : [],
      ]);
      const productById = new Map(productRows.map(r => [r.id, r]));
      const stockById = new Map(stockRows.map(r => [r.id, r]));

      const shortages: string[] = [];
      items.forEach((it, i) => {
        const stockQty = Number(stockById.get(stockKeys[i])?.stock_qty) || 0;
        if (stockQty < it.qty) shortages.push(`${it.productName} (stok titip tersisa ${stockQty}, butuh ${it.qty})`);
      });
      if (shortages.length > 0) {
        throw new Error(`Tidak bisa menghapus — sebagian stok kiriman ini sudah terjual/direkap: ${shortages.join(', ')}`);
      }

      for (const [i, it] of items.entries()) {
        const productRow = productById.get(productIds[i]);
        if (productRow) {
          const oldQty = Number(productRow.stock_qty) || 0;
          const newQty = oldQty + it.qty;
          await pgTx`update products set stock_qty = ${newQty}, stock = ${stockLabel(productRow.open_po, newQty)}, updated_at = now() where id = ${it.productId}`;
        }
        const stockKey = stockKeys[i];
        const stockQty = Number(stockById.get(stockKey)?.stock_qty) || 0;
        await pgTx`update consignment_stock set stock_qty = ${stockQty - it.qty}, updated_at = now() where id = ${stockKey}`;

        // Kiriman lama (sebelum fitur gudang asal) tidak pernah mengurangi warehouse_stock — jangan dibalik.
        if (shipment.warehouseId) {
          const wsKey = `${shipment.warehouseId}_${it.productId}`;
          const wsRows = await pgTx<{ stock_qty: string }[]>`select stock_qty from warehouse_stock where id = ${wsKey} for update`;
          const oldWsQty = wsRows[0] ? Number(wsRows[0].stock_qty) || 0 : 0;
          await pgTx`
            insert into warehouse_stock (id, warehouse_id, product_id, product_name, stock_qty, updated_at)
            values (${wsKey}, ${shipment.warehouseId}, ${it.productId}, ${it.productName}, ${oldWsQty + it.qty}, now())
            on conflict (id) do update set stock_qty = ${oldWsQty + it.qty}, updated_at = now()
          `;
        }
      }

      await pgTx`delete from consignment_shipments where id = ${id}`;
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal menghapus riwayat kirim.' }, { status: 400 });
  }

  try {
    await logHistory(db, {
      entity: 'consignment',
      entityCollection: 'consignmentShipments',
      entityId: id,
      entityLabel: shipment.locationName || id,
      action: 'delete',
      actor: guard,
      before: shipmentRow,
    });
  } catch (err) {
    console.error('Failed to write history for consignment send delete', err);
  }

  revalidateTag(shipmentPdfTag(id), 'max');
  after(() => revalidateStorefront('products'));
  return Response.json({ ok: true });
}

// Edit riwayat kirim — membalik efek stok yang lama (termasuk stok gudang asal lama, jika ada),
// menerapkan efek stok yang baru, dan menulis ulang dokumen pengiriman, semuanya dalam SATU
// transaksi Postgres (Tahap 18a). Ditolak jika stok lama sudah terpakai atau stok toko tidak
// cukup. Log gudang lama dibiarkan sebagai riwayat historis.
export async function PUT(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'consignment', 'edit');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const data = await req.json() as {
    locationId: string; locationName: string; warehouseId: string; warehouseName?: string;
    note?: string; items: SendItemInput[]; date?: string;
  };
  const newItems = data.items ?? [];
  if (newItems.length === 0) return Response.json({ error: 'Minimal 1 produk dikirim.' }, { status: 400 });
  if (!data.warehouseId) return Response.json({ error: 'Pilih gudang asal pengiriman.' }, { status: 400 });

  const db = getDb();
  const sql = getSql();

  const [shipmentRow] = await sql<ShipmentRow[]>`select * from consignment_shipments where id = ${id}`;
  if (!shipmentRow) return Response.json({ error: 'Riwayat kirim tidak ditemukan.' }, { status: 404 });
  const oldShipment = rowToShipment(shipmentRow);
  const oldItems = oldShipment.items;

  const productIds = [...new Set([...oldItems.map(it => it.productId), ...newItems.map(it => it.productId)])];
  const productNameByPid = new Map<string, string>();
  [...oldItems, ...newItems].forEach(it => { if (!productNameByPid.has(it.productId)) productNameByPid.set(it.productId, it.productName); });

  const stockMeta = new Map<string, { locationId: string; productId: string; productName: string }>();
  oldItems.forEach(it => {
    const key = `${oldShipment.locationId}_${it.productId}`;
    if (!stockMeta.has(key)) stockMeta.set(key, { locationId: oldShipment.locationId ?? '', productId: it.productId, productName: it.productName });
  });
  newItems.forEach(it => {
    const key = `${data.locationId}_${it.productId}`;
    if (!stockMeta.has(key)) stockMeta.set(key, { locationId: data.locationId, productId: it.productId, productName: it.productName });
  });
  const stockKeys = [...stockMeta.keys()];

  let itemsWithSubtotal: (SendItemInput & { subtotal: number })[] = [];
  // Sama seperti versi Firestore lama: createdAt cuma ditimpa kalau tanggal baru diberikan,
  // kalau tidak dipertahankan (bukan direset ke waktu edit terjadi).
  const newCreatedAt = data.date ? new Date(data.date) : shipmentRow.created_at;

  try {
    await sql.begin(async pgTx => {
      const [productRows, stockRows] = await Promise.all([
        productIds.length > 0 ? pgTx<{ id: string; stock_qty: string; open_po: boolean }[]>`select id, stock_qty, open_po from products where id in ${pgTx(productIds)} order by id for update` : [],
        stockKeys.length > 0 ? pgTx<{ id: string; stock_qty: string; harga_titip: string | null }[]>`select id, stock_qty, harga_titip from consignment_stock where id in ${pgTx(stockKeys)} order by id for update` : [],
      ]);
      const productById = new Map(productRows.map(r => [r.id, r]));
      const stockById = new Map(stockRows.map(r => [r.id, r]));

      const productState = new Map(productIds.map(pid => {
        const row = productById.get(pid);
        return [pid, { exists: !!row, stockQty: row ? Number(row.stock_qty) || 0 : 0, openPO: row?.open_po ?? false }];
      }));
      const stockState = new Map(stockKeys.map(k => {
        const row = stockById.get(k);
        return [k, { stockQty: row ? Number(row.stock_qty) || 0 : 0, hargaTitip: row?.harga_titip != null ? Number(row.harga_titip) : 0 }];
      }));

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
          on conflict (id) do update set stock_qty = ${s.stockQty}, harga_titip = ${s.hargaTitip}, updated_at = now()
        `;
      }
      for (const [key, { warehouseId, productId, delta }] of wsDelta) {
        if (delta === 0) continue;
        const rows = await pgTx<{ stock_qty: string }[]>`select stock_qty from warehouse_stock where id = ${key} for update`;
        const oldQty = rows[0] ? Number(rows[0].stock_qty) || 0 : 0;
        const newQty = oldQty + delta;
        await pgTx`
          insert into warehouse_stock (id, warehouse_id, product_id, product_name, stock_qty, updated_at)
          values (${key}, ${warehouseId}, ${productId}, ${productNameByPid.get(productId) ?? ''}, ${newQty}, now())
          on conflict (id) do update set stock_qty = ${newQty}, updated_at = now()
        `;
      }

      // Log gudang baru untuk kiriman hasil edit — log lama dari kiriman sebelum diedit
      // dibiarkan sebagai riwayat historis (tidak dihapus/diubah).
      for (const it of newItems) {
        await writeStockLedgerEntryPg(pgTx, {
          productId: it.productId, productName: it.productName, warehouseId: data.warehouseId, warehouseName: data.warehouseName,
          type: 'out', qty: it.qty, note: `Kirim konsinyasi (diedit) – ${data.locationName}${data.note ? `: ${data.note}` : ''}`,
        });
      }

      itemsWithSubtotal = newItems.map(it => ({ ...it, subtotal: it.qty * it.hargaTitip }));

      await pgTx`
        update consignment_shipments set
          location_id = ${data.locationId}, location_name = ${data.locationName},
          warehouse_id = ${data.warehouseId}, warehouse_name = ${data.warehouseName ?? ''},
          items = ${JSON.stringify(itemsWithSubtotal)}, note = ${data.note ?? ''},
          created_at = ${newCreatedAt}, updated_at = now()
        where id = ${id}
      `;
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal mengubah pengiriman.' }, { status: 400 });
  }

  try {
    await logHistory(db, {
      entity: 'consignment',
      entityCollection: 'consignmentShipments',
      entityId: id,
      entityLabel: `${data.locationName ?? oldShipment.locationName ?? id}${data.date ? ` - ${data.date}` : ''}`,
      action: 'update',
      actor: guard,
      before: shipmentRow,
      after: {
        locationId: data.locationId, locationName: data.locationName,
        warehouseId: data.warehouseId, warehouseName: data.warehouseName ?? '',
        items: itemsWithSubtotal, note: data.note ?? '',
      },
    });
  } catch (err) {
    console.error('Failed to write history for consignment send update', err);
  }

  revalidateTag(shipmentPdfTag(id), 'max');
  after(() => revalidateStorefront('products'));
  return Response.json({ ok: true });
}
