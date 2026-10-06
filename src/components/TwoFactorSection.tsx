'use client';

import { useEffect, useState } from 'react';
import { Loader2, ShieldCheck, Copy } from 'lucide-react';
import { useToast } from '@/components/Toast';

// Pengaturan autentikasi 2 langkah (aplikasi autentikator) di Profil. Aktifkan: scan QR → ketik kode
// pertama → simpan kode pemulihan (hanya tampil sekali). Matikan/buat ulang kode pemulihan butuh
// kode yang berlaku (atau kode pemulihan).
export default function TwoFactorSection({ creds }: { creds: string }) {
  const toast = useToast();
  const headers = { 'x-admin-auth': creds, 'Content-Type': 'application/json' };
  const [status, setStatus] = useState<{ enabled: boolean; recoveryLeft: number } | null>(null);
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [manage, setManage] = useState<'disable' | 'regenerate' | null>(null);

  useEffect(() => {
    fetch('/api/me/2fa', { headers: { 'x-admin-auth': creds } })
      .then(r => r.json())
      .then((d: { enabled: boolean; recoveryLeft: number }) => setStatus(d))
      .catch(() => setStatus({ enabled: false, recoveryLeft: 0 }));
  }, [creds]);

  const call = async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      const r = await fetch('/api/me/2fa', { method: 'POST', headers, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({})) as Record<string, unknown> & { error?: string };
      if (!r.ok) { toast.error(d.error ?? 'Gagal memproses.'); return null; }
      return d;
    } finally { setBusy(false); }
  };

  const start = async () => {
    const d = await call({ action: 'setup' });
    if (d) { setSetup({ secret: d.secret as string, qr: d.qr as string }); setCode(''); }
  };
  const enable = async () => {
    const d = await call({ action: 'enable', code });
    if (d) {
      setRecoveryCodes(d.recoveryCodes as string[]); setSetup(null); setCode('');
      setStatus({ enabled: true, recoveryLeft: (d.recoveryCodes as string[]).length });
      toast.success('Autentikasi 2 langkah aktif.');
    }
  };
  const confirmManage = async () => {
    if (!manage) return;
    const d = await call({ action: manage, code });
    if (!d) return;
    setCode(''); setManage(null);
    if (manage === 'disable') { setStatus({ enabled: false, recoveryLeft: 0 }); toast.success('Autentikasi 2 langkah dimatikan.'); }
    else { setRecoveryCodes(d.recoveryCodes as string[]); setStatus({ enabled: true, recoveryLeft: (d.recoveryCodes as string[]).length }); }
  };

  const copyCodes = async () => {
    try { await navigator.clipboard.writeText((recoveryCodes ?? []).join('\n')); toast.success('Kode pemulihan disalin.'); }
    catch { toast.error('Gagal menyalin — catat manual.'); }
  };

  if (!status) return <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Memuat…</p>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <p style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
        <ShieldCheck size={13} style={{ display: 'inline', marginRight: 4, verticalAlign: '-2px' }} />
        Status: <strong style={{ color: status.enabled ? 'var(--success)' : 'var(--text-muted)' }}>{status.enabled ? 'Aktif' : 'Belum aktif'}</strong>
        {status.enabled && <span style={{ color: 'var(--text-muted)' }}> · sisa kode pemulihan: {status.recoveryLeft}</span>}
      </p>

      {recoveryCodes && (
        <div className="rounded-xl p-3" style={{ background: 'var(--accent-bg)' }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-dark)', marginBottom: 6 }}>
            Simpan kode pemulihan ini sekarang — hanya tampil sekali. Tiap kode bisa dipakai satu kali jika HP hilang.
          </p>
          <div className="grid grid-cols-2 gap-1 tabular" style={{ fontSize: 13, fontFamily: 'monospace' }}>
            {recoveryCodes.map(c => <span key={c}>{c}</span>)}
          </div>
          <div className="flex gap-2 mt-3">
            <button type="button" onClick={copyCodes} className="btn-ghost text-xs flex items-center gap-1.5"><Copy size={12} /> Salin</button>
            <button type="button" onClick={() => setRecoveryCodes(null)} className="btn-primary text-xs">Sudah saya simpan</button>
          </div>
        </div>
      )}

      {!status.enabled && !setup && (
        <button type="button" onClick={start} disabled={busy} className="btn-primary text-xs self-start flex items-center gap-1.5">
          {busy && <Loader2 size={12} className="animate-spin" />} Aktifkan Autentikasi 2 Langkah
        </button>
      )}

      {setup && (
        <div className="flex flex-col gap-2">
          <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            1. Pasang aplikasi autentikator (Google Authenticator / Authy / Microsoft Authenticator) lalu pindai QR ini.
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={setup.qr} alt="QR autentikasi 2 langkah" width={180} height={180} style={{ borderRadius: 8, background: '#fff' }} />
          <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>Tidak bisa memindai? Ketik kunci ini: <strong style={{ fontFamily: 'monospace' }}>{setup.secret}</strong></p>
          <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>2. Masukkan 6 digit kode yang muncul di aplikasi.</p>
          <div className="flex gap-2">
            <input value={code} onChange={e => setCode(e.target.value)} className="input tabular" placeholder="123456" inputMode="numeric" style={{ maxWidth: 140 }} />
            <button type="button" onClick={enable} disabled={busy || code.replace(/\s/g, '').length < 6} className="btn-primary text-xs">
              {busy ? <Loader2 size={12} className="animate-spin" /> : 'Aktifkan'}
            </button>
            <button type="button" onClick={() => setSetup(null)} className="btn-ghost text-xs">Batal</button>
          </div>
        </div>
      )}

      {status.enabled && !manage && (
        <div className="flex gap-2 flex-wrap">
          <button type="button" onClick={() => { setManage('regenerate'); setCode(''); }} className="btn-ghost text-xs">Buat Ulang Kode Pemulihan</button>
          <button type="button" onClick={() => { setManage('disable'); setCode(''); }} className="btn-ghost text-xs" style={{ color: 'var(--danger)' }}>Matikan</button>
        </div>
      )}

      {manage && (
        <div className="flex flex-col gap-2">
          <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            {manage === 'disable' ? 'Untuk mematikan,' : 'Untuk membuat kode pemulihan baru (kode lama hangus),'} masukkan kode dari aplikasi autentikator (atau satu kode pemulihan).
          </p>
          <div className="flex gap-2">
            <input value={code} onChange={e => setCode(e.target.value)} className="input tabular" placeholder="Kode" style={{ maxWidth: 160 }} />
            <button type="button" onClick={confirmManage} disabled={busy || !code.trim()} className="btn-primary text-xs">
              {busy ? <Loader2 size={12} className="animate-spin" /> : 'Konfirmasi'}
            </button>
            <button type="button" onClick={() => { setManage(null); setCode(''); }} className="btn-ghost text-xs">Batal</button>
          </div>
        </div>
      )}
    </div>
  );
}
