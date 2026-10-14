'use client';

import { useEffect, useState, useCallback } from 'react';
import { RefreshCw, Loader2, Save, Wand2, MessageCircle } from 'lucide-react';
import { useToast } from '@/components/Toast';
import Tooltip from '@/components/Tooltip';
import TopbarPortal from '@/components/TopbarPortal';
import PageLoader from '@/components/PageLoader';
import { suggestGroup } from '@/lib/wa-forward';
import type { Action } from '@/types/rbac';

interface Overview {
  settings: { enabled: boolean; targetJid: string | null; keywords: string[]; excludeKeywords: string[]; maxPerHour: number; resyncRequested: boolean };
  worker: { online: boolean; state: string; lastSeen: string | null };
  groups: { jid: string; subject: string }[];
  links: { jid: string; locationId: string; isActive: boolean }[];
  locations: { id: string; name: string; code: string }[];
}
interface LogRow {
  id: string; locationId: string | null; locationName: string; senderName: string; body: string;
  status: 'pending' | 'sent' | 'failed'; error: string | null; receivedAt: string; sentAt: string | null;
}

const STATE_LABEL: Record<string, string> = {
  open: 'Terhubung', connecting: 'Menyambung…', qr: 'Perlu scan QR', close: 'Terputus', 'logged-out': 'Logout — perlu scan QR ulang', offline: 'Worker mati',
};
const fmtTime = (iso: string) => new Date(iso).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

