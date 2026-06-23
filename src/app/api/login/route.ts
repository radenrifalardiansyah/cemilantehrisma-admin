import { NextRequest } from 'next/server';

export async function POST(req: NextRequest) {
  const { username, password } = await req.json() as { username: string; password: string };
  if (
    username === process.env.ADMIN_USERNAME &&
    password === process.env.ADMIN_PASSWORD
  ) {
    return Response.json({ ok: true });
  }
  return Response.json({ error: 'Invalid credentials' }, { status: 401 });
}
