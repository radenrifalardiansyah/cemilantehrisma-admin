import React from 'react';
import { renderToBuffer } from '@react-pdf/renderer';
import { unstable_cache } from 'next/cache';
import ClosingReportPDF from './ClosingReportPDF';
import { getServerStoreHeader } from './server-store-header';
import { closingToPdfData, type ClosingPdfData, type ClosingRecord } from './closing-pdf-data';
import { loadClosingLines } from '@/lib/closing';
import { CLOSING_PDF_TAG, closingPdfTag, isPubliclyShareableClosing } from '@/lib/closing-wa';
import type { getSql } from '@/lib/db';

type Sql = ReturnType<typeof getSql>;

// Render PDF Closing HPP di server. Rute pemanggil sudah lolos requirePermission (butuh header auth) atau token HMAC,
// jadi respons TIDAK boleh di-cache bersama (private, no-store). Yang di-cache hanya BYTE PDF di sisi server (lihat bawah).
const pdfResponse = (bytes: Uint8Array | null, fileName: string, status = 200) => new Response(bytes as BodyInit | null, {
  status,
  headers: {
    'Content-Type': 'application/pdf',
    'Content-Disposition': `inline; filename="${fileName}"`,
    'Cache-Control': 'private, no-store',
  },
});

async function renderClosingPdf(data: ClosingPdfData): Promise<Buffer> {
  const store = await getServerStoreHeader();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return renderToBuffer(React.createElement(ClosingReportPDF, { data, store }) as any);
}

export async function closingPdfResponse(data: ClosingPdfData): Promise<Response> {
  return pdfResponse(new Uint8Array(await renderClosingPdf(data)), data.fileName);
}

// ── Cache server byte PDF closing resmi ─────────────────────────────────────
// Closing 'aktif' (non-saldo-awal) terkunci: transaksinya tidak bisa diubah, jadi PDF-nya tetap. Render react-pdf
// adalah bagian termahal (CPU/durasi + query baris + baca logo), maka hasilnya disimpan di cache data Next
// (unstable_cache; kunci per closing id, tag `closing-pdf:${id}` + `closing-pdf` global untuk perubahan header toko).
// Bentuk tersimpan base64 (JSON-serializable). Kalau melebihi batas, TIDAK di-cache (cached fn melempar PdfTooBig
// yang membawa buffer, supaya tidak render dua kali).
// Keamanan: status closing SELALU dicek lewat satu query ringan di luar cache (getClosingStatus) — dibuka_ulang
// langsung 404 walau cache masih ada; reopen juga membuang tag-nya.
export const CLOSING_PDF_MAX_BYTES = 1_400_000; // base64 ≈ 1,87 MB, di bawah batas 2 MB item cache Next
const CLOSING_PDF_TTL_SEC = 24 * 3600; // jaring pengaman (mis. logo/header berubah di instance lain)

class PdfTooBig extends Error {
  constructor(readonly buffer: Buffer, readonly fileName: string) { super('PDF melebihi batas cache'); }
}

interface CachedPdf { b64: string; fileName: string }

async function renderForCache(sql: Sql, id: string): Promise<CachedPdf> {
  const data = await loadClosingPdfData(sql, id, { publicOnly: true });
  if (!data) throw new Error('Closing tidak lagi dapat dibagikan.'); // melempar = tidak ter-cache
  const buffer = await renderClosingPdf(data);
  if (buffer.length > CLOSING_PDF_MAX_BYTES) throw new PdfTooBig(buffer, data.fileName);
  return { b64: buffer.toString('base64'), fileName: data.fileName };
}

// Query ringan (satu baris, dua kolom) — dijalankan di SETIAP permintaan, sebelum cache.
export type ClosingStatusRow = { status: string; is_opening_balance: boolean };
export async function getClosingStatus(sql: Sql, id: string): Promise<ClosingStatusRow | null> {
  const [row] = await sql<ClosingStatusRow[]>`select status, is_opening_balance from closings where id = ${id}`;
  return row ?? null;
}

// PDF closing resmi aktif lewat cache. Pemanggil WAJIB sudah memastikan status shareable (getClosingStatus).
export async function closingPdfFromCache(sql: Sql, id: string): Promise<{ bytes: Uint8Array; fileName: string }> {
  const cached = unstable_cache(() => renderForCache(sql, id), ['closing-pdf', id], {
    tags: [closingPdfTag(id), CLOSING_PDF_TAG],
    revalidate: CLOSING_PDF_TTL_SEC,
  });
  try {
    const { b64, fileName } = await cached();
    return { bytes: new Uint8Array(Buffer.from(b64, 'base64')), fileName };
  } catch (err) {
    if (err instanceof PdfTooBig) return { bytes: new Uint8Array(err.buffer), fileName: err.fileName };
    throw err;
  }
}

// Satu pintu untuk dua rute. null = 404. Publik: hanya closing shareable. Terautentikasi: perilaku lama
// (closing apa pun yang ada); hanya yang shareable memakai cache, sisanya render langsung seperti sebelumnya.
export async function serveClosingPdf(sql: Sql, id: string, opts: { publicOnly?: boolean; status?: ClosingStatusRow | null } = {}): Promise<Response | null> {
  // `status` bisa disuplai pemanggil yang sudah menanyakannya (hindari query ganda).
  const row = opts.status !== undefined ? opts.status : await getClosingStatus(sql, id);
  if (!row) return null;
  if (isPubliclyShareableClosing(row)) {
    const { bytes, fileName } = await closingPdfFromCache(sql, id);
    return pdfResponse(bytes, fileName);
  }
  if (opts.publicOnly) return null;
  const data = await loadClosingPdfData(sql, id);
  return data ? closingPdfResponse(data) : null;
}

// Data PDF sebuah closing (dipakai rute terautentikasi DAN rute publik — satu sumber render).
// null = tidak ada; `publicOnly` juga menganggap null untuk closing yang bukan 'aktif' / saldo awal.
export async function loadClosingPdfData(sql: Sql, id: string, opts: { publicOnly?: boolean } = {}): Promise<ClosingPdfData | null> {
  const [closing] = await sql<ClosingRecord[]>`select * from closings where id = ${id}`;
  if (!closing) return null;
  if (opts.publicOnly && !isPubliclyShareableClosing(closing)) return null;
  // Saldo awal tidak punya rincian nominal; closing yang dibuka ulang sudah kehilangan closing_id di barisnya.
  const lines = closing.is_opening_balance ? [] : await loadClosingLines(sql, id);
  return closingToPdfData(closing, lines);
}