// Teruskan Stok WA: worker WhatsApp (di luar Vercel) membaca grup mitra dan meneruskan pesan stok ke grup kita.
// Halaman ini = status worker, pengaturan, pemasangan grup ↔ mitra, dan riwayat.
export default function WaForwardTab({ creds, can }: { creds: string; can: (a: Action) => boolean }) {
  const toast = useToast();
  const canEdit = can('edit');
  const headers = { 'Content-Type': 'application/json', 'x-admin-auth': creds };
  const [data, setData] = useState<Overview | null>(null);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [logFilter, setLogFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [targetJid, setTargetJid] = useState('');
  const [keywords, setKeywords] = useState('');
  const [excludeKeywords, setExcludeKeywords] = useState('');
  const [maxPerHour, setMaxPerHour] = useState('60');
  const [saving, setSaving] = useState(false);
  const [busyLoc, setBusyLoc] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/wa-forward', { headers: { 'x-admin-auth': creds } });
      const d = await res.json();
      if (!res.ok) { toast.error(d.error ?? 'Gagal memuat.'); return; }
      const o = d as Overview;
      setData(o);
      setEnabled(o.settings.enabled); setTargetJid(o.settings.targetJid ?? '');
      setKeywords(o.settings.keywords.join(', ')); setExcludeKeywords(o.settings.excludeKeywords.join(', '));
      setMaxPerHour(String(o.settings.maxPerHour));
    } catch { toast.error('Gagal memuat.'); } finally { setLoading(false); }
  }, [creds, toast]);

  const loadLogs = useCallback(async () => {
    try {
      const q = logFilter ? `?locationId=${encodeURIComponent(logFilter)}` : '';
      const res = await fetch(`/api/wa-forward/log${q}`, { headers: { 'x-admin-auth': creds } });
      const d = await res.json();
      if (res.ok) setLogs(d.logs ?? []);
    } catch { /* riwayat gagal dimuat tidak menghalangi halaman */ }
  }, [creds, logFilter]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadLogs(); }, [loadLogs]);

  const saveSettings = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/wa-forward/settings', {
        method: 'PUT', headers,
        body: JSON.stringify({ enabled, targetJid, keywords, excludeKeywords, maxPerHour: Number(maxPerHour) }),
      });
      const d = await res.json();
      if (!res.ok) { toast.error(d.error ?? 'Gagal menyimpan.'); return; }
      toast.success('Pengaturan disimpan.');
      load();
    } catch { toast.error('Gagal menyimpan.'); } finally { setSaving(false); }
  };

  const setLink = async (locationId: string, jid: string) => {
    setBusyLoc(locationId);
    try {
      const res = await fetch('/api/wa-forward/links', { method: 'PUT', headers, body: JSON.stringify({ locationId, jid }) });
      const d = await res.json();
      if (!res.ok) { toast.error(d.error ?? 'Gagal menyimpan pemasangan.'); return; }
      await load();
    } catch { toast.error('Gagal menyimpan pemasangan.'); } finally { setBusyLoc(null); }
  };

  const resync = async () => {
    try {
      const res = await fetch('/api/wa-forward/resync', { method: 'POST', headers });
      if (!res.ok) { toast.error('Gagal meminta sinkron.'); return; }
      toast.success('Diminta. Daftar grup diperbarui worker dalam ±1 menit — muat ulang halaman ini setelahnya.');
    } catch { toast.error('Gagal meminta sinkron.'); }
  };

  if (loading && !data) return <PageLoader />;
  if (!data) return <div className="card m-6 py-12 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Data tidak tersedia.</div>;

  const linkByLoc = new Map(data.links.map(l => [l.locationId, l.jid]));
  const taken = new Set(data.links.map(l => l.jid));
  const groupName = (jid: string) => data.groups.find(g => g.jid === jid)?.subject || jid;
  const targetOptions = data.groups.filter(g => !taken.has(g.jid));

  return (
    <div className="flex flex-col h-full">
      <TopbarPortal>
        <Tooltip label="Muat ulang"><button onClick={() => { load(); loadLogs(); }} className="btn-ghost p-2"><RefreshCw size={15} /></button></Tooltip>
      </TopbarPortal>
      <div className="flex-1 overflow-y-auto thin-scrollbar">
        <div className="p-4 lg:p-6 animate-fade-up space-y-4 max-w-4xl">

          <div className="card p-4 flex flex-wrap items-center gap-3">
            <MessageCircle size={18} style={{ color: 'var(--accent)' }} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold">Worker WhatsApp</p>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {data.worker.lastSeen ? `Terakhir terlihat ${fmtTime(data.worker.lastSeen)}` : 'Belum pernah terhubung'} · {data.groups.length} grup terdeteksi
              </p>
            </div>
            <span className={`badge ${data.worker.online && data.worker.state === 'open' ? 'badge-green' : data.worker.online ? 'badge-amber' : 'badge-red'}`}>
              {STATE_LABEL[data.worker.state] ?? data.worker.state}
            </span>
            {canEdit && <button onClick={resync} className="btn-ghost text-xs" style={{ height: 32 }}><RefreshCw size={13} /> Sinkron grup</button>}
          </div>

          <div className="card p-4 space-y-3">
            <p className="section-label">Pengaturan</p>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={enabled} disabled={!canEdit} onChange={e => setEnabled(e.target.checked)} />
              Aktifkan penerusan pesan stok
            </label>
            <div>
              <label className="field-label">Grup tujuan (grup kita)</label>
              <select className="input text-sm w-full" disabled={!canEdit} value={targetJid} onChange={e => setTargetJid(e.target.value)}>
                <option value="">— pilih grup —</option>
                {targetOptions.map(g => <option key={g.jid} value={g.jid}>{g.subject || g.jid}</option>)}
              </select>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="field-label">Kata kunci (pisahkan koma)</label>
                <textarea className="input text-sm w-full" rows={2} disabled={!canEdit} value={keywords} onChange={e => setKeywords(e.target.value)} placeholder="stok, sisa, mie kremes" />
              </div>
              <div>
                <label className="field-label">Kata pengecualian (opsional)</label>
                <textarea className="input text-sm w-full" rows={2} disabled={!canEdit} value={excludeKeywords} onChange={e => setExcludeKeywords(e.target.value)} placeholder="tolong, tanya" />
              </div>
            </div>
            <div className="w-40">
              <label className="field-label">Maks. pesan per jam</label>
              <input className="input text-sm w-full" type="number" min={1} max={600} disabled={!canEdit} value={maxPerHour} onChange={e => setMaxPerHour(e.target.value)} />
            </div>
            {canEdit && (
              <button onClick={saveSettings} disabled={saving} className="btn-primary text-sm">
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Simpan pengaturan
              </button>
            )}
          </div>

          <div className="card overflow-hidden">
            <div className="p-4 pb-2"><p className="section-label">Grup WA per mitra</p>
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Mitra tanpa grup WA biarkan “Tidak ada grup”. Satu grup hanya untuk satu mitra.</p></div>
            {data.locations.length === 0 ? (
              <p className="p-6 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Belum ada mitra.</p>
            ) : (
              <div className="divide-y divide-[var(--border-2)]">
                {data.locations.map(l => {
                  const current = linkByLoc.get(l.id) ?? '';
                  const options = data.groups.filter(g => g.jid === current || (!taken.has(g.jid) && g.jid !== data.settings.targetJid));
                  const suggestion = current ? null : suggestGroup(l.name, options);
                  return (
                    <div key={l.id} className="px-4 py-2.5 flex flex-wrap items-center gap-2">
                      <div className="flex-1 min-w-[160px]">
                        <p className="text-sm font-medium">{l.name}</p>
                        {l.code && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{l.code}</p>}
                      </div>
                      {suggestion && canEdit && (
                        <button className="btn-ghost text-xs" style={{ height: 30 }} disabled={busyLoc === l.id} onClick={() => setLink(l.id, suggestion)}>
                          <Wand2 size={12} /> {groupName(suggestion)}
                        </button>
                      )}
                      <select className="input text-sm" style={{ width: 240, height: 34 }} disabled={!canEdit || busyLoc === l.id} value={current} onChange={e => setLink(l.id, e.target.value)}>
                        <option value="">Tidak ada grup</option>
                        {options.map(g => <option key={g.jid} value={g.jid}>{g.subject || g.jid}</option>)}
                      </select>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="card overflow-hidden">
            <div className="p-4 pb-2 flex flex-wrap items-center gap-2">
              <p className="section-label flex-1">Riwayat diteruskan</p>
              <select className="input text-xs" style={{ height: 30, width: 200 }} value={logFilter} onChange={e => setLogFilter(e.target.value)}>
                <option value="">Semua mitra</option>
                {data.locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
            {logs.length === 0 ? (
              <p className="p-6 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Belum ada pesan yang diteruskan.</p>
            ) : (
              <div className="divide-y divide-[var(--border-2)]">
                {logs.map(r => (
                  <div key={r.id} className="px-4 py-2.5">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="font-semibold">{r.locationName}</span>
                      <span style={{ color: 'var(--text-muted)' }}>{r.senderName && `${r.senderName} · `}{fmtTime(r.receivedAt)}</span>
                      <span className={`badge ml-auto ${r.status === 'sent' ? 'badge-green' : r.status === 'failed' ? 'badge-red' : 'badge-gray'}`}>
                        {r.status === 'sent' ? 'Terkirim' : r.status === 'failed' ? 'Gagal' : 'Menunggu'}
                      </span>
                    </div>
                    <p className="text-sm mt-1 whitespace-pre-wrap break-words">{r.body}</p>
                    {r.error && <p className="text-xs mt-1" style={{ color: 'var(--danger, #DC2626)' }}>{r.error}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
