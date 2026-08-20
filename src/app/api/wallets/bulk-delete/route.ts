import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { requirePermission } from '@/lib/rbac';
import { walletHasReferences } from '@/lib/wallet-balance';

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'wallets', 'delete');
  if (guard instanceof Response) return guard;
  const { ids } = await req.json() as { ids: string[] };
  if (!Array.isArray(ids) || ids.length === 0)
    return Response.json({ error: 'ids required' }, { status: 400 });

  const db = getDb();
  // Dompet dengan riwayat transaksi tidak boleh ikut dihapus massal — lewati saja, sama seperti
  // aturan DELETE satuan, supaya dokumen lama yang masih menyimpan walletId ini tidak jadi anak yatim.
  const referenced = await Promise.all(ids.map(id => walletHasReferences(db, id)));
  const deletableIds = ids.filter((_, i) => !referenced[i]);
  const skipped = ids.length - deletableIds.length;

  const batch = db.batch();
  deletableIds.forEach(id => batch.delete(db.collection('wallets').doc(id)));
  await batch.commit();
  return Response.json({ deleted: deletableIds.length, skipped });
}
