import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { requirePermission } from '@/lib/rbac';
import { logHistory } from '@/lib/history';

type Ctx = { params: Promise<{ id: string }> };

const BATCH_LIMIT = 450; // di bawah limit 500 op/batch Firestore

// Timpa HPP (costPrice) yang SUDAH tersimpan di semua order & rekap konsinyasi lama yang
// mengandung produk ini dengan Harga Modal terkini — dipakai saat HPP lama diketahui salah input
// dan perlu dikoreksi retroaktif. Beda dari tombol "Hitung Ulang HPP" di Laporan Keuangan, yang
// cuma mengisi fallback untuk transaksi yang costPrice-nya kosong, bukan menimpa yang sudah ada
// (lihat effectiveCostPrice di FinanceReportTab.tsx — snapshot costPrice yang truthy selalu menang).
export async function POST(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'products', 'edit');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const db = getDb();

  const productSnap = await db.collection('products').doc(id).get();
  if (!productSnap.exists) return Response.json({ error: 'Produk tidak ditemukan.' }, { status: 404 });
  const costPrice = Number(productSnap.data()?.costPrice) || 0;
  const productName = productSnap.data()?.name ?? '';

  const [ordersSnap, recapsSnap] = await Promise.all([
    db.collection('orders').get(),
    db.collection('consignmentRecaps').get(),
  ]);

  let updatedOrders = 0;
  let updatedRecaps = 0;
  let batch = db.batch();
  let opsInBatch = 0;
  const commits: Promise<unknown>[] = [];
  const queueUpdate = (ref: FirebaseFirestore.DocumentReference, data: Record<string, unknown>) => {
    batch.update(ref, data);
    opsInBatch++;
    if (opsInBatch >= BATCH_LIMIT) {
      commits.push(batch.commit());
      batch = db.batch();
      opsInBatch = 0;
    }
  };

  for (const doc of ordersSnap.docs) {
    const items = doc.data().items as { productId?: string; costPrice?: number }[] | undefined;
    if (!items?.some(it => it.productId === id)) continue;
    const newItems = items.map(it => (it.productId === id ? { ...it, costPrice } : it));
    queueUpdate(doc.ref, { items: newItems });
    updatedOrders++;
  }

  for (const doc of recapsSnap.docs) {
    const items = doc.data().items as { productId?: string; costPrice?: number; qtySold?: number }[] | undefined;
    if (!items?.some(it => it.productId === id)) continue;
    const newItems = items.map(it => (it.productId === id ? { ...it, costPrice, cogs: (it.qtySold ?? 0) * costPrice } : it));
    queueUpdate(doc.ref, { items: newItems });
    updatedRecaps++;
  }

  if (opsInBatch > 0) commits.push(batch.commit());
  await Promise.all(commits);

  await logHistory(db, {
    entity: 'products',
    entityId: id,
    entityLabel: `Hitung Ulang HPP Retroaktif - ${productName}`,
    action: 'update',
    actor: guard,
    meta: { costPrice, updatedOrders, updatedRecaps },
  }).catch(err => console.error('Failed to log recalculate-hpp history', err));

  return Response.json({ ok: true, costPrice, updatedOrders, updatedRecaps });
}
