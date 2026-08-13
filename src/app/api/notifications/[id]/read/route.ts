import { NextRequest } from 'next/server';
import { getAuthUser, unauthorized } from '@/lib/admin-auth';
import { getDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const user = getAuthUser(req);
  if (!user) return unauthorized();
  const { id } = await ctx.params;

  await getDb().collection('notifications').doc(id).update({
    readBy: FieldValue.arrayUnion(user.username),
  });
  return Response.json({ ok: true });
}
