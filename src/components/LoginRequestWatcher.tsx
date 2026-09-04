'use client';

import { useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import type { PendingLoginRequest } from '@/components/chat/ChatWidget';

interface Props {
  request: PendingLoginRequest | null;
  creds: string;
  onForceLogout: (reason: string) => void;
  onResolved: () => void;
}

// Sengaja tidak polling sendiri — `request` datang dari heartbeat chat (lihat ChatWidget.tsx),
// yang memang sudah jalan tiap 60 detik untuk presence. Menambah poll terpisah di sini dulu
// sempat bikin beban Vercel/Supabase 4-6x lipat dari semua polling lain di app ini digabung,
// untuk fitur yang jarang benar-benar terpakai.
export default function LoginRequestWatcher({ request, creds, onForceLogout, onResolved }: Props) {
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [busy, setBusy] = useState(false);

  const respond = async (action: 'approve' | 'reject') => {
    if (!request) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/login-requests/${request.id}/respond`, {
        method: 'POST',
        headers: { 'x-admin-auth': creds, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, reason: action === 'reject' ? rejectReason.trim() || undefined : undefined }),
      });
      if (action === 'approve' && res.ok) {
        onForceLogout(`Anda menyetujui login baru dari perangkat lain (${request.deviceLabel}) — sesi ini logout untuk memberi akses ke perangkat tersebut.`);
        return; // biarkan overlay force-logout yang mengambil alih, jangan reset state lokal dulu
      }
    } finally {
      setBusy(false);
      setRejecting(false);
      setRejectReason('');
      onResolved();
    }
  };

  if (!request) return null;

  return (
    <div className="modal-overlay" style={{ zIndex: 10500 }}>
      <div className="modal-sheet modal-sm" style={{ maxWidth: 400 }} onClick={e => e.stopPropagation()}>
        <div className="modal-accent" />
        <div className="modal-header">
          <div className="modal-header-left">
            <div className="modal-icon"><ShieldAlert size={17} /></div>
            <div>
              <p className="modal-title">Ada Percobaan Login</p>
              <p className="modal-subtitle">Seseorang mencoba masuk ke akun Anda</p>
            </div>
          </div>
        </div>
        <div className="modal-body">
          <div style={{ padding: 14, borderRadius: 14, background: 'var(--surface-2)', display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12.5 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>Perangkat</span>
              <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{request.deviceLabel}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>Alamat IP</span>
              <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{request.ip}</span>
            </div>
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 12, lineHeight: 1.5 }}>
            Kalau Anda terima, sesi Anda di perangkat ini akan langsung logout dan digantikan perangkat
            baru itu. Kalau ini bukan Anda, tolak permintaan ini.
          </p>
          {rejecting && (
            <textarea
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              placeholder="Alasan penolakan (opsional)"
              className="input"
              style={{ marginTop: 10, minHeight: 60, resize: 'none', width: '100%' }}
            />
          )}
        </div>
        <div className="modal-footer">
          {!rejecting ? (
            <>
              <button onClick={() => setRejecting(true)} disabled={busy} className="btn-ghost" style={{ flex: 1, justifyContent: 'center' }}>
                Tolak
              </button>
              <button onClick={() => respond('approve')} disabled={busy} className="btn-primary" style={{ flex: 1, justifyContent: 'center' }}>
                Terima
              </button>
            </>
          ) : (
            <>
              <button onClick={() => setRejecting(false)} disabled={busy} className="btn-ghost" style={{ flex: 1, justifyContent: 'center' }}>
                Batal
              </button>
              <button onClick={() => respond('reject')} disabled={busy} className="btn-primary" style={{ flex: 1, justifyContent: 'center', background: 'var(--danger)' }}>
                Kirim Penolakan
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
