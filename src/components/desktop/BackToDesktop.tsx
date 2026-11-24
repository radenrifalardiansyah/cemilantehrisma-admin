'use client';

import { MonitorUp } from 'lucide-react';

// Chip melayang di kerangka Klasik SEMENTARA (menu yang belum berjendela dibuka dari mode Desktop).
// Gaya inline karena desktop.css hanya dimuat bersama DesktopShell.
export default function BackToDesktop({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="hidden lg:flex items-center gap-2"
      style={{
        position: 'fixed', right: 20, bottom: 76, zIndex: 44, height: 38, padding: '0 14px 0 12px', borderRadius: 999,
        border: '1px solid var(--accent)', background: 'var(--accent)', color: '#fff', fontSize: 12, fontWeight: 800,
        boxShadow: '0 8px 24px rgba(0,0,0,0.28)', cursor: 'pointer',
      }}>
      <MonitorUp size={15} /> Kembali ke mode Desktop
    </button>
  );
}
