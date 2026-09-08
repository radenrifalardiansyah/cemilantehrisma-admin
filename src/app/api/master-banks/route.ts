import { NextRequest } from 'next/server';
import { unstable_cache, revalidateTag } from 'next/cache';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { rowToBank, type MasterBankRow } from '@/lib/master-banks-pg';

const getCachedBanks = unstable_cache(
  async () => {
    const sql = getSql();
    const rows = await sql<MasterBankRow[]>`select * from master_banks order by name asc`;
    return rows.map(rowToBank);
  },
  ['admin-master-banks'],
  { revalidate: 15, tags: ['admin-master-banks'] }
);

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'settings', 'view');
  if (guard instanceof Response) return guard;
  const banks = await getCachedBanks();
  return Response.json({ banks });
}

function slugify(name: string) {
  return name.trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'settings', 'create');
  if (guard instanceof Response) return guard;
  const data = await req.json() as Record<string, unknown>;
  if (typeof data.name !== 'string' || !data.name.trim()) {
    return Response.json({ error: 'Nama bank wajib diisi.' }, { status: 400 });
  }
  const name = data.name.trim();
  const code = slugify(name);
  if (!code) {
    return Response.json({ error: 'Nama bank tidak valid.' }, { status: 400 });
  }
  const bankCode = typeof data.bankCode === 'string' && data.bankCode.trim() ? data.bankCode.trim() : null;
  const ewallet = data.ewallet === true;

  const sql = getSql();
  const [existing] = await sql<{ code: string }[]>`select code from master_banks where code = ${code}`;
  if (existing) {
    return Response.json({ error: 'Bank dengan nama ini sudah ada.' }, { status: 400 });
  }
  await sql`
    insert into master_banks (code, name, bank_code, ewallet)
    values (${code}, ${name}, ${bankCode}, ${ewallet})
  `;
  revalidateTag('admin-master-banks', { expire: 0 });
  return Response.json({ code });
}
