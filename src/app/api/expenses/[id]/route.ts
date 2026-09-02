import { NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getDb } from '@/lib/firebase-admin';
import { getSql, parseJsonb } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logHistory } from '@/lib/history';

type Ctx = { params: Promise<{ id: string }> };

interface ExpenseRow {
  id: string; category: string | null; description: string | null; amount: string;
  items: unknown; date: string; note: string | null; wallet_id: string | null;
  source_type: string | null; source_id: string | null;
}

// Entri yang otomatis dibuat dari sumber lain (mis. Pembelian Bahan Baku) tidak boleh diedit/dihapus
// langsung dari sini — kalau dibolehkan, sumbernya (mis. status Lunas & stok bahan baku) jadi tidak
// sinkron dengan Pengeluaran yang ditampilkan. Harus diedit/dihapus dari menu sumbernya.
function sourceLockMessage(sourceType: unknown): string | null {
  if (sourceType === 'material-purchase') {
    return 'Entri ini otomatis dari Pembelian Bahan Baku — edit atau hapus dari menu Bahan Baku > Pembelian supaya stok & status bayar tetap sinkron.';
  }
  if (sourceType === 'production') {
    return 'Entri ini otomatis dari Produksi — edit atau hapus dari menu Produksi supaya biaya & catatan produksi tetap sinkron.';
  }
  return null;
}

function toAudit(r: ExpenseRow) {
  return { category: r.category, description: r.description, amount: Number(r.amount), items: parseJsonb(r.items as string | unknown[] | null), date: r.date, note: r.note, walletId: r.wallet_id, sourceType: r.source_type };
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'expenses', 'edit');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const sql = getSql();
  const [before] = await sql<ExpenseRow[]>`select * from expenses where id = ${id}`;
  const lockMsg = sourceLockMessage(before?.source_type);
  if (lockMsg) return Response.json({ error: lockMsg }, { status: 400 });

  const data = await req.json() as Record<string, unknown>;
  const amount = Number(data.amount) || 0;
  if (amount <= 0) return Response.json({ error: 'Jumlah harus lebih dari 0.' }, { status: 400 });
  const payload = {
    category: (data.category as string | undefined) ?? 'Lainnya',
    description: (data.description as string | undefined) ?? '',
    amount,
    items: Array.isArray(data.items) ? data.items : [],
    date: String(data.date ?? ''),
    note: (data.note as string | undefined) ?? '',
    walletId: (data.walletId as string | null | undefined) ?? null,
  };
  await sql`
    update expenses
    set category = ${payload.category}, description = ${payload.description}, amount = ${payload.amount},
        items = ${JSON.stringify(payload.items)}, date = ${payload.date}, note = ${payload.note},
        wallet_id = ${payload.walletId}, updated_at = now()
    where id = ${id}
  `;
  try {
    const db = getDb();
    await logHistory(db, {
      entity: 'expenses',
      entityId: id,
      entityLabel: `${payload.description || payload.category || 'Pengeluaran'} - Rp ${Number(payload.amount ?? 0).toLocaleString('id-ID')}`,
      action: 'update',
      actor: guard,
      before: before ? toAudit(before) : null,
      after: payload,
    });
  } catch (err) {
    console.error('Failed to write history for expenses update', err);
  }
  revalidateTag('admin-expenses', { expire: 0 });
  return Response.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'expenses', 'delete');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const sql = getSql();
  const [before] = await sql<ExpenseRow[]>`select * from expenses where id = ${id}`;
  const lockMsg = sourceLockMessage(before?.source_type);
  if (lockMsg) return Response.json({ error: lockMsg }, { status: 400 });

  try {
    await sql`delete from expenses where id = ${id}`;
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === '23503') {
      return Response.json({ error: 'Tidak bisa dihapus — entri ini masih dipakai sumber lain.' }, { status: 400 });
    }
    throw err;
  }
  try {
    const db = getDb();
    await logHistory(db, {
      entity: 'expenses',
      entityId: id,
      entityLabel: before ? `${before.description || before.category || 'Pengeluaran'} - Rp ${Number(before.amount ?? 0).toLocaleString('id-ID')}` : id,
      action: 'delete',
      actor: guard,
      before: before ? toAudit(before) : null,
    });
  } catch (err) {
    console.error('Failed to write history for expenses delete', err);
  }
  revalidateTag('admin-expenses', { expire: 0 });
  return Response.json({ ok: true });
}
