import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
import { notify } from '@/lib/notifications';
import { addDaysWib } from '@/lib/receivable';

// Pengingat harian piutang: dipanggil terjadwal oleh GitHub Actions (.github/workflows/overdue-orders.yml) dan mengirim SATU ringkasan
// notifikasi ke semua admin (lonceng + push HP) kalau ada pesanan kredit yang jatuh tempo hari ini
// atau sudah terlambat. Pengingat ke pelanggan sendiri tetap manual (tombol di menu Pesanan) —
// WhatsApp tidak punya jalur kirim otomatis tanpa layanan berbayar.
// Wajib CRON_SECRET: tanpa itu endpoint ditolak (bukan dibuka), supaya tidak bisa dipicu orang luar.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET ?? '';
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sql = getSql();
  const today = addDaysWib(0);
  const tomorrow = addDaysWib(1);
  const rows = await sql<{ due_date: string; remaining: string }[]>`
    select o.due_date,
      o.total - coalesce((select sum(p.amount) from order_payments p where p.order_id = o.id), 0) as remaining
    from orders o
    where o.payment_status = 'belum_lunas' and o.status != 'dibatalkan' and o.due_date is not null and o.due_date <= ${tomorrow}
  `;

  let overdue = 0, dueToday = 0, dueTomorrow = 0, overdueTotal = 0, dueNowTotal = 0;
  for (const r of rows) {
    const left = Math.max(0, Number(r.remaining) || 0);
    if (left <= 0) continue;
    if (r.due_date < today) { overdue++; overdueTotal += left; dueNowTotal += left; }
    else if (r.due_date === today) { dueToday++; dueNowTotal += left; }
    else { dueTomorrow++; }
  }

  const summary = { overdue, dueToday, dueTomorrow, overdueTotal, notified: false };
  if (overdue + dueToday === 0) return Response.json(summary);

  const parts = [
    overdue > 0 ? `${overdue} terlambat` : '',
    dueToday > 0 ? `${dueToday} jatuh tempo hari ini` : '',
  ].filter(Boolean).join(', ');
  try {
    await notify(getDb(), {
      type: 'order_overdue',
      title: 'Piutang jatuh tempo',
      message: `${parts} — total sisa tagihan Rp${dueNowTotal.toLocaleString('id-ID')}${dueTomorrow > 0 ? ` (+${dueTomorrow} jatuh tempo besok)` : ''}. Buka menu Pesanan › Belum Lunas untuk menagih.`,
      link: 'orders',
      actor: { username: 'sistem', role: 'system' },
    });
    summary.notified = true;
  } catch (err) {
    console.error('Failed to send overdue notification', err);
  }
  return Response.json(summary);
}
