import { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/rbac';
import { getSettings, setSettings } from '@/lib/settings-pg';

// "Saldo Awal" (kas sebelum mulai pakai aplikasi) disimpan di database (blob settings), bukan lagi
// localStorage per-browser — supaya "Saldo Kas Saat Ini" sama di semua perangkat/akun. `value`
// null = belum pernah diset di server (klien boleh memigrasi nilai lama dari localStorage).
const KEY = 'financeSaldoAwal';

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, ['finance-report', 'dashboard'], 'view');
  if (guard instanceof Response) return guard;
  const v = (await getSettings())[KEY];
  return Response.json({ value: typeof v === 'number' && Number.isFinite(v) ? v : null });
}

export async function PUT(req: NextRequest) {
  const guard = await requirePermission(req, 'finance-report', 'edit');
  if (guard instanceof Response) return guard;
  const { value } = await req.json() as { value?: unknown };
  const n = Number(value);
  if (!Number.isFinite(n)) return Response.json({ error: 'Saldo Awal harus berupa angka.' }, { status: 400 });
  await setSettings({ [KEY]: n });
  return Response.json({ ok: true, value: n });
}
