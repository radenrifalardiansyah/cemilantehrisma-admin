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
    <div className="modal-overlay" style={{ zIndex: 20000 }}>
      <div className="modal-sheet modal-sm" style={{ maxWidth: 400 }}>
        <div className="modal-accent" style={{ background: 'var(--danger)' }} />
        <div style={{ padding: '24px 22px 4px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 12 }}>
          <div className="modal-icon" style={{ background: 'var(--danger-bg)', color: 'var(--danger)', width: 44, height: 44 }}>
            <ShieldAlert size={20} />
          </div>
          <p className="modal-title">Sesi Anda Berakhir</p>
          <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.6 }}>{reason}</p>
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
