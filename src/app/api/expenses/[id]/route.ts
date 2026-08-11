import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { requirePermission } from '@/lib/rbac';
import { FieldValue } from 'firebase-admin/firestore';

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
  const existing = await db.collection('expenses').doc(id).get();
  const lockMsg = sourceLockMessage(existing.data()?.sourceType);
  if (lockMsg) return Response.json({ error: lockMsg }, { status: 400 });

  const data = await req.json() as Record<string, unknown>;
  await db.collection('expenses').doc(id).update({
    category: data.category ?? 'Lainnya',
    description: data.description ?? '',
    amount: Number(data.amount) || 0,
    items: Array.isArray(data.items) ? data.items : [],
    date: data.date,
    note: data.note ?? '',
    updatedAt: FieldValue.serverTimestamp(),
  });
  return Response.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'expenses', 'delete');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const db = getDb();
  const existing = await db.collection('expenses').doc(id).get();
  const lockMsg = sourceLockMessage(existing.data()?.sourceType);
  if (lockMsg) return Response.json({ error: lockMsg }, { status: 400 });

  await db.collection('expenses').doc(id).delete();
  return Response.json({ ok: true });
}
