import React from 'react';
import { renderToBuffer } from '@react-pdf/renderer';
import { unstable_cache } from 'next/cache';
import ShoppingListPDF from './ShoppingListPDF';
import { getServerStoreHeader } from './server-store-header';
import { rowToShoppingItem, type ShoppingItemRow } from '@/lib/material-shopping';
import { buildGroups, buildShoppingPdfData, shoppingPdfGeneratedAt, supplierKeyOf, type ShoppingGroup, type ShoppingItem } from '@/lib/shopping-pdf-data';
import { SHOPPING_PDF_TAG, shoppingPdfTag, supplierHashOf, type ShoppingPdfTarget } from '@/lib/shopping-pdf-link';
import type { getSql } from '@/lib/db';

type Sql = ReturnType<typeof getSql>;

// Render PDF Daftar Belanja di server untuk tautan publik /b/[code]. Daftar BISA berubah, jadi cache server hanya
// singkat (5 menit) dan dibuang saat rute material-shopping menulis (revalidateShoppingPdf).
export const SHOPPING_PDF_TTL_SEC = 300;
export const SHOPPING_PDF_MAX_BYTES = 1_400_000; // base64 < batas 2 MB item cache Next

const hashHex = (t: ShoppingPdfTarget) => (t.supplierHash ? t.supplierHash.toString('hex') : 'all');

const matches = (t: ShoppingPdfTarget, i: ShoppingItem) => !t.supplierHash || supplierHashOf(i).equals(t.supplierHash);

async function loadItems(sql: Sql, t: ShoppingPdfTarget): Promise<ShoppingItem[]> {
  const rows = await sql<ShoppingItemRow[]>`
    select s.*, m.name as material_name, m.unit as material_unit,
           p.wallet_id as purchase_wallet_id, p.payment_status as purchase_payment_status
    from material_shopping_items s join raw_materials m on m.id = s.material_id
    left join material_purchases p on p.id = s.purchase_id
    where s.shopping_date = ${t.date}
    order by s.created_at asc
  `;
  return rows.map(rowToShoppingItem).filter(i => matches(t, i));
}

/** Query ringan di setiap permintaan (sebelum cache): ada atau tidak daftar untuk target ini. */
export async function shoppingListExists(sql: Sql, t: ShoppingPdfTarget): Promise<boolean> {
  const rows = await sql<{ supplier_id: string | null; supplier_name: string | null }[]>`
    select supplier_id, supplier_name from material_shopping_items where shopping_date = ${t.date}
  `;
  return rows.some(r => !t.supplierHash || supplierHashOf({ supplierId: r.supplier_id ?? undefined, supplierName: r.supplier_name ?? '' }).equals(t.supplierHash));
}

interface CachedPdf { b64: string; fileName: string }
class PdfTooBig extends Error {
  constructor(readonly buffer: Buffer, readonly fileName: string) { super('PDF melebihi batas cache'); }
}

async function renderForCache(sql: Sql, t: ShoppingPdfTarget): Promise<CachedPdf> {
  const items = await loadItems(sql, t);
  if (items.length === 0) throw new Error('Daftar belanja kosong.'); // melempar = tidak ter-cache
  const groups: ShoppingGroup[] = buildGroups(items);
  const wallets = await sql<{ id: string; name: string }[]>`select id, name from wallets`;
  const walletNames = Object.fromEntries(wallets.map(w => [w.id, w.name]));
  const data = buildShoppingPdfData(t.date, groups, { no: 0, walletNames, generatedAt: shoppingPdfGeneratedAt(new Date(), 'Asia/Jakarta') });
  const store = await getServerStoreHeader();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buffer = await renderToBuffer(React.createElement(ShoppingListPDF, { data, store }) as any);
  const fileName = `daftar-belanja-${t.date}${t.supplierHash ? `-${supplierKeyOf(items[0]).replace(/[^a-z0-9]+/gi, '-').slice(0, 30)}` : ''}.pdf`;
  if (buffer.length > SHOPPING_PDF_MAX_BYTES) throw new PdfTooBig(buffer, fileName);
  return { b64: buffer.toString('base64'), fileName };
}

export async function shoppingPdfResponse(sql: Sql, t: ShoppingPdfTarget): Promise<Response> {
  const cached = unstable_cache(() => renderForCache(sql, t), ['shopping-pdf', t.date, hashHex(t)], {
    tags: [shoppingPdfTag(t.date), SHOPPING_PDF_TAG],
    revalidate: SHOPPING_PDF_TTL_SEC,
  });
  let bytes: Uint8Array; let fileName: string;
  try {
    const r = await cached();
    bytes = new Uint8Array(Buffer.from(r.b64, 'base64')); fileName = r.fileName;
  } catch (err) {
    if (!(err instanceof PdfTooBig)) throw err;
    bytes = new Uint8Array(err.buffer); fileName = err.fileName;
  }
  return new Response(bytes as BodyInit, {
    status: 200,
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${fileName}"`, 'Cache-Control': 'private, no-store' },
  });
}
