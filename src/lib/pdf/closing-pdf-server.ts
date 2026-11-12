import React from 'react';
import { renderToBuffer } from '@react-pdf/renderer';
import ClosingReportPDF from './ClosingReportPDF';
import { getServerStoreHeader } from './server-store-header';
import type { ClosingPdfData } from './closing-pdf-data';

// Render PDF Closing HPP di server. Rute pemanggil sudah lolos requirePermission (butuh header auth),
// jadi respons TIDAK boleh di-cache bersama (private, no-store) — beda dengan nota publik berbasis token.
export async function closingPdfResponse(data: ClosingPdfData): Promise<Response> {
  const store = await getServerStoreHeader();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buffer = await renderToBuffer(React.createElement(ClosingReportPDF, { data, store }) as any);
  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${data.fileName}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
