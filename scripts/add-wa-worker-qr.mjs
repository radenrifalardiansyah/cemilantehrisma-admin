#!/usr/bin/env node
// One-time (Teruskan Stok WA): kolom QR login sementara — worker mengirim QR terbaru agar bisa di-scan dari halaman admin
// (tanpa membuka http://127.0.0.1:3939 di komputer worker). Dikosongkan saat terhubung. Aman diulang.
// Usage: node scripts/add-wa-worker-qr.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import postgres from 'postgres';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
for (const line of readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^"(.*)"$/, '$1');
}
const sql = postgres(process.env.DIRECT_URL, { prepare: false, max: 1, onnotice: () => {} });
await sql`alter table wa_forward_settings add column if not exists worker_qr text, add column if not exists worker_qr_at timestamptz`;
console.log('OK  columns wa_forward_settings.worker_qr, worker_qr_at');
await sql.end();
