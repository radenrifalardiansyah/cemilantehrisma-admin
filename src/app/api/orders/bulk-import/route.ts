import { NextRequest } from 'next/server';
import { randomUUID } from 'crypto';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logHistory } from '@/lib/history';

interface ImportRow {
  invoiceNo?: string; date?: string; customerName: string; customerPhone?: string;
  itemsText?: string; subtotal?: number; discount?: number; total: number; status?: string;
}

function parseDate(v: string): Date | null {
  const trimmed = v.trim();
  if (!trimmed) return null;
  const ddmmyyyy = trimmed.match(/^(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})$/);
  if (ddmmyyyy) {
    const [, d, m, y] = ddmmyyyy;
    const dt = new Date(Number(y), Number(m) - 1, Number(d));
    if (!isNaN(dt.getTime())) return dt;
  }
  const dt = new Date(trimmed);
  return isNaN(dt.getTime()) ? null : dt;
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'orders', 'create');
  if (guard instanceof Response) return guard;
  const { orders } = await req.json() as { orders: ImportRow[] };
  if (!Array.isArray(orders) || orders.length === 0) {
    return Response.json({ error: 'Tidak ada data pesanan untuk diimpor.' }, { status: 400 });
  }

  const db = getDb();
  const sql = getSql();
  // Impor massal tidak menyentuh stok (item hanya teks bebas, tanpa productId) — insert biasa,
  // tanpa transaksi, sama seperti checkout storefront.
  const existingRows = await sql<{ invoice_no: string }[]>`select invoice_no from orders where invoice_no is not null`;
  const existingInvoices = new Set(existingRows.map(r => r.invoice_no.trim()).filter(Boolean));
  const seenInvoices = new Set<string>();

  let created = 0, skippedInvalid = 0, skippedDuplicate = 0;

  for (let i = 0; i < orders.length; i++) {
    const row = orders[i];
    const customerName = (row.customerName ?? '').toString().trim();
    const total = Number(row.total) || 0;
    if (!customerName || total <= 0) { skippedInvalid++; continue; }

    let invoiceNo = (row.invoiceNo ?? '').toString().trim();
    if (invoiceNo && (existingInvoices.has(invoiceNo) || seenInvoices.has(invoiceNo))) {
      skippedDuplicate++; continue;
    }
    if (!invoiceNo) invoiceNo = `IMP-${Date.now()}-${i}`;
    seenInvoices.add(invoiceNo);

    const subtotal = Number(row.subtotal) || total;
    const discountAmount = Number(row.discount) || 0;
    const itemsText = (row.itemsText ?? '').toString().trim();
    const parsedDate = parseDate((row.date ?? '').toString());
    const items = itemsText ? [{ name: itemsText, weight: '-', qty: 1, price: subtotal, subtotal }] : [];
    const discount = discountAmount > 0 ? { amount: discountAmount, label: 'Diskon' } : null;

    await sql`
      insert into orders (
        id, invoice_no, date, customer_name, customer_phone, items, subtotal, discount, total, status, source, created_at
      ) values (
        ${randomUUID()}, ${invoiceNo}, ${(row.date ?? '').toString().trim()},
        ${customerName}, ${(row.customerPhone ?? '').toString().trim()},
        ${JSON.stringify(items)}, ${subtotal}, ${discount ? JSON.stringify(discount) : null}, ${total},
        ${(row.status ?? '').toString().trim() || 'selesai'}, 'kasir',
        ${parsedDate ?? new Date()}
      )
    `;
    created++;
  }

  try {
    await logHistory(db, {
      entity: 'orders', entityId: `bulk-${Date.now()}`,
      entityLabel: `Impor massal ${created} pesanan`,
      action: 'create', actor: guard,
      meta: { bulk: true, createdCount: created, rowCount: orders.length, skipped: skippedInvalid + skippedDuplicate },
    });
  } catch (err) {
    console.error('Gagal menulis audit log impor massal pesanan:', err);
  }

  return Response.json({ created, skippedInvalid, skippedDuplicate });
}
