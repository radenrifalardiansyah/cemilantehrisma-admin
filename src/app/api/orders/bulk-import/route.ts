import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { validateAdminAuth, unauthorized } from '@/lib/admin-auth';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';

interface ImportRow {
  invoiceNo?: string; date?: string; customerName: string; customerPhone?: string;
  itemsText?: string; subtotal?: number; discount?: number; total: number; status?: string;
}

const BATCH_LIMIT = 400;

function parseDate(v: string): Timestamp | null {
  const trimmed = v.trim();
  if (!trimmed) return null;
  const ddmmyyyy = trimmed.match(/^(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})$/);
  if (ddmmyyyy) {
    const [, d, m, y] = ddmmyyyy;
    const dt = new Date(Number(y), Number(m) - 1, Number(d));
    if (!isNaN(dt.getTime())) return Timestamp.fromDate(dt);
  }
  const dt = new Date(trimmed);
  return isNaN(dt.getTime()) ? null : Timestamp.fromDate(dt);
}

export async function POST(req: NextRequest) {
  if (!validateAdminAuth(req)) return unauthorized();
  const { orders } = await req.json() as { orders: ImportRow[] };
  if (!Array.isArray(orders) || orders.length === 0) {
    return Response.json({ error: 'Tidak ada data pesanan untuk diimpor.' }, { status: 400 });
  }

  const db = getDb();
  const existingSnap = await db.collection('orders').get();
  const existingInvoices = new Set(
    existingSnap.docs.map(d => ((d.data().invoiceNo as string) ?? '').trim()).filter(Boolean),
  );
  const seenInvoices = new Set<string>();

  let created = 0, skippedInvalid = 0, skippedDuplicate = 0;
  let batch = db.batch();
  let opsInBatch = 0;

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

    const ref = db.collection('orders').doc();
    batch.set(ref, {
      invoiceNo,
      date: (row.date ?? '').toString().trim(),
      customerName,
      customerPhone: (row.customerPhone ?? '').toString().trim(),
      items: itemsText ? [{ name: itemsText, weight: '-', qty: 1, price: subtotal, subtotal }] : [],
      subtotal,
      discount: discountAmount > 0 ? { amount: discountAmount, label: 'Diskon' } : null,
      total,
      status: (row.status ?? '').toString().trim() || 'selesai',
      createdAt: parsedDate ?? FieldValue.serverTimestamp(),
    });
    created++;
    opsInBatch++;

    if (opsInBatch >= BATCH_LIMIT) {
      await batch.commit();
      batch = db.batch();
      opsInBatch = 0;
    }
  }
  if (opsInBatch > 0) await batch.commit();

  return Response.json({ created, skippedInvalid, skippedDuplicate });
}
