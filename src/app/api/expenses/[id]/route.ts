import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { requirePermission } from '@/lib/rbac';
import { FieldValue } from 'firebase-admin/firestore';
import { logHistory } from '@/lib/history';

type Ctx = { params: Promise<{ id: string }> };

// Entri yang otomatis dibuat dari sumber lain (mis. Pembelian Bahan Baku) tidak boleh diedit/dihapus
// langsung dari sini — kalau dibolehkan, sumbernya (mis. status Lunas & stok bahan baku) jadi tidak
// sinkron dengan Pengeluaran yang ditampilkan. Harus diedit/dihapus dari menu sumbernya.
function sourceLockMessage(sourceType: unknown): string | null {
  if (sourceType === 'material-purchase') {
    return 'Entri ini otomatis dari Pembelian Bahan Baku — edit atau hapus dari menu Bahan Baku > Pembelian supaya stok & status bayar tetap sinkron.';
  }
  return null;
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'expenses', 'edit');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const db = getDb();
  const ref = db.collection('expenses').doc(id);
  const existing = await ref.get();
  const before = existing.data();
  const lockMsg = sourceLockMessage(before?.sourceType);
  if (lockMsg) return Response.json({ error: lockMsg }, { status: 400 });

  const data = await req.json() as Record<string, unknown>;
  await ref.update({
    category: data.category ?? 'Lainnya',
    description: data.description ?? '',
    amount: Number(data.amount) || 0,
    items: Array.isArray(data.items) ? data.items : [],
    date: data.date,
    note: data.note ?? '',
    updatedAt: FieldValue.serverTimestamp(),
  });
  try {
    const updated = await ref.get();
    const after = updated.data();
    await logHistory(db, {
      entity: 'expenses',
      entityId: id,
      entityLabel: `${after?.description ?? after?.category ?? 'Pengeluaran'} - Rp ${Number(after?.amount ?? 0).toLocaleString('id-ID')}`,
      action: 'update',
      actor: guard,
      before,
      after,
    });
  } catch (err) {
    console.error('Failed to write history for expenses update', err);
  }
  return Response.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'expenses', 'delete');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const db = getDb();
  const ref = db.collection('expenses').doc(id);
  const existing = await ref.get();
  const before = existing.data();
  const lockMsg = sourceLockMessage(before?.sourceType);
  if (lockMsg) return Response.json({ error: lockMsg }, { status: 400 });

  await ref.delete();
  try {
    await logHistory(db, {
      entity: 'expenses',
      entityId: id,
      entityLabel: `${before?.description ?? before?.category ?? 'Pengeluaran'} - Rp ${Number(before?.amount ?? 0).toLocaleString('id-ID')}`,
      action: 'delete',
      actor: guard,
      before,
    });
  } catch (err) {
    console.error('Failed to write history for expenses delete', err);
  }
  return Response.json({ ok: true });
}
