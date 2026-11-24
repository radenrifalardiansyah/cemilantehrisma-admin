import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({ uiLayoutFails: false, uiLayout: null as string | null, profileFails: false }));

vi.mock('@/lib/admin-auth', () => ({
  getAuthUser: vi.fn(() => ({ username: 'rifal', role: 'super-admin' })),
  unauthorized: () => Response.json({}, { status: 401 }),
  signAdminToken: vi.fn(),
}));
vi.mock('@/lib/rbac', () => ({
  getRolePermissionsMap: vi.fn(async () => ({})),
  staleSessionReason: vi.fn(async () => false),
  sessionExpired: () => Response.json({}, { status: 401 }),
  SESSION_TAG: 'x',
}));
vi.mock('@/lib/permissions', () => ({ fullAccessPermissions: () => ({}) }));
vi.mock('@/lib/supabase-admin', () => ({ deriveLoginEmail: vi.fn(), getSupabaseAdmin: vi.fn() }));
vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }));
vi.mock('@/lib/db', () => ({
  getSql: () => async (strings: TemplateStringsArray) => {
    const text = strings.join('?');
    if (text.includes('select ui_layout')) {
      if (h.uiLayoutFails) throw new Error('column "ui_layout" does not exist');
      return [{ ui_layout: h.uiLayout }];
    }
    if (h.profileFails) throw new Error('db down');
    return [{ email: 'a@b.c', avatar: null, full_name: 'Rifal', signature: null }];
  },
}));

import { GET } from './route';

const call = async () => (await GET({} as NextRequest)).json() as Promise<{ user: Record<string, unknown> }>;

describe('GET /api/me: user.uiLayout', () => {
  beforeEach(() => { h.uiLayoutFails = false; h.uiLayout = null; h.profileFails = false; vi.spyOn(console, 'warn').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {}); });

  it('mengembalikan nilai tersimpan', async () => {
    h.uiLayout = 'mac';
    expect((await call()).user.uiLayout).toBe('mac');
  });
  it('belum memilih: null', async () => {
    expect((await call()).user.uiLayout).toBeNull();
  });
  it('nilai rusak di DB: null (bukan diteruskan)', async () => {
    h.uiLayout = 'ngawur';
    expect((await call()).user.uiLayout).toBeNull();
  });
  it('kolom belum ada (migrasi belum jalan): profil lain tetap termuat, uiLayout null', async () => {
    h.uiLayoutFails = true;
    const { user } = await call();
    expect(user.uiLayout).toBeNull();
    expect(user.email).toBe('a@b.c');
    expect(user.fullName).toBe('Rifal');
  });
});
