import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { parseSchemeInput, type ConsignorRow } from '@/lib/consign-pg';
import { validateScheme } from '@/lib/consign';
import { auditConsign } from '@/lib/consign-audit';

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'consign', 'edit');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const data = await req.json() as Record<string, unknown>;
  const name = typeof data.name === 'string' ? data.name.trim() : '';
  if (!name) return Response.json({ error: 'Nama penitip wajib diisi.' }, { status: 400 });
  const parsed = parseSchemeInput(data.scheme, data.schemeValue);
  if ('error' in parsed) return Response.json({ error: parsed.error }, { status: 400 });
  if (!parsed.scheme) return Response.json({ error: 'Skema bagi hasil wajib dipilih.' }, { status: 400 });
  const schemeErr = validateScheme(parsed.scheme, parsed.value ?? 0);
  if (schemeErr) return Response.json({ error: schemeErr }, { status: 400 });

  const sql = getSql();
  const [before] = await sql<ConsignorRow[]>`select * from consignors where id = ${id}`;
  if (!before) return Response.json({ error: 'Penitip tidak ditemukan.' }, { status: 404 });
  await sql`
    update consignors set name = ${name}, phone = ${(data.phone as string) ?? ''}, address = ${(data.address as string) ?? ''},
      bank_name = ${(data.bankName as string) ?? ''}, bank_account = ${(data.bankAccount as string) ?? ''},
      bank_holder = ${(data.bankHolder as string) ?? ''}, note = ${(data.note as string) ?? ''},
      scheme = ${parsed.scheme}, scheme_value = ${parsed.value ?? 0}, is_active = ${data.isActive !== false}, updated_at = now()
    where id = ${id}
  `;
  await auditConsign(guard, 'update', 'consignors', id, `Penitip ${name}`,
    { name: before.name, scheme: before.scheme, schemeValue: Number(before.scheme_value), isActive: before.is_active },
    { name, scheme: parsed.scheme, schemeValue: parsed.value, isActive: data.isActive !== false });
  return Response.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'consign', 'delete');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const sql = getSql();
  const [before] = await sql<ConsignorRow[]>`select * from consignors where id = ${id}`;
  if (!before) return Response.json({ error: 'Penitip tidak ditemukan.' }, { status: 404 });
  const [{ used }] = await sql<{ used: boolean }[]>`
    select (exists(select 1 from consign_products where consignor_id = ${id})
         or exists(select 1 from consign_receipts where consignor_id = ${id})) as used
  `;
  if (used) {
    return Response.json({ error: 'Penitip ini sudah punya produk/riwayat titipan — tidak bisa dihapus. Nonaktifkan saja.' }, { status: 400 });
  }
  await sql`delete from consignors where id = ${id}`;
  await auditConsign(guard, 'delete', 'consignors', id, `Penitip ${before.name}`, { name: before.name, code: before.code }, null);
  return Response.json({ ok: true });
}
