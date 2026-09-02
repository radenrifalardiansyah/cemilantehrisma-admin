import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { rowToModule, type ModuleRow } from '@/lib/nav-pg';

export async function GET(req: NextRequest) {
  // Both the Modul screen (`modules`) and the Struktur Menu screen (`menus`,
  // which needs the module list for its module/grouping picker) may call this.
  const guard = await requirePermission(req, ['modules', 'menus'], 'view');
  if (guard instanceof Response) return guard;

  const sql = getSql();
  const rows = await sql<ModuleRow[]>`select * from modules order by "order" asc`;
  return Response.json({ modules: rows.map(rowToModule) });
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'modules', 'create');
  if (guard instanceof Response) return guard;

  const { id, name, icon } = await req.json() as { id: string; name: string; icon: string };
  if (!id || !name || !icon) return Response.json({ error: 'ID, nama, dan ikon wajib diisi.' }, { status: 400 });
  if (!/^[a-z0-9-]+$/.test(id)) {
    return Response.json({ error: 'ID modul hanya boleh huruf kecil, angka, dan tanda hubung.' }, { status: 400 });
  }

  const sql = getSql();
  const [existing] = await sql<{ id: string }[]>`select id from modules where id = ${id}`;
  if (existing) {
    return Response.json({ error: `Modul dengan ID "${id}" sudah ada.` }, { status: 409 });
  }

  // max(order)+1, bukan jumlah baris — count menyusut tiap ada modul yang dihapus, jadi modul
  // baru bisa dapat `order` yang bentrok dengan modul lain yang masih ada (lihat komentar sama di
  // api/menus/route.ts POST).
  const [{ maxOrder }] = await sql<{ maxOrder: number | null }[]>`select max("order") as "maxOrder" from modules`;
  const nextOrder = (maxOrder ?? -1) + 1;
  await sql`insert into modules (id, name, icon, "order", is_active, created_at, updated_at) values (${id}, ${name}, ${icon}, ${nextOrder}, true, now(), now())`;
  return Response.json({ id, name, icon });
}
