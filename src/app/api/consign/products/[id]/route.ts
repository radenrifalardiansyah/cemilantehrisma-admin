import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import type { ConsignProductRow } from '@/lib/consign-pg';
import { auditConsign } from '@/lib/consign-audit';
import { parseProductBody, syncStallItems, schemeCoverageError, categoryProblem } from '@/lib/consign-products';

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'consign', 'edit');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const parsed = parseProductBody(await req.json() as Record<string, unknown>);
  if ('error' in parsed) return Response.json({ error: parsed.error }, { status: 400 });
  const v = parsed.value;

  const sql = getSql();
  const [before] = await sql<ConsignProductRow[]>`select * from consign_products where id = ${id}`;
  if (!before) return Response.json({ error: 'Produk tidak ditemukan.' }, { status: 404 });
  const [c] = await sql<{ id: string; scheme: string | null }[]>`select id, scheme from consignors where id = ${v.consignorId}`;
  if (!c) return Response.json({ error: 'Penitip tidak ditemukan.' }, { status: 400 });
  const coverage = schemeCoverageError(c.scheme, v);
  if (coverage) return Response.json({ error: coverage }, { status: 400 });
  const catErr = await categoryProblem(sql, v.category);
  if (catErr) return Response.json({ error: catErr }, { status: 400 });
  // Pemilik produk tidak boleh berpindah penitip setelah ada stok/riwayat — stok & rekap hutang
  // ikut penitip, jadi pindah pemilik diam-diam akan mengacaukan hutang.
  if (before.consignor_id !== v.consignorId) {
    const [{ used }] = await sql<{ used: boolean }[]>`
      select exists(select 1 from consign_stock_ledger where product_id = ${id}) as used
    `;
    if (used) return Response.json({ error: 'Produk ini sudah punya riwayat stok — penitipnya tidak bisa diganti.' }, { status: 400 });
  }

  const err = await sql.begin(async tx => {
    await tx`
      update consign_products set consignor_id = ${v.consignorId}, name = ${v.name}, unit = ${v.unit}, default_price = ${v.defaultPrice},
        scheme = ${v.scheme}, scheme_value = ${v.schemeValue}, note = ${v.note}, is_active = ${v.isActive}, min_stock = ${v.minStock}, image_url = ${v.imageUrl}, category = ${v.category}, weight = ${v.weight}, description = ${v.description}, updated_at = now()
      where id = ${id}
    `;
    const e = await syncStallItems(tx, id, v.stallItems);
    if (e) throw new Error(e);
    return null;
  }).catch((e: Error) => e.message);
  if (err) return Response.json({ error: err }, { status: 400 });

  await auditConsign(guard, 'update', 'products', id, `Produk titipan ${v.name}`,
    { name: before.name, defaultPrice: Number(before.default_price), scheme: before.scheme, schemeValue: before.scheme_value === null ? null : Number(before.scheme_value) },
    { name: v.name, defaultPrice: v.defaultPrice, scheme: v.scheme, schemeValue: v.schemeValue });
  return Response.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'consign', 'delete');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const sql = getSql();
  const [before] = await sql<ConsignProductRow[]>`select * from consign_products where id = ${id}`;
  if (!before) return Response.json({ error: 'Produk tidak ditemukan.' }, { status: 404 });
  const [{ used }] = await sql<{ used: boolean }[]>`
    select (exists(select 1 from consign_stock_ledger where product_id = ${id})
         or exists(select 1 from consign_stall_items where product_id = ${id} and stock_qty > 0)) as used
  `;
  if (used) return Response.json({ error: 'Produk ini sudah punya stok/riwayat — tidak bisa dihapus. Nonaktifkan saja.' }, { status: 400 });
  await sql.begin(async tx => {
    await tx`delete from consign_stall_items where product_id = ${id}`;
    await tx`delete from consign_products where id = ${id}`;
  });
  await auditConsign(guard, 'delete', 'products', id, `Produk titipan ${before.name}`, { name: before.name, code: before.code }, null);
  return Response.json({ ok: true });
}
