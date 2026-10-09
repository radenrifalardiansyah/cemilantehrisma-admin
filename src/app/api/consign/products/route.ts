import { randomUUID } from 'crypto';
import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import {
  rowToConsignProduct, rowToStallItem, nextCode,
  type ConsignProductRow, type StallItemRow,
} from '@/lib/consign-pg';
import { parseProductBody, syncStallItems, schemeCoverageError } from '@/lib/consign-products';
import { auditConsign } from '@/lib/consign-audit';

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'consign', 'view');
  if (guard instanceof Response) return guard;
  const sql = getSql();
  const [products, stallItems] = await Promise.all([
    sql<ConsignProductRow[]>`select * from consign_products order by created_at asc`,
    sql<StallItemRow[]>`select id, product_id, stall_id, price, scheme, scheme_value, stock_qty from consign_stall_items`,
  ]);
  return Response.json({ products: products.map(rowToConsignProduct), stallItems: stallItems.map(rowToStallItem) });
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'consign', 'create');
  if (guard instanceof Response) return guard;
  const parsed = parseProductBody(await req.json() as Record<string, unknown>);
  if ('error' in parsed) return Response.json({ error: parsed.error }, { status: 400 });
  const v = parsed.value;

  const sql = getSql();
  const [c] = await sql<{ id: string; scheme: string | null }[]>`select id, scheme from consignors where id = ${v.consignorId}`;
  if (!c) return Response.json({ error: 'Penitip tidak ditemukan.' }, { status: 400 });
  const coverage = schemeCoverageError(c.scheme, v);
  if (coverage) return Response.json({ error: coverage }, { status: 400 });

  const id = randomUUID();
  let code = '';
  const err = await sql.begin(async tx => {
    const existing = await tx<{ code: string | null }[]>`select code from consign_products`;
    code = nextCode('TJP', existing.map(r => r.code));
    await tx`
      insert into consign_products (id, code, consignor_id, name, unit, default_price, scheme, scheme_value, note, is_active, created_at, updated_at)
      values (${id}, ${code}, ${v.consignorId}, ${v.name}, ${v.unit}, ${v.defaultPrice}, ${v.scheme}, ${v.schemeValue}, ${v.note}, ${v.isActive}, now(), now())
    `;
    const e = await syncStallItems(tx, id, v.stallItems);
    if (e) throw new Error(e);
    return null;
  }).catch((e: Error) => e.message);
  if (err) return Response.json({ error: err }, { status: 400 });

  await auditConsign(guard, 'create', 'products', id, `Produk titipan ${v.name}`, null, { code, name: v.name, consignorId: v.consignorId, defaultPrice: v.defaultPrice });
  return Response.json({ id, code });
}
