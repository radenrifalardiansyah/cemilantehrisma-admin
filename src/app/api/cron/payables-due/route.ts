import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { notify } from '@/lib/notifications';
import { addDaysWib } from '@/lib/receivable';
import { loadPayableRows } from '@/lib/payables-pg';
import { alertMessage, summarizePayables } from '@/lib/payables-core';

// Pengingat harian hutang supplier: dipanggil terjadwal oleh GitHub Actions (.github/workflows/payables-due.yml) dan mengirim
// SATU ringkasan notifikasi ke semua admin (lonceng + push HP) kalau ada hutang pembelian bahan baku yang lewat jatuh tempo,
// jatuh tempo hari ini, atau jatuh tempo dalam 3 hari (H-3). Mengikuti pola cron/overdue-orders (penerima = broadcast ke semua admin).
// Wajib CRON_SECRET: tanpa itu endpoint ditolak (bukan dibuka), supaya tidak bisa dipicu orang luar.
// Dedup ATOMIK: satu dokumen per hari kalender WIB (cronState_payablesDue/{yyyy-mm-dd}) dibuat dengan create() SEBELUM
// mengirim — pemicu serentak hanya satu yang menang. Bila notify gagal, penanda dihapus (agar percobaan ulang bisa jalan)
// dan rute mengembalikan 500. `?force=1` melewati penanda (uji manual).
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET ?? '';
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const rows = await loadPayableRows();
  const summary = summarizePayables(rows);
  const message = alertMessage(summary);
  const result = { ...summary, notified: false, skipped: '' };
  if (!message) return Response.json(result);

  const db = getDb();
  const force = new URL(req.url).searchParams.get('force') === '1';
  const marker = db.collection('cronState_payablesDue').doc(addDaysWib(0));
  if (!force) {
    try {
      await marker.create({ createdAt: new Date().toISOString(), alertCount: summary.alertCount, alertAmount: summary.alertAmount });
    } catch (err) {
      if ((err as { code?: number }).code === 6) return Response.json({ ...result, skipped: 'sudah dikirim hari ini' }); // ALREADY_EXISTS
      console.error('Failed to claim payable due marker', err);
      return Response.json({ error: 'Gagal memeriksa penanda harian.' }, { status: 500 });
    }
  }

  try {
    await notify(db, {
      type: 'payable_due',
      title: 'Hutang supplier jatuh tempo',
      message: `${message} Buka menu Bahan Baku › Hutang Supplier untuk membayar.`,
      link: 'materials',
      actor: { username: 'sistem', role: 'system' },
    });
    result.notified = true;
    return Response.json(result);
  } catch (err) {
    console.error('Failed to send payable due notification', err);
    if (!force) await marker.delete().catch(e => console.error('Failed to release payable due marker', e));
    return Response.json({ ...result, error: 'Gagal mengirim notifikasi.' }, { status: 500 });
  }
}
