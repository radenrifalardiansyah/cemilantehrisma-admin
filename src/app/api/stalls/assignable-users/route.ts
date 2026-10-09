import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { STALL_ALL_ACCESS_ROLES } from '@/lib/stall-access';

// Daftar akun yang bisa ditugaskan ke lapak. Admin/super-admin tidak ditawarkan (sudah akses semua
// lapak). Endpoint ini ada supaya form Lapak tidak membutuhkan hak 'users' untuk melihat daftar akun.
export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'consign', 'view');
  if (guard instanceof Response) return guard;
  const sql = getSql();
  const rows = await sql<{ username: string; full_name: string | null; role: string }[]>`
    select username, full_name, role from profiles where role not in ${sql(STALL_ALL_ACCESS_ROLES)} order by username
  `;
  return Response.json({ users: rows.map(r => ({ username: r.username, fullName: r.full_name ?? '', role: r.role })) });
}
