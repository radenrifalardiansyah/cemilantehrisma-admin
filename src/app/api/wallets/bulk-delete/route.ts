import { NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { walletHasReferences } from '@/lib/wallet-balance';

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'wallets', 'delete');
  if (guard instanceof Response) return guard;
  const body = await req.json() as { ids: unknown };
  const ids = Array.isArray(body.ids) ? body.ids.filter((i): i is string => typeof i === 'string') : [];
  if (ids.length === 0)
    return Response.json({ error: 'ids required' }, { status: 400 });

  const db = getDb();
  const sql = getSql();
  // Dompet dengan riwayat transaksi tidak boleh ikut dihapus massal — lewati saja, sama seperti
  // aturan DELETE satuan, supaya dokumen lama yang masih menyimpan walletId ini tidak jadi anak yatim.
  const referenced = await Promise.all(ids.map(id => walletHasReferences(db, id)));
  const deletableIds = ids.filter((_, i) => !referenced[i]);
  const skipped = ids.length - deletableIds.length;

  if (deletableIds.length > 0) {
    await sql`delete from wallets where id in ${sql(deletableIds)}`;
  }
  if (deletableIds.length > 0) revalidateTag('admin-wallets', { expire: 0 });
  return Response.json({ deleted: deletableIds.length, skipped });
}
