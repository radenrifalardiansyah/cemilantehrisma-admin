import { NextRequest } from 'next/server';
import { requireSession } from '@/lib/rbac';
import { getDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const user = await requireSession(req);
  if (user instanceof Response) return user;
  const { id } = await ctx.params;

  try {
    await getDb().collection('notifications').doc(id).update({
      readBy: FieldValue.arrayUnion(user.username),
    });
  } catch {
    // Firestore .update() menolak (NOT_FOUND) kalau dokumennya sudah tidak ada (mis. cache klien
    // basi atau id sampah dari URL manual) — tidak ada apa-apa yang perlu ditandai, bukan error.
    return Response.json({ error: 'Notifikasi tidak ditemukan.' }, { status: 404 });
  }
  return Response.json({ ok: true });
}
