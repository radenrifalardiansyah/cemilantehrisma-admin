'use client';

import { ShieldAlert } from 'lucide-react';

interface Props {
  reason: string;
  onDismiss: () => void;
}

// Sengaja TIDAK bisa ditutup dengan klik di luar (beda dari modal biasa) — ini pemberitahuan
// sesi mati (kick admin, atau login baru yang disetujui dari sesi ini sendiri), jadi harus
// benar-benar dibaca sebelum kembali ke layar login.
export default function ForceLogoutOverlay({ reason, onDismiss }: Props) {
  return (
    <div className="modal-overlay confirm-overlay" style={{ zIndex: 20000 }}>
      <div className="modal-sheet confirm-sheet modal-sm" style={{ maxWidth: 400 }}>
        <div className="modal-accent" style={{ background: 'var(--danger)' }} />
        <div style={{ padding: '20px 22px 4px', display: 'flex', gap: 14, alignItems: 'flex-start' }}>
          <div className="modal-icon" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}>
            <ShieldAlert size={17} />
          </div>
          <div style={{ flex: 1, minWidth: 0, paddingTop: 2 }}>
            <p className="modal-title">Sesi Anda Berakhir</p>
            <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 5, lineHeight: 1.5 }}>{reason}</p>
          </div>
        </div>
        <div className="modal-footer" style={{ borderTop: 'none', paddingTop: 18 }}>
          <button onClick={onDismiss} className="btn-primary" style={{ flex: 1, justifyContent: 'center', padding: '10px 0' }}>
            Ke Halaman Login
          </button>
        </div>
      </div>
    </div>
  );
}
