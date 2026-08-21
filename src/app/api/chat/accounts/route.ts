import { NextRequest } from 'next/server';
import { getAuthUser, unauthorized } from '@/lib/admin-auth';
import { getAllAccounts } from '@/lib/chat-server';

export async function GET(req: NextRequest) {
  const authUser = getAuthUser(req);
  if (!authUser) return unauthorized();

  const accounts = await getAllAccounts();
  return Response.json({ accounts });
}
