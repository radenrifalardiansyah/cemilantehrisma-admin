'use client';

import { useState, useEffect } from 'react';
import { MessageCircle, Copy, ClipboardList } from 'lucide-react';
import PageLoader from '@/components/PageLoader';
import { useToast } from '@/components/Toast';
import { ModalShell } from '../titip-jual/shared';
import { waLink, stockUpdateMessage, type StockUpdateData } from '@/lib/stall-whatsapp';
import type { PosStall } from './types';

interface Report {
  stall: { id: string; name: string }; lastUpdateAt: string | null; generatedAt: string;
  consignors: { id: string; name: string; products: { id: string; name: string; unit: string; stock: number; sold: number; received: number }[] }[];
}

const when = (iso: string) => new Date(iso).toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }).replace(/\./g, '.');

// Update stok titipan untuk grup WhatsApp penitip: daftar produk per penitip + stok saat ini + terjual/masuk sejak
// update sebelumnya. Teks bisa diedit sebelum dikirim. Menekan Kirim mencatat waktunya sebagai batas update berikutnya.
// Pemakaian: Kasir Lapak. WhatsApp tidak bisa langsung menarget grup lewat tautan — pengguna memilih grupnya di WhatsApp.
export default function StockUpdateModal({ creds, stall, onClose }: { creds: string; stall: PosStall; onClose: () => void }) {
  const toast = useToast();
  const [report, setReport] = useState<Report | null>(null);
  const [failed, setFailed] = useState(false);
  const [includeEmpty, setIncludeEmpty] = useState(true);
  const [skipped, setSkipped] = useState<string[]>([]);   // penitip yang tidak diikutkan
  const [edited, setEdited] = useState<string | null>(null);   // teks yang diedit manual (menggantikan hasil otomatis)
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(`/api/stall-pos/stock-report?stallId=${stall.id}`, { headers: { 'x-admin-auth': creds } })
      .then(r => r.ok ? r.json() as Promise<Report> : null)
      .then(d => { if (alive) { setReport(d); setFailed(!d); } });
    return () => { alive = false; };
  }, [creds, stall.id]);

  const data: StockUpdateData | null = report ? {
    stallName: report.stall.name, generatedAtText: when(report.generatedAt), lastUpdateText: report.lastUpdateAt ? when(report.lastUpdateAt) : null,
    consignors: report.consignors.filter(c => !skipped.includes(c.id)),
  } : null;
  const auto = data ? stockUpdateMessage(data, includeEmpty) : '';
  const text = edited ?? auto;
  const toggle = (id: string) => { setEdited(null); setSkipped(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]); };

  const send = async () => {
    setSending(true);
    // Catat dulu supaya "sejak update sebelumnya" di update berikutnya mulai dari sekarang.
    fetch('/api/stall-pos/stock-report', { method: 'POST', headers: { 'x-admin-auth': creds, 'Content-Type': 'application/json' }, body: JSON.stringify({ stallId: stall.id }) }).catch(() => {});
    window.open(waLink('', text), '_blank', 'noopener');
    toast.success('WhatsApp dibuka — pilih grup penitip lalu kirim.');
    setSending(false);
    onClose();
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); toast.success('Teks disalin.'); }
    catch { toast.error('Gagal menyalin teks.'); }
  };

  return (
    <ModalShell title="Update Stok ke Grup WhatsApp" subtitle={stall.name} icon={<ClipboardList size={17} />} onClose={onClose} size="modal-md"
      footer={(
        <>
          <button onClick={copy} disabled={!report} className="btn-ghost" style={{ flex: 1, justifyContent: 'center', padding: '10px 0' }}><Copy size={14} /> Salin</button>
          <button onClick={send} disabled={!report || sending || !text.trim()} className="btn-primary" style={{ flex: 2, justifyContent: 'center', padding: '10px 0' }}>
            <MessageCircle size={14} /> Kirim ke WhatsApp
          </button>
        </>
      )}>
      {failed ? <p className="text-sm text-center py-8" style={{ color: 'var(--danger)' }}>Gagal memuat data stok.</p> : !report ? <PageLoader /> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {report.lastUpdateAt ? `Update terakhir dikirim ${when(report.lastUpdateAt)}. Terjual dan masuk dihitung sejak saat itu.` : 'Belum pernah ada update — ini update pertama, jadi hanya stok saat ini yang tampil.'}
          </p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
              <input type="checkbox" checked={includeEmpty} onChange={e => { setEdited(null); setIncludeEmpty(e.target.checked); }} /> Ikutkan produk stok 0
            </label>
          </div>
          {report.consignors.length > 1 && (
            <div>
              <p className="field-label">Penitip yang diikutkan</p>
              <div className="flex flex-wrap gap-1.5">
                {report.consignors.map(c => (
                  <button key={c.id} type="button" onClick={() => toggle(c.id)} className="px-3 py-1.5 rounded-lg text-xs font-semibold"
                    style={!skipped.includes(c.id) ? { background: 'var(--accent-bg)', color: 'var(--accent)' } : { background: 'var(--surface-2)', color: 'var(--text-muted)', textDecoration: 'line-through' }}>
                    {c.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div>
            <p className="field-label">Pesan (bisa diedit)</p>
            <textarea className="input" style={{ minHeight: 260, fontFamily: 'ui-monospace, monospace', fontSize: 12, resize: 'vertical' }} value={text} onChange={e => setEdited(e.target.value)} />
            {edited !== null && <button onClick={() => setEdited(null)} className="text-[11px] font-semibold mt-1" style={{ color: 'var(--accent)' }}>Kembalikan teks otomatis</button>}
          </div>
        </div>
      )}
    </ModalShell>
  );
}
