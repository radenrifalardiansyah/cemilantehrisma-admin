import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { getSettings } from '@/lib/settings-pg';
import { normalizePhone, isValidIdMobile } from '@/lib/phone';
import { buildShoppingPdfUrl, supplierHashOf } from '@/lib/shopping-pdf-link';
import { shoppingListExists } from '@/lib/pdf/shopping-pdf-server';

export const runtime = 'nodejs';

// Menyusun tautan PDF publik (/b/<kode>) + nomor WA toko untuk pesan "Kirim WA" Daftar Belanja. Penandatanganan HMAC
// (JWT_SECRET) hanya di server. Body: { date, supplierId?, supplierName? }; tanpa keduanya = gabungan semua supplier.
export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'materials', 'view');
  if (guard instanceof Response) return guard;
  try {
    const body = await req.json().catch(() => ({})) as { date?: string; supplierId?: string; supplierName?: string; allSuppliers?: boolean };
    const date = body.date ?? '';
    const supplierId = body.supplierId?.trim() || undefined;
    const supplierName = (body.supplierName ?? '').trim();
    const perSupplier = !body.allSuppliers;
    const target = { date, supplierHash: perSupplier ? supplierHashOf({ supplierId, supplierName }) : null };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return Response.json({ error: 'Tanggal tidak valid.' }, { status: 400 });
    if (!await shoppingListExists(getSql(), target)) return Response.json({ error: 'Daftar belanja tidak ditemukan.' }, { status: 404 });
    const url = buildShoppingPdfUrl(req.nextUrl.origin, target);
    if (!url) return Response.json({ error: 'Tautan PDF tidak dapat dibuat.' }, { status: 500 });
    const settings = await getSettings() as { whatsapp?: string };
    const raw = settings.whatsapp?.trim() ?? '';
    const phone = raw && isValidIdMobile(raw) ? normalizePhone(raw) : '';
    return Response.json({ url, phone });
  } catch (err) {
    console.error('[material-shopping/pdf-link]', err);
    return Response.json({ error: 'Gagal membuat tautan PDF.' }, { status: 500 });
  }
}
