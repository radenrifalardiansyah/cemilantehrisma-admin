import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { revalidateTag } from 'next/cache';
import { FieldValue } from 'firebase-admin/firestore';
import { getAuthUser, unauthorized } from '@/lib/admin-auth';
import { getDb } from '@/lib/firebase-admin';
import { getRolePermissionsMap, SESSION_TAG } from '@/lib/rbac';
import { fullAccessPermissions } from '@/lib/permissions';
import { deriveLoginEmail, signInWithPassword, adminSetPassword } from '@/lib/firebase-auth-rest';
import type { Action } from '@/types/rbac';

export async function GET(req: NextRequest) {
  const authUser = getAuthUser(req);
  if (!authUser) return unauthorized();

  const superAdmin = authUser.role === 'super-admin';

  // This route fires on every session restore/refresh for every logged-in user — a login can
  // now succeed via Firebase Auth even with Firestore fully out of quota (see /api/login), but
  // permissions (role_permissions) and profile (users doc) still live in Firestore. Degrade
  // gracefully instead of failing the whole session bootstrap: fail-closed to empty permissions
  // (nothing granted, not "everything") and a blank profile rather than booting the user back
  // to the login screen because Firestore itself is unavailable.
  let permsMap: Record<string, Partial<Record<Action, boolean>>> | null = null;
  let userData: { email?: string | null; avatar?: string | null } | undefined;
  try {
    const db = getDb();
    const [perms, userDoc] = await Promise.all([
      superAdmin ? null : getRolePermissionsMap(authUser.role),
      db.collection('users').doc(authUser.username).get(),
    ]);
    permsMap = perms;
    userData = userDoc.data() as { email?: string | null; avatar?: string | null } | undefined;
  } catch (err) {
    console.error('Firestore unavailable while loading /api/me — degrading gracefully', err);
  }

  const permissions: Record<string, Partial<Record<Action, boolean>>> = superAdmin
    ? fullAccessPermissions()
    : permsMap ?? {};

  const user = { ...authUser, email: userData?.email ?? null, avatar: userData?.avatar ?? null };

  return Response.json({ ok: true, user, superAdmin, permissions });
}

export async function PATCH(req: NextRequest) {
  const authUser = getAuthUser(req);
  if (!authUser) return unauthorized();

  const { email, avatar, currentPassword, newPassword } = await req.json() as {
    email?: string; avatar?: string | null; currentPassword?: string; newPassword?: string;
  };

  const db  = getDb();
  const ref = db.collection('users').doc(authUser.username);

  // Deliberately NOT set unconditionally: a migrated-account password-only change (below)
  // writes to Firebase Auth, not Firestore, and shouldn't require a Firestore write to succeed
  // — that would defeat the whole point of moving auth off Firestore (see /api/login).
  const patch: Record<string, unknown> = {};
  if (email !== undefined) patch.email = email ? email.trim().toLowerCase() : null;
  if (avatar !== undefined) patch.avatar = avatar || null;

  if (newPassword) {
    if (!currentPassword) {
      return Response.json({ error: 'Masukkan password saat ini untuk mengubah password.' }, { status: 400 });
    }

    if (authUser.uid) {
      // Akun sudah dimigrasikan ke Firebase Auth — password aslinya ada di sana, bukan di
      // passwordHash Firestore (yang sudah basi sejak migrasi). Ganti di situ juga.
      const check = await signInWithPassword(deriveLoginEmail(authUser.username), currentPassword);
      if (!check.ok) {
        return Response.json({ error: 'Password saat ini salah.' }, { status: 400 });
      }
      const result = await adminSetPassword(authUser.uid, newPassword, {
        role: authUser.role, username: authUser.username, mustChangePassword: false,
      });
      if (!result.ok) {
        return Response.json({ error: 'Gagal mengubah password. Coba lagi.' }, { status: 500 });
      }
    } else {
      const doc = await ref.get();
      const passwordHash = doc.data()?.passwordHash as string | undefined;
      const valid = passwordHash && await bcrypt.compare(currentPassword, passwordHash);
      if (!valid) {
        return Response.json({ error: 'Password saat ini salah.' }, { status: 400 });
      }
      patch.passwordHash = await bcrypt.hash(newPassword, 10);
    }
  }

  if (Object.keys(patch).length > 0) {
    await ref.update({ ...patch, updatedAt: FieldValue.serverTimestamp() });
  }

  // Password berhasil diganti — sesi manapun yang masih dipegang di perangkat LAIN harus mati di
  // request berikutnya, sama seperti reset password paksa oleh admin (lihat
  // users/[username]/route.ts). Sesi yang sedang dipakai untuk request INI sendiri tetap hidup
  // karena token barunya (di bawah) selalu diterbitkan setelah baris ini — iat-nya otomatis ikut
  // atau lebih baru daripada timestamp ini. Best-effort & terpisah dari `patch` di atas —
  // password akun Firebase Auth sudah benar-benar berhasil diganti di titik ini, jadi kegagalan
  // Firestore di sini (mis. quota habis) tidak boleh membuat responsnya jadi error.
  if (newPassword) {
    try {
      await ref.update({ sessionsInvalidatedAt: Math.floor(Date.now() / 1000) });
      revalidateTag(SESSION_TAG, { expire: 0 });
    } catch (err) {
      console.error('Failed to bump sessionsInvalidatedAt after password change', err);
    }
  }

  // A password change must invalidate the mustChangePassword flag baked into the CALLER'S own
  // token, not just the Firebase Auth custom claims — otherwise the old token (still carrying
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
