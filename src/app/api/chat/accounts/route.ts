import { NextRequest } from 'next/server';
import { requireSession } from '@/lib/rbac';
import { getAllAccounts } from '@/lib/chat-server';

export async function GET(req: NextRequest) {
  const authUser = await requireSession(req);
  if (authUser instanceof Response) return authUser;

  const accounts = await getAllAccounts();
  return Response.json({ accounts });
}
