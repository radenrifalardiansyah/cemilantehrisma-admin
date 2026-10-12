#!/usr/bin/env node
// One-time (Produk Toko di Lapak): simpan gudang LAPAK saat dokumen dibuat, supaya pembatalan dokumen membalik stok
// ke gudang yang benar walau "gudang terkait" lapak diganti kemudian. Dokumen lama diisi gudang lapak saat ini. Aman diulang.
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
await sql`alter table stall_shipments add column if not exists stall_warehouse_id text`;
await sql`update stall_shipments sh set stall_warehouse_id = s.warehouse_id from stalls s where s.id = sh.stall_id and sh.stall_warehouse_id is null`;
console.log('OK  stall_shipments.stall_warehouse_id');
await sql.end();
