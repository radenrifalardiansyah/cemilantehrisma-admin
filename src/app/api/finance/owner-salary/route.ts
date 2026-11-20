import { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/rbac';
import { getSettings, setSettings } from '@/lib/settings-pg';

// "Gaji pemilik per bulan" (nilai wajar tenaga pemilik yang belum dibayarkan/dibukukan sebagai beban) untuk
// Laporan Keuangan: dikurangkan (dibagi rata per hari) dari Laba Bersih supaya terlihat untung/rugi sebenarnya.
// Disimpan di blob settings seperti Saldo Awal; 0 = tidak dihitung. Tidak mengubah data transaksi apa pun.
const KEY = 'financeOwnerSalaryMonthly';
const MAX = 1_000_000_000;

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, ['finance-report', 'dashboard'], 'view');
  if (guard instanceof Response) return guard;
  const v = (await getSettings())[KEY];
  return Response.json({ value: typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0 });
}

export async function PUT(req: NextRequest) {
  const guard = await requirePermission(req, 'finance-report', 'edit');
  if (guard instanceof Response) return guard;
  const { value } = await req.json() as { value?: unknown };
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > MAX) return Response.json({ error: 'Gaji pemilik harus berupa angka 0 atau lebih.' }, { status: 400 });
  await setSettings({ [KEY]: Math.round(n) });
  return Response.json({ ok: true, value: Math.round(n) });
}
