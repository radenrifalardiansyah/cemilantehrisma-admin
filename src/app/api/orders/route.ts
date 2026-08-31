import { NextRequest, after } from 'next/server';
import { unstable_cache } from 'next/cache';
import { getDb } from '@/lib/firebase-admin';
import { requirePermission } from '@/lib/rbac';
import { FieldValue, Timestamp, Query, DocumentData } from 'firebase-admin/firestore';
import { readProductsForDeltas, applyStockDelta, writeStockLedgerEntry } from '@/lib/stock';
import { revalidateStorefront } from '@/lib/revalidate';
import { wibDayStart, wibDayEnd } from '@/lib/date';
import { writeHistoryEntry } from '@/lib/history';
import { writeNotification, sendPush } from '@/lib/notifications';

// `orders` dibaca dengan from=2000-01-01 (seluruh riwayat) oleh useWalletBalances di 7 tab
// berbeda (Kasir, Pesanan, Pemasukan, Pengeluaran, Modal, Bahan Baku, Mitra) SETIAP kali ada
// transaksi baru dimanapun — tanpa cache, itu artinya satu scan penuh koleksi `orders` per
// panggilan. Cache berbasis waktu murni (bukan revalidateTag) dengan sengaja: koleksi ini juga
// ditulis dari banyak endpoint (checkout kasir, edit/hapus/ubah status pesanan, impor massal) —
// mengandalkan invalidasi manual di SEMUA titik tulis itu gampang ada yang kelewat dan diam-diam
// jadi stale permanen. TTL pendek (15s, sama seperti capital/wallet-transfers) menjaga tampilan
// tetap terasa langsung sambil menyerap lonjakan baca yang terjadi bersamaan.
const getCachedOrders = unstable_cache(
  async (from: string | null, to: string | null, limit: number) => {
    const db = getDb();
    let query: Query<DocumentData> = db.collection('orders').orderBy('createdAt', 'desc');
    if (from) query = query.where('createdAt', '>=', wibDayStart(from));
    if (to)   query = query.where('createdAt', '<=', wibDayEnd(to));
    if (!from && !to) query = query.limit(limit);

    const snap = await query.get();
    return snap.docs.map(d => {
      const data = d.data();
      const createdAt = data.createdAt as Timestamp | undefined;
      return { id: d.id, ...data, createdAt: createdAt ? { seconds: createdAt.seconds, nanoseconds: createdAt.nanoseconds } : null };
    });
  },
  ['admin-orders-list'],
  { revalidate: 15 },
);

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'orders', 'view');
  if (guard instanceof Response) return guard;
  const { searchParams } = new URL(req.url);
  const from = searchParams.get('from'); // ISO yyyy-mm-dd — dipakai Laporan Keuangan untuk filter per periode
  const to   = searchParams.get('to');
  const limit = parseInt(searchParams.get('limit') ?? '50');

  const orders = await getCachedOrders(from, to, limit);
  return Response.json({ orders });
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'orders', 'create');
  if (guard instanceof Response) return guard;
  const data = await req.json() as Record<string, unknown> & {
    transactionAt?: string; invoiceNo?: string;
    items?: { productId?: string; qty: number }[];
    warehouseId?: string; warehouseName?: string;
    isPreOrder?: boolean;
  };
  const { transactionAt, ...rest } = data;
  delete rest.isPreOrder;
  const db = getDb();
  // Kasir bisa mengedit tanggal & jam transaksi (mis. transaksi baru sempat diinput belakangan) —
  // kalau dikirim, itu yang jadi createdAt (dipakai buat urutan & filter periode di Pesanan/Laporan
  // Keuangan). Kalau tidak dikirim, pakai waktu server seperti biasa.
  const createdAt = transactionAt ? Timestamp.fromDate(new Date(transactionAt)) : FieldValue.serverTimestamp();

  // Potong stok jadi bagian dari transaksi yang sama dengan penyimpanan order — tidak ada lagi
  // celah "order tersimpan tapi stok gagal dipotong" seperti pola fetch terpisah yang lama.
  const deltas = new Map<string, number>();
  for (const item of data.items ?? []) {
    if (!item.productId || !item.qty) continue;
    deltas.set(item.productId, (deltas.get(item.productId) ?? 0) - item.qty);
  }

  let orderId = '';
  let isPreOrder = false;
  let pushPayload: { title: string; message: string } | null = null;
  try {
    await db.runTransaction(async tx => {
      const { products, shortageDetails } = await readProductsForDeltas(tx, db, deltas);
      // "Jual sebagai PO" adalah pilihan manual kasir (lihat checkbox di PosTab.tsx), lepas dari
      // stok saat ini — sengaja TIDAK otomatis dipicu oleh stok habis, supaya kasir yang menentukan
      // kapan suatu transaksi perlu jadi PO. Kalau dicentang, pesanan disimpan sebagai 'baru' tanpa
      // memotong stok sekarang (persis pesanan Website), baru dipotong begitu admin menandai
      // Selesai di menu Pesanan (lihat PUT /api/orders/[id]). Cek `hasOpenPOItem` di sini cuma
      // jaga-jaga kalau body dikirim manual (bukan lewat UI) tanpa produk "Buka PO" sama sekali.
      const hasOpenPOItem = [...deltas.keys()].some(pid => !!products.get(pid)?.data.openPO);
      isPreOrder = data.isPreOrder === true && hasOpenPOItem;
      if (!isPreOrder && shortageDetails.length > 0) throw new Error(`Stok tidak cukup: ${shortageDetails.map(s => s.message).join(', ')}`);

      // invoiceNo dibuat di klien dengan resolusi menit (INV-YYYYMMDD-HHmm), tanpa detik/counter —
      // dua transaksi kasir yang selesai dalam menit yang sama bisa kirim invoiceNo identik.
      // Server tidak pernah mengeceknya sebelum ini, jadi keduanya tersimpan dengan nomor yang
      // sama (merusak pencarian invoice untuk cetak ulang struk/CS). Kalau bentrok, tambahkan
      // sufiks alih-alih menolak — checkout kasir yang sudah selesai tidak boleh gagal karena ini.
      let invoiceNo = typeof rest.invoiceNo === 'string' ? rest.invoiceNo : undefined;
      if (invoiceNo) {
        let candidate = invoiceNo;
        for (let suffix = 2; suffix <= 20; suffix++) {
          const dupe = await tx.get(db.collection('orders').where('invoiceNo', '==', candidate).limit(1));
          if (dupe.empty) break;
          candidate = `${invoiceNo}-${suffix}`;
        }
        invoiceNo = candidate;
      }

      // Snapshot HPP (costPrice) tiap item saat transaksi terjadi — costPrice produk adalah
      // rata-rata bergerak yang berubah tiap ada produksi baru, jadi HPP historis tidak bisa
      // direkonstruksi ulang secara akurat kalau tidak disimpan di sini (dipakai Laporan Keuangan).
      const itemsWithCost = (data.items ?? []).map(item => ({
        ...item,
        costPrice: item.productId ? Number(products.get(item.productId)?.data.costPrice) || 0 : 0,
      }));

      const ref = db.collection('orders').doc();
      orderId = ref.id;
      const orderData = {
        ...rest,
        invoiceNo,
        items: itemsWithCost,
        status: isPreOrder ? 'baru' : 'done',
        source: 'kasir',
        stockCut: !isPreOrder,
        createdAt,
      };
      tx.set(ref, orderData);
      writeHistoryEntry(tx, db, {
        entity: 'orders', entityId: ref.id, entityLabel: `Pesanan ${invoiceNo ?? ref.id}`,
        action: 'create', actor: guard, after: orderData,
      });
      pushPayload = writeNotification(tx, db, {
        type: 'order_new',
        title: 'Pesanan baru',
        message: `Pesanan ${data.invoiceNo ?? ref.id} senilai Rp${(Number(data.total) || 0).toLocaleString('id-ID')} — oleh ${guard.username}.`,
        link: 'orders',
        entityCollection: 'orders', entityId: ref.id,
        actor: guard,
      });

      if (!isPreOrder) {
        for (const [productId, delta] of deltas) {
          const product = products.get(productId)!;
          applyStockDelta(tx, db, { productId, product, warehouseId: data.warehouseId, delta });
          writeStockLedgerEntry(tx, db, {
            productId, warehouseId: data.warehouseId, warehouseName: data.warehouseName,
            type: 'out', qty: delta,
            note: `Penjualan Kasir - ${data.invoiceNo ?? ''}`,
          });
        }
      }
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal menyimpan transaksi.' }, { status: 400 });
  }

  if (pushPayload) await sendPush(db, pushPayload).catch(err => console.error('Failed to send push for new order', err));
  if (!isPreOrder && deltas.size > 0) after(() => revalidateStorefront('products'));

  return Response.json({ id: orderId });
}
