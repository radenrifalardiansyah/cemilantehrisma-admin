import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import postgres from 'postgres';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
function loadEnvLocal() {
  const content = readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
  for (const line of content.split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) process.env[m[1]] ??= m[2].replace(/^"(.*)"$/, '$1');
  }
}
loadEnvLocal();
const sql = postgres(process.env.DIRECT_URL, { prepare: false, max: 3 });

const ids = ['mk-pdas-150', 'mk-ori-150', 'NrLK4gFF0gQr81Yt3KjF', 'Fj3ix8FZucBIdiwMIiLh'];
const prods = await sql`select id, name, stock_qty from products where id in ${sql(ids)}`;
const warehouses = await sql`select id, name from warehouses`;
const whName = new Map(warehouses.map(w => [w.id, w.name]));
const ws = await sql`select product_id, warehouse_id, stock_qty from warehouse_stock where product_id in ${sql(ids)}`;

console.log('=== per product: global stock_qty vs sum(warehouse_stock) ===');
for (const p of prods) {
  const rows = ws.filter(w => w.product_id === p.id);
  const sum = rows.reduce((s, r) => s + Number(r.stock_qty), 0);
  console.log(p.name, '| products.stock_qty =', p.stock_qty, '| sum(warehouse_stock) =', sum, rows.map(r => `${whName.get(r.warehouse_id)}:${r.stock_qty}`).join(', '), p.stock_qty != sum ? '<<< MISMATCH' : '');
}

await sql.end();
