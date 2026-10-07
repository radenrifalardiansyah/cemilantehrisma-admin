import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { requirePermission, assertCanCreateUser } from '@/lib/rbac';
import { isValidSignatureUrl } from '@/lib/profile-signature';
import { deriveLoginEmail, getSupabaseAdmin } from '@/lib/supabase-admin';

interface ProfileRow { username: string; email: string | null; role: string; created_at: Date; totp_enabled: boolean; full_name: string | null; signature: string | null }

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'users', 'view');
  if (guard instanceof Response) return guard;

  const sql = getSql();
  const rows = await sql<ProfileRow[]>`select username, email, role, created_at, totp_enabled, full_name, signature from profiles order by created_at asc`;
  const users = rows.map(r => ({
    username: r.username, email: r.email, role: r.role, twoFactor: r.totp_enabled,
    fullName: r.full_name ?? '', signature: r.signature ?? '',
    createdAt: { seconds: Math.floor(r.created_at.getTime() / 1000), nanoseconds: 0 },
  }));
  return Response.json({ users });
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'users', 'create');
  if (guard instanceof Response) return guard;

  const { username, password, email, role, fullName, signature } =
    await req.json() as { username: string; password: string; email?: string; role: string; fullName?: string; signature?: string };

  if (!username || !password || !role) {
    return Response.json({ error: 'Username, password, dan role wajib diisi.' }, { status: 400 });
  }

  if (signature?.trim() && !isValidSignatureUrl(signature.trim())) {
    return Response.json({ error: 'Tanda tangan harus berupa gambar hasil upload.' }, { status: 400 });
  }

  const check = assertCanCreateUser(guard, role);
  if (!check.ok) return Response.json({ error: check.error }, { status: 403 });

  const sql = getSql();
  const [roleRow] = await sql`select id from roles where id = ${role}`;
  if (!roleRow) {
    return Response.json({ error: `Role "${role}" tidak ditemukan.` }, { status: 400 });
  }

  const id = username.toLowerCase();
  const [existing] = await sql`select username from profiles where username = ${id}`;
  if (existing) {
    return Response.json({ error: `User "${id}" sudah ada.` }, { status: 409 });
  }

  // Akun baru dibuat langsung di Supabase Auth — password awal yang diset admin di sini wajib
  // diganti sendiri oleh pemiliknya (mustChangePassword).
  const { data, error } = await getSupabaseAdmin().auth.admin.createUser({
    email: deriveLoginEmail(id),
    password,
    email_confirm: true,
  });
  if (error || !data.user) {
    return Response.json({ error: `Gagal membuat akun otentikasi: ${error?.message ?? 'unknown_error'}` }, { status: 500 });
  }

  const cleanEmail = email ? email.trim().toLowerCase() : null;
  await sql`
    insert into profiles (id, username, email, role, must_change_password, full_name, signature, created_at)
    values (${data.user.id}, ${id}, ${cleanEmail}, ${role}, true, ${fullName?.trim().slice(0, 100) || null}, ${signature?.trim() || null}, now())
  `;
  return Response.json({ username: id, email: cleanEmail, role });
}
