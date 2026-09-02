#!/usr/bin/env node
// Read-only: cek baris "yatim" (nilai kolom relasi tidak punya pasangan di tabel induk)
// untuk tiap kandidat foreign key sebelum ALTER TABLE ADD CONSTRAINT dijalankan.
// Usage: node scripts/check-fk-orphans.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import postgres from 'postgres';
import { CANDIDATES } from './fk-candidates.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadEnvLocal() {
  const envPath = path.join(__dirname, '..', '.env.local');
  const content = readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) process.env[match[1]] ??= match[2].replace(/^"(.*)"$/, '$1');
  }
}

async function main() {
  loadEnvLocal();
  const sql = postgres(process.env.DIRECT_URL, { prepare: false, max: 3 });

  const results = [];
  for (const c of CANDIDATES) {
    try {
      const [{ orphans }] = await sql.unsafe(`
        select count(*)::int as orphans
        from ${c.table} child
        where child.${c.column} is not null
          and not exists (
            select 1 from ${c.refTable} parent where parent.${c.refColumn} = child.${c.column}
          )
      `);
      results.push({ ...c, orphans, error: null });
    } catch (err) {
      results.push({ ...c, orphans: null, error: err.message });
    }
  }

  const clean = results.filter((r) => r.orphans === 0);
  const dirty = results.filter((r) => r.orphans > 0);
  const errored = results.filter((r) => r.error);

  console.log(`\n=== Bersih (${clean.length}) — siap di-FK-kan ===`);
  for (const r of clean) console.log(`  OK   ${r.table}.${r.column} -> ${r.refTable}.${r.refColumn}`);

  console.log(`\n=== Ada data yatim (${dirty.length}) — perlu keputusan sebelum FK ===`);
  for (const r of dirty) console.log(`  X    ${r.table}.${r.column} -> ${r.refTable}.${r.refColumn}  (${r.orphans} baris yatim)`);

  console.log(`\n=== Error saat cek (${errored.length}) — kemungkinan tabel/kolom tidak ada ===`);
  for (const r of errored) console.log(`  ERR  ${r.table}.${r.column} -> ${r.refTable}.${r.refColumn}  :: ${r.error}`);

  await sql.end();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
