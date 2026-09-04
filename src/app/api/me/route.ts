import { NextRequest } from 'next/server';
import jwt from 'jsonwebtoken';
import { revalidateTag } from 'next/cache';
import { getAuthUser, unauthorized } from '@/lib/admin-auth';
import { getSql } from '@/lib/db';
import { getRolePermissionsMap, staleSessionReason, sessionExpired, SESSION_TAG } from '@/lib/rbac';
import { fullAccessPermissions } from '@/lib/permissions';
import { deriveLoginEmail, getSupabaseAdmin } from '@/lib/supabase-admin';
import type { Action } from '@/types/rbac';

interface ProfileRow { email: string | null; avatar: string | null }

export async function GET(req: NextRequest) {
  const authUser = getAuthUser(req);
  if (!authUser) return unauthorized();
  // Dipanggil di setiap session-restore (lihat applySession di page.tsx) — token yang sudah
  // di-revoke (kick admin, login baru disetujui, role/password diubah) tidak boleh lolos di sini
  // juga, sama seperti requirePermission/requireSuperAdmin/requireAdminOrSuperAdmin.
  const staleReason = await staleSessionReason(authUser);
  if (staleReason !== false) return sessionExpired(staleReason);

  const superAdmin = authUser.role === 'super-admin';

  // This route fires on every session restore/refresh for every logged-in user. Degrade
  // gracefully instead of failing the whole session bootstrap: fail-closed to empty permissions
  // (nothing granted, not "everything") and a blank profile rather than booting the user back
  // to the login screen because Postgres itself is unavailable.
  let permsMap: Record<string, Partial<Record<Action, boolean>>> | null = null;
  let profile: ProfileRow | undefined;
  try {
    const sql = getSql();
    const [perms, [profileRow]] = await Promise.all([
      superAdmin ? null : getRolePermissionsMap(authUser.role),
      sql<ProfileRow[]>`select email, avatar from profiles where username = ${authUser.username}`,
    ]);
    permsMap = perms;
    profile = profileRow;
  } catch (err) {
    console.error('Postgres unavailable while loading /api/me — degrading gracefully', err);
  }

  const permissions: Record<string, Partial<Record<Action, boolean>>> = superAdmin
    ? fullAccessPermissions()
    : permsMap ?? {};

  const user = { ...authUser, email: profile?.email ?? null, avatar: profile?.avatar ?? null };

  return Response.json({ ok: true, user, superAdmin, permissions });
}

export async function PATCH(req: NextRequest) {
  const authUser = getAuthUser(req);
  if (!authUser) return unauthorized();
  const staleReason = await staleSessionReason(authUser);
  if (staleReason !== false) return sessionExpired(staleReason);

  const { email, avatar, currentPassword, newPassword } = await req.json() as {
    email?: string; avatar?: string | null; currentPassword?: string; newPassword?: string;
  };

  const sql = getSql();
  const patch: Record<string, unknown> = {};
  if (email !== undefined) patch.email = email ? email.trim().toLowerCase() : null;
  if (avatar !== undefined) patch.avatar = avatar || null;

  if (newPassword) {
    if (!currentPassword) {
      return Response.json({ error: 'Masukkan password saat ini untuk mengubah password.' }, { status: 400 });
    }
    const admin = getSupabaseAdmin();
    const check = await admin.auth.signInWithPassword({ email: deriveLoginEmail(authUser.username), password: currentPassword });
    if (check.error || !authUser.uid) {
      return Response.json({ error: 'Password saat ini salah.' }, { status: 400 });
    }
    const { error } = await admin.auth.admin.updateUserById(authUser.uid, { password: newPassword });
    if (error) {
      return Response.json({ error: 'Gagal mengubah password. Coba lagi.' }, { status: 500 });
    }
    patch.must_change_password = false;
  }

  if (Object.keys(patch).length > 0) {
    const nextEmail = 'email' in patch ? patch.email as string | null : sql`email`;
    const nextAvatar = 'avatar' in patch ? patch.avatar as string | null : sql`avatar`;
    const nextMustChange = 'must_change_password' in patch ? patch.must_change_password as boolean : sql`must_change_password`;
    await sql`
      update profiles set email = ${nextEmail}, avatar = ${nextAvatar}, must_change_password = ${nextMustChange}, updated_at = now()
      where username = ${authUser.username}
    `;
  }

  // Password berhasil diganti — sesi manapun yang masih dipegang di perangkat LAIN harus mati di
  // request berikutnya, sama seperti reset password paksa oleh admin (lihat
  // users/[username]/route.ts). Sesi yang sedang dipakai untuk request INI sendiri tetap hidup
  // karena token barunya (di bawah) selalu diterbitkan setelah baris ini — iat-nya otomatis ikut
  // atau lebih baru daripada timestamp ini.
  if (newPassword) {
    try {
      await sql`update profiles set sessions_invalidated_at = ${Math.floor(Date.now() / 1000)} where username = ${authUser.username}`;
      revalidateTag(SESSION_TAG, { expire: 0 });
    } catch (err) {
      console.error('Failed to bump sessions_invalidated_at after password change', err);
    }
  }

  // A password change must invalidate the mustChangePassword flag baked into the CALLER'S own
  // token, not just the profile row — otherwise the old token (still carrying
  // mustChangePassword=true) keeps getting rejected by requirePermission/requireSuperAdmin on
  // every request after this one, even though the password was already changed successfully.
  const newToken = newPassword
    ? jwt.sign(
        { username: authUser.username, role: authUser.role, uid: authUser.uid, mustChangePassword: false },
        process.env.JWT_SECRET!,
        { expiresIn: '7d' },
      )
    : undefined;

  return Response.json({ ok: true, email: patch.email ?? null, avatar: patch.avatar ?? null, token: newToken });
}
