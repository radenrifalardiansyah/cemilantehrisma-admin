'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { RefreshCw, Loader2, Save, Wand2, Power } from 'lucide-react';
import QRCode from 'qrcode';
import { useToast } from '@/components/Toast';
import Tooltip from '@/components/Tooltip';
import TopbarPortal from '@/components/TopbarPortal';
import PageLoader from '@/components/PageLoader';
import SearchSelect, { type SearchSelectOption } from '@/components/SearchSelect';
import { useVisiblePolling } from '@/lib/useVisiblePolling';
import { suggestGroup } from '@/lib/wa-forward';
import type { Action } from '@/types/rbac';

interface Overview {
  settings: { enabled: boolean; targetJid: string | null; keywords: string[]; excludeKeywords: string[]; maxPerHour: number; resyncRequested: boolean };
  worker: { online: boolean; desired: boolean; state: string; lastSeen: string | null };
  groups: { jid: string; subject: string }[];
  links: { jid: string; locationId: string; isActive: boolean }[];
  locations: { id: string; name: string; code: string }[];
}
interface LogRow {
  id: string; locationId: string | null; locationName: string; senderName: string; body: string;
  status: 'pending' | 'sent' | 'failed'; error: string | null; receivedAt: string; sentAt: string | null;
}

interface WorkerEvent { id: string; at: string; level: 'info' | 'warn' | 'error'; text: string }

const STATE_LABEL: Record<string, string> = {
  stopped: 'Dimatikan dari admin', open: 'Terhubung', connecting: 'Menyambung…', qr: 'Perlu scan QR', close: 'Terputus', 'logged-out': 'Logout — perlu scan QR ulang', offline: 'Worker mati',
};
const groupOption = (g: { jid: string; subject: string }): SearchSelectOption => ({ value: g.jid, label: g.subject || g.jid });
const fmtTime = (iso: string) => new Date(iso).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

