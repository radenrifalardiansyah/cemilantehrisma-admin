'use client';

import { X, Info, ExternalLink } from 'lucide-react';

const APP_VERSION = '0.1.0';

interface Props {
  onClose: () => void;
}

export default function AboutModal({ onClose }: Props) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-sheet modal-sm" onClick={e => e.stopPropagation()}>
        <div className="modal-accent" />
        <span className="modal-handle" />

        <div className="modal-header">
          <div className="modal-header-left">
            <div className="modal-icon"><Info size={17} /></div>
            <div>
              <p className="modal-title">Tentang Aplikasi</p>
              <p className="modal-subtitle">Cemilan Teh Risma · Admin</p>
            </div>
          </div>
          <button onClick={onClose} className="modal-close"><X size={14} /></button>
        </div>

        <div className="modal-body">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <p style={{ fontSize: 12.5, lineHeight: 1.6, color: 'var(--text-secondary)' }}>
              Aplikasi admin untuk mengelola produk, pesanan, stok, keuangan, dan operasional
              toko Cemilan Teh Risma secara terpusat.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 14, borderRadius: 14, background: 'var(--surface-2)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Versi Aplikasi</span>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-primary)' }}>{APP_VERSION}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Diproduksi oleh</span>
                <a
                  href="https://www.eleven-digital.id"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 3, textDecoration: 'none' }}
                >
                  PT. Eleven Digital Indonesia <ExternalLink size={11} />
                </a>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Didukung oleh</span>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-primary)' }}>RMedia Solutions</span>
              </div>
            </div>

            <p style={{ fontSize: 10.5, textAlign: 'center', color: 'var(--text-muted)' }}>
              © 2026 Cemilan Teh Risma. Semua hak dilindungi.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
