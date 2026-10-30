'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { pdf } from '@react-pdf/renderer';
import { PdfIcon } from '@/components/FileTypeIcons';
import { useToast } from '@/components/Toast';
import AnalyticsReportPDF, { type AnalyticsReportData } from '@/lib/pdf/AnalyticsReportPDF';
import { useStoreHeader } from '@/lib/pdf/useStoreHeader';

// Tombol "PDF" yang dipakai semua halaman Analitik. `build` dipanggil saat diklik (null = belum ada data).
export default function AnalyticsPdfButton({ creds, build, filename, disabled }: {
  creds: string; build: () => AnalyticsReportData | null; filename: string; disabled?: boolean;
}) {
  const toast = useToast();
  const storeHeader = useStoreHeader(creds);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    const data = build();
    if (!data) { toast.error('Belum ada data untuk diexport.'); return; }
    setBusy(true);
    try {
      const blob = await pdf(<AnalyticsReportPDF data={data} store={storeHeader} />).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success('Berhasil export ke PDF.');
    } catch {
      toast.error('Gagal membuat file PDF.');
    } finally { setBusy(false); }
  };

  return (
    <button onClick={run} disabled={disabled || busy} aria-label="Download PDF" title="Download PDF"
      className="px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 disabled:opacity-40"
      style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }}>
      {busy ? <Loader2 size={13} className="animate-spin" /> : <PdfIcon size={13} />} PDF
    </button>
  );
}
