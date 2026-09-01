import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';

interface RoleRow { id: string; name: string; description: string | null; is_system: boolean; created_at: Date; updated_at: Date | null }

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'roles', 'view');
  if (guard instanceof Response) return guard;

  const sql = getSql();
  const rows = await sql<RoleRow[]>`select * from roles order by created_at asc`;
  const toTs = (d: Date | null) => d ? { seconds: Math.floor(d.getTime() / 1000), nanoseconds: 0 } : null;
  const roles = rows.map(r => ({ id: r.id, name: r.name, description: r.description ?? '', isSystem: r.is_system, createdAt: toTs(r.created_at), updatedAt: toTs(r.updated_at) }));
  return Response.json({ roles });
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'roles', 'create');
  if (guard instanceof Response) return guard;

  const { id, name, description } =
    await req.json() as { id: string; name: string; description?: string };

  if (!id || !name) return Response.json({ error: 'ID dan nama role wajib diisi.' }, { status: 400 });
  if (!/^[a-z0-9-]+$/.test(id)) {
    return Response.json({ error: 'ID role hanya boleh huruf kecil, angka, dan tanda hubung.' }, { status: 400 });
  }

  const sql = getSql();
  const [existing] = await sql`select id from roles where id = ${id}`;
  if (existing) {
    return Response.json({ error: `Role dengan ID "${id}" sudah ada.` }, { status: 409 });
  }

  await sql`insert into roles (id, name, description, is_system, created_at, updated_at) values (${id}, ${name}, ${description ?? ''}, false, now(), now())`;
  await sql`insert into role_permissions (role, permissions, updated_at) values (${id}, '{}'::jsonb, now())`;

  return Response.json({ id, name, description: description ?? '' });
}