// Teruskan Stok WA: worker WhatsApp (di luar Vercel) membaca grup mitra dan meneruskan pesan stok ke grup kita.
// Halaman ini = status worker, pengaturan, pemasangan grup ↔ mitra, dan riwayat.
export default function WaForwardTab({ creds, can }: { creds: string; can: (a: Action) => boolean }) {
  const toast = useToast();
  const canEdit = can('edit');
  const headers = { 'Content-Type': 'application/json', 'x-admin-auth': creds };
  const [data, setData] = useState<Overview | null>(null);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [events, setEvents] = useState<WorkerEvent[]>([]);
  const [togglingWorker, setTogglingWorker] = useState(false);
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [logFilter, setLogFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [targetJid, setTargetJid] = useState('');
  const [keywords, setKeywords] = useState('');
  const [excludeKeywords, setExcludeKeywords] = useState('');
  const [maxPerHour, setMaxPerHour] = useState('60');
  const [saving, setSaving] = useState(false);
  const [busyLoc, setBusyLoc] = useState<string | null>(null);

  // `toast` berganti identitas tiap toast muncul/hilang; lewat ref supaya `load` tidak ikut berubah (dulu itu memicu muat ulang
  // dan menimpa isian form yang belum disimpan).
  const toastRef = useRef(toast);
  useEffect(() => { toastRef.current = toast; });

  // hydrate = isi ulang kolom form dari server (hanya saat pertama buka & setelah simpan); selain itu isian pengguna dibiarkan.
  const load = useCallback(async (hydrate: boolean) => {
    setLoading(true);
    try {
      const res = await fetch('/api/wa-forward', { headers: { 'x-admin-auth': creds } });
      const d = await res.json();
      if (!res.ok) { toastRef.current.error(d.error ?? 'Gagal memuat.'); return; }
      const o = d as Overview;
      setData(o);
      if (hydrate) {
        setEnabled(o.settings.enabled); setTargetJid(o.settings.targetJid ?? '');
        setKeywords(o.settings.keywords.join(', ')); setExcludeKeywords(o.settings.excludeKeywords.join(', '));
        setMaxPerHour(String(o.settings.maxPerHour));
      }
    } catch { toastRef.current.error('Gagal memuat.'); } finally { setLoading(false); }
  }, [creds]);

  const loadLogs = useCallback(async () => {
    try {
      const q = logFilter ? `?locationId=${encodeURIComponent(logFilter)}` : '';
      const res = await fetch(`/api/wa-forward/log${q}`, { headers: { 'x-admin-auth': creds } });
      const d = await res.json();
      if (res.ok) setLogs(d.logs ?? []);
    } catch { /* riwayat gagal dimuat tidak menghalangi halaman */ }
  }, [creds, logFilter]);

  // Status worker + log kejadian diperbarui otomatis tiap 10 detik (berhenti saat tab tidak terlihat); form pengaturan tidak ikut direset.
  const loadLive = useCallback(async () => {
    try {
      const [ov, ev] = await Promise.all([
        fetch('/api/wa-forward', { headers: { 'x-admin-auth': creds } }),
        fetch('/api/wa-forward/events?limit=100', { headers: { 'x-admin-auth': creds } }),
      ]);
      if (ov.ok) { const o = await ov.json() as Overview; setData(d => d ? { ...d, worker: o.worker } : d); }
      if (ev.ok) setEvents((await ev.json()).events ?? []);
    } catch { /* gagal sesekali tidak mengganggu */ }
  }, [creds]);
  useVisiblePolling(() => { loadLive(); loadLogs(); }, 10_000, [loadLive, loadLogs]);

  // Worker menunggu scan: QR login ditarik tiap 3 detik (QR berganti ±20 dtk) dan digambar di browser.
  const qrActive = canEdit && !!data && data.worker.online && data.worker.state === 'qr';
  const loadQr = useCallback(async () => {
    try {
      const res = await fetch('/api/wa-forward/qr', { headers: { 'x-admin-auth': creds }, cache: 'no-store' });
      const d = await res.json() as { qr?: string | null };
      setQrImage(res.ok && d.qr ? await QRCode.toDataURL(d.qr, { width: 280, margin: 1 }) : null);
    } catch { /* coba lagi pada tarikan berikutnya */ }
  }, [creds]);
  useVisiblePolling(() => { if (qrActive) loadQr(); }, 3_000, [qrActive, loadQr]);

  const toggleWorker = async (on: boolean) => {
    setTogglingWorker(true);
    try {
      const res = await fetch('/api/wa-forward/worker', { method: 'PUT', headers, body: JSON.stringify({ on }) });
      const d = await res.json();
      if (!res.ok) { toast.error(d.error ?? 'Gagal mengubah.'); return; }
      setData(x => x ? { ...x, worker: { ...x.worker, desired: on } } : x);
      toast.success(on ? 'Koneksi dinyalakan. Worker menyambung dalam ±1 menit.' : 'Koneksi dimatikan. Worker berhenti dalam ±1 menit (tetap standby).');
    } catch { toast.error('Gagal mengubah.'); } finally { setTogglingWorker(false); }
  };

  useEffect(() => { load(true); }, [load]);
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
      load(true);
    } catch { toast.error('Gagal menyimpan.'); } finally { setSaving(false); }
  };

  const setLink = async (locationId: string, jid: string) => {
    setBusyLoc(locationId);
    try {
      const res = await fetch('/api/wa-forward/links', { method: 'PUT', headers, body: JSON.stringify({ locationId, jid }) });
      const d = await res.json();
      if (!res.ok) { toast.error(d.error ?? 'Gagal menyimpan pemasangan.'); return; }
      await load(false);
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

  const linkedCount = data.locations.filter(l => linkByLoc.has(l.id)).length;
  const workerOk = data.worker.online && data.worker.state === 'open';

  return (
    <div className="flex flex-col h-full">
      <TopbarPortal>
        <Tooltip label="Muat ulang"><button onClick={() => { load(false); loadLogs(); }} className="btn-ghost p-2"><RefreshCw size={15} /></button></Tooltip>
      </TopbarPortal>
      <div className="flex-1 overflow-y-auto thin-scrollbar">
        <div className="p-4 lg:p-6 animate-fade-up space-y-5">

          {/* 1. Status worker */}
          <Section title="Status Worker" desc="Program WhatsApp yang membaca grup mitra. Harus menyala agar pesan bisa diteruskan."
            action={canEdit && (
              <div className="flex items-center gap-2">
                <button onClick={resync} className="btn-ghost text-xs" style={{ height: 32 }}><RefreshCw size={13} /> Sinkron grup</button>
                <button onClick={() => toggleWorker(!data.worker.desired)} disabled={togglingWorker || !data.worker.online}
                  className={data.worker.desired ? 'btn-ghost text-xs' : 'btn-primary text-xs'} style={{ height: 32 }}>
                  {togglingWorker ? <Loader2 size={13} className="animate-spin" /> : <Power size={13} />} {data.worker.desired ? 'Matikan koneksi' : 'Nyalakan koneksi'}
                </button>
              </div>
            )}>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-4">
              <span className={`badge ${workerOk ? 'badge-green' : data.worker.online ? 'badge-amber' : 'badge-red'}`}>
                {STATE_LABEL[data.worker.state] ?? data.worker.state}
              </span>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                <span style={{ color: 'var(--text-muted)' }}>Terakhir terlihat: </span>{data.worker.lastSeen ? fmtTime(data.worker.lastSeen) : 'belum pernah'}
              </p>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                <span style={{ color: 'var(--text-muted)' }}>Grup terdeteksi: </span>{data.groups.length}
              </p>
            </div>
            {!data.worker.online && (
              <p className="px-5 pb-4 text-xs" style={{ color: 'var(--text-muted)' }}>
                Program worker tidak berjalan di komputer. Tombol nyala/mati hanya berfungsi bila programnya hidup — jalankan dulu dengan <code>npm start</code> di folder wa-worker.
              </p>
            )}
            {data.worker.online && !data.worker.desired && (
              <p className="px-5 pb-4 text-xs" style={{ color: 'var(--text-muted)' }}>Koneksi WhatsApp sedang dimatikan dari admin; worker standby dan tidak meneruskan pesan.</p>
            )}
          </Section>

          {qrActive && (
            <Section title="Tautkan WhatsApp" desc="Worker menunggu login. Scan QR ini dari HP nomor yang akan dipakai.">
              <div className="p-5 flex flex-col md:flex-row items-center gap-6">
                <div className="flex-shrink-0 rounded-xl bg-white p-3 border border-[var(--border)]" style={{ width: 304, height: 304 }}>
                  {qrImage
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={qrImage} alt="QR login WhatsApp" width={280} height={280} />
                    : <div className="w-full h-full flex items-center justify-center"><Loader2 size={22} className="animate-spin" style={{ color: 'var(--text-muted)' }} /></div>}
                </div>
                <ol className="text-sm space-y-2 list-decimal pl-5" style={{ color: 'var(--text-secondary)' }}>
                  <li>Di HP, buka <b>WhatsApp → Perangkat tertaut</b>.</li>
                  <li>Keluarkan perangkat lama bernama “Teruskan Stok WA” atau “Chrome” bila ada.</li>
                  <li>Tekan <b>Tautkan perangkat</b>, lalu arahkan kamera ke QR ini.</li>
                  <li>QR berganti sendiri tiap ±20 detik. Setelah berhasil, status berubah menjadi <b>Terhubung</b>.</li>
                </ol>
              </div>
            </Section>
          )}

          {/* 2. Pengaturan */}
          <Section title="Pengaturan" desc="Pesan dari grup mitra yang memuat kata kunci akan diteruskan ke grup tujuan."
            footer={canEdit && (
              <button onClick={saveSettings} disabled={saving} className="btn-primary text-sm">
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Simpan pengaturan
              </button>
            )}>
            <div className="p-5 space-y-5">
              <div className="flex items-center gap-3">
                <button type="button" role="switch" aria-checked={enabled} disabled={!canEdit} onClick={() => setEnabled(v => !v)}
                  className="relative flex-shrink-0 rounded-full transition-colors disabled:opacity-50"
                  style={{ width: 40, height: 22, background: enabled ? 'var(--accent)' : 'var(--border)' }}>
                  <span className="absolute top-[3px] rounded-full bg-white transition-all" style={{ width: 16, height: 16, left: enabled ? 21 : 3 }} />
                </button>
                <div>
                  <p className="text-sm font-semibold">{enabled ? 'Penerusan pesan aktif' : 'Penerusan pesan nonaktif'}</p>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Matikan kapan saja untuk menghentikan sementara tanpa mematikan worker.</p>
                </div>
              </div>

              <div className="grid gap-5 md:grid-cols-2">
                <div>
                  <label className="field-label">Grup tujuan (grup kita)</label>
                  <SearchSelect value={targetJid} onChange={setTargetJid} disabled={!canEdit} placeholder="— pilih grup —" searchPlaceholder="Cari grup…"
                    options={[{ value: '', label: '— belum dipilih —' }, ...targetOptions.map(groupOption)]} />
                </div>
                <div>
                  <label className="field-label">Maksimal pesan per jam</label>
                  <input className="input text-sm w-full" type="number" min={1} max={600} disabled={!canEdit} value={maxPerHour} onChange={e => setMaxPerHour(e.target.value)} />
                  <p className="text-xs mt-1.5" style={{ color: 'var(--text-muted)' }}>Batas kirim ke grup tujuan; sisanya menunggu jam berikutnya.</p>
                </div>
                <div>
                  <label className="field-label">Kata kunci (pisahkan dengan koma)</label>
                  <textarea className="input text-sm w-full" rows={3} disabled={!canEdit} value={keywords} onChange={e => setKeywords(e.target.value)} placeholder="stok, sisa, mie kremes" />
                  <p className="text-xs mt-1.5" style={{ color: 'var(--text-muted)' }}>Pesan diteruskan bila memuat salah satu kata ini.</p>
                </div>
                <div>
                  <label className="field-label">Kata pengecualian (opsional)</label>
                  <textarea className="input text-sm w-full" rows={3} disabled={!canEdit} value={excludeKeywords} onChange={e => setExcludeKeywords(e.target.value)} placeholder="tolong, tanya" />
                  <p className="text-xs mt-1.5" style={{ color: 'var(--text-muted)' }}>Pesan yang memuat kata ini tidak diteruskan.</p>
                </div>
              </div>
            </div>
          </Section>

          {/* 3. Grup WA per mitra */}
          <Section title="Grup WA per Mitra" desc={`${linkedCount} dari ${data.locations.length} mitra sudah dipasangkan. Mitra tanpa grup WA biarkan “Tidak ada grup”; satu grup hanya untuk satu mitra.`}>
            {data.locations.length === 0 ? (
              <p className="p-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Belum ada mitra.</p>
            ) : (
              <div className="divide-y divide-[var(--border-2)]">
                {data.locations.map(l => {
                  const current = linkByLoc.get(l.id) ?? '';
                  const options = data.groups.filter(g => g.jid === current || (!taken.has(g.jid) && g.jid !== data.settings.targetJid));
                  const suggestion = current ? null : suggestGroup(l.name, options);
                  return (
                    <div key={l.id} className="px-5 py-3 grid gap-2 md:grid-cols-[1fr_minmax(0,420px)] md:items-center">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-semibold">{l.name}</p>
                          {current && <span className="badge badge-green" style={{ fontSize: 10, padding: '1px 6px' }}>Terpasang</span>}
                        </div>
                        {l.code && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{l.code}</p>}
                      </div>
                      <div className="space-y-1.5">
                        <SearchSelect value={current} onChange={jid => setLink(l.id, jid)} disabled={!canEdit || busyLoc === l.id}
                          placeholder="Tidak ada grup" searchPlaceholder="Cari grup…"
                          options={[{ value: '', label: 'Tidak ada grup' }, ...options.map(groupOption)]} />
                        {suggestion && canEdit && (
                          <button className="text-xs flex items-center gap-1.5 font-medium" style={{ color: 'var(--accent)' }} disabled={busyLoc === l.id} onClick={() => setLink(l.id, suggestion)}>
                            <Wand2 size={12} /> Saran: pasang ke “{groupName(suggestion)}”
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Section>

          {/* 4. Log worker */}
          <Section title="Log Worker" desc="Kejadian terbaru dari worker: koneksi, pesan grup yang masuk (diteruskan atau dilewati + alasannya), dan error. Diperbarui otomatis tiap 10 detik.">
            {events.length === 0 ? (
              <p className="p-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Belum ada log dari worker.</p>
            ) : (
              <div className="max-h-[360px] overflow-y-auto thin-scrollbar divide-y divide-[var(--border-2)]">
                {events.map(e => (
                  <div key={e.id} className="px-5 py-1.5 flex gap-3 text-xs">
                    <span className="tabular flex-shrink-0" style={{ color: 'var(--text-muted)' }}>{new Date(e.at).toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hourCycle: 'h23' })}</span>
                    <span className="break-words min-w-0" style={{ color: e.level === 'error' ? 'var(--danger, #DC2626)' : e.level === 'warn' ? '#B45309' : 'var(--text-secondary)' }}>{e.text}</span>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* 5. Riwayat */}
          <Section title="Riwayat Diteruskan" desc="Pesan terbaru yang lolos filter dan dikirim ke grup tujuan."
            action={
              <div className="w-[220px]">
                <SearchSelect value={logFilter} onChange={setLogFilter} placeholder="Semua mitra" searchPlaceholder="Cari mitra…"
                  options={[{ value: '', label: 'Semua mitra' }, ...data.locations.map(l => ({ value: l.id, label: l.name, sublabel: l.code || undefined }))]} />
              </div>
            }>
            {logs.length === 0 ? (
              <p className="p-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Belum ada pesan yang diteruskan.</p>
            ) : (
              <div className="divide-y divide-[var(--border-2)]">
                {logs.map(r => (
                  <div key={r.id} className="px-5 py-3">
                    <div className="flex items-center gap-2 text-xs flex-wrap">
                      <span className="font-semibold text-sm">{r.locationName}</span>
                      <span style={{ color: 'var(--text-muted)' }}>{r.senderName && `${r.senderName} · `}{fmtTime(r.receivedAt)}</span>
                      <span className={`badge ml-auto ${r.status === 'sent' ? 'badge-green' : r.status === 'failed' ? 'badge-red' : 'badge-gray'}`}>
                        {r.status === 'sent' ? 'Terkirim' : r.status === 'failed' ? 'Gagal' : 'Menunggu'}
                      </span>
                    </div>
                    <p className="text-sm mt-1.5 whitespace-pre-wrap break-words" style={{ color: 'var(--text-secondary)' }}>{r.body}</p>
                    {r.error && <p className="text-xs mt-1" style={{ color: 'var(--danger, #DC2626)' }}>{r.error}</p>}
                  </div>
                ))}
              </div>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}

// Kartu bagian: judul + keterangan di kepala (aksi opsional di kanan), isi, dan footer opsional untuk tombol simpan.
function Section({ title, desc, action, footer, children }: {
  title: string; desc?: string; action?: React.ReactNode; footer?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <section className="card">
      <div className="px-5 py-4 flex flex-wrap items-center gap-3 border-b border-[var(--border-2)]">
        <div className="flex-1 min-w-[220px]">
          <h2 className="text-sm font-bold">{title}</h2>
          {desc && <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{desc}</p>}
        </div>
        {action}
      </div>
      {children}
      {footer ? <div className="px-5 py-3 border-t border-[var(--border-2)] flex justify-end" style={{ background: 'var(--surface-2)' }}>{footer}</div> : null}
    </section>
  );
}
