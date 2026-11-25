import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({ uiLayoutFails: false, uiLayout: null as string | null, profileFails: false, appearanceFails: false, appearance: null as unknown, pinsFails: false, pins: null as unknown }));

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
vi.mock('@/lib/db', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/db')>()),
  getSql: () => async (strings: TemplateStringsArray) => {
    const text = strings.join('?');
    if (text.includes('select ui_layout')) {
      if (h.uiLayoutFails) throw new Error('column "ui_layout" does not exist');
      return [{ ui_layout: h.uiLayout }];
    }
    if (text.includes('select ui_pins')) {
      if (h.pinsFails) throw new Error('column "ui_pins" does not exist');
      return [{ ui_pins: h.pins }];
    }
    if (text.includes('select ui_appearance')) {
      if (h.appearanceFails) throw new Error('column "ui_appearance" does not exist');
      return [{ ui_appearance: h.appearance }];
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

describe('GET /api/me: user.uiAppearance', () => {
  beforeEach(() => { h.appearanceFails = false; h.appearance = null; h.uiLayoutFails = false; h.uiLayout = null; vi.spyOn(console, 'warn').mockImplementation(() => {}); });
  const valid = { accent: 'blue', wallpaper: 'waves', density: 'compact', textSize: 'large' };

  it('mengembalikan nilai tersimpan', async () => { h.appearance = valid; expect((await call()).user.uiAppearance).toEqual(valid); });
  it('belum memilih: null', async () => { expect((await call()).user.uiAppearance).toBeNull(); });
  it('nilai rusak/field asing di DB: null', async () => {
    h.appearance = { ...valid, extra: 1 }; expect((await call()).user.uiAppearance).toBeNull();
    h.appearance = { accent: 'neon' }; expect((await call()).user.uiAppearance).toBeNull();
  });
  // db.ts (parseJsonb): lewat pooler Supabase kolom jsonb balik sebagai STRING JSON mentah. PUT menulis lewat
  // ${JSON.stringify(x)}::jsonb (postgres.js men-serialisasi ulang untuk OID jsonb), jadi yang terbaca adalah string.
  it('nilai jsonb yang terbaca sebagai string JSON mentah (quirk pooler) tetap di-parse, bukan dianggap belum memilih', async () => {
    h.appearance = JSON.stringify(valid);
    expect((await call()).user.uiAppearance).toEqual(valid);
  });
  it('jsonb terenkode ganda (string di dalam string) tetap di-parse sampai menjadi objek', async () => {
    h.appearance = JSON.stringify(JSON.stringify(valid));
    expect((await call()).user.uiAppearance).toEqual(valid);
  });
  it('string rusak bukan JSON menghasilkan null tanpa membuat /api/me gagal', async () => {
    h.appearance = 'bukan-json';
    expect((await call()).user.uiAppearance).toBeNull();
  });
  it('kolom belum ada: profil lain tetap termuat, uiAppearance null', async () => {
    h.appearanceFails = true;
    const { user } = await call();
    expect(user.uiAppearance).toBeNull();
    expect(user.email).toBe('a@b.c');
  });
});

describe('GET /api/me: user.uiPins', () => {
  beforeEach(() => { h.pinsFails = false; h.pins = null; h.appearanceFails = false; h.appearance = null; vi.spyOn(console, 'warn').mockImplementation(() => {}); });

  it('mengembalikan daftar tersimpan; daftar kosong tetap kosong (bukan null)', async () => {
    h.pins = ['orders', 'dashboard']; expect((await call()).user.uiPins).toEqual(['orders', 'dashboard']);
    h.pins = []; expect((await call()).user.uiPins).toEqual([]);
  });
  it('belum memilih: null', async () => { expect((await call()).user.uiPins).toBeNull(); });
  it('string JSON mentah dan terenkode ganda (quirk pooler) tetap di-parse', async () => {
    h.pins = JSON.stringify(['orders']); expect((await call()).user.uiPins).toEqual(['orders']);
    h.pins = JSON.stringify(JSON.stringify(['orders'])); expect((await call()).user.uiPins).toEqual(['orders']);
  });
  it('nilai rusak: null; id tak dikenal dibuang', async () => {
    h.pins = { a: 1 }; expect((await call()).user.uiPins).toBeNull();
    h.pins = ['orders', 'bukan-tab']; expect((await call()).user.uiPins).toEqual(['orders']);
  });
  it('kolom belum ada: profil lain tetap termuat, uiPins null', async () => {
    h.pinsFails = true;
    const { user } = await call();
    expect(user.uiPins).toBeNull();
    expect(user.email).toBe('a@b.c');
  });
});
