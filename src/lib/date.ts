// Tanggal 'from'/'to' dari UI (Laporan Keuangan, dsb) adalah string yyyy-mm-dd yang mewakili hari
// kalender WIB (Asia/Jakarta, UTC+7) — bukan UTC. Server bisa saja jalan di zona waktu UTC (default
// banyak platform hosting), jadi `new Date(\`${d}T00:00:00\`)` tanpa offset akan salah geser ~7 jam.
// Pakai offset eksplisit +07:00 di sini supaya hasilnya sama persis di TZ server manapun.
import { Timestamp } from 'firebase-admin/firestore';

export function wibDayStart(dateStr: string): Timestamp {
  return Timestamp.fromDate(new Date(`${dateStr}T00:00:00+07:00`));
}

export function wibDayEnd(dateStr: string): Timestamp {
  return Timestamp.fromDate(new Date(`${dateStr}T23:59:59.999+07:00`));
}
