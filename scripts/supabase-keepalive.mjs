#!/usr/bin/env node
// Ping database supaya project Supabase (free tier) tidak di-pause karena 7 hari tanpa aktivitas,
// lalu catat hasilnya (sukses/gagal) ke menu notifikasi in-app (koleksi Firestore `notifications`,
// lihat src/lib/notifications.ts) supaya admin tahu cron-nya jalan tanpa perlu cek GitHub Actions.
// Dipanggil oleh .github/workflows/supabase-keepalive.yml tiap minggu.
import postgres from 'postgres';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

async function pingDatabase() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL tidak di-set (perlu GitHub secret DATABASE_URL)');
  }

  const sql = postgres(connectionString, { prepare: false, max: 1 });
  try {
    const [{ now }] = await sql`select now()`;
    return now;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function writeNotification({ title, message }) {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    console.warn('FIREBASE_SERVICE_ACCOUNT tidak di-set — lewati catat notifikasi in-app.');
    return;
  }

  const app = getApps().length ? getApps()[0] : initializeApp({ credential: cert(JSON.parse(raw)) });
  const db = getFirestore(app);
  await db.collection('notifications').add({
    type: 'system',
    title,
    message,
    link: null,
    entityCollection: null,
    entityId: null,
    actorUsername: 'system',
    actorRole: 'cron',
    readBy: [],
    createdAt: FieldValue.serverTimestamp(),
  });
}

async function main() {
  try {
    const now = await pingDatabase();
    console.log(`Supabase keepalive OK — ${now}`);
    await writeNotification({
      title: 'Supabase keepalive sukses',
      message: `Ping database berhasil pada ${now}.`,
    });
  } catch (err) {
    console.error('Supabase keepalive gagal:', err);
    await writeNotification({
      title: 'Supabase keepalive GAGAL',
      message: `Ping database gagal: ${err instanceof Error ? err.message : String(err)}`,
    }).catch((notifyErr) => console.error('Gagal catat notifikasi kegagalan:', notifyErr));
    process.exit(1);
  }
}

main();
