'use client';

import { Maximize, Minimize } from 'lucide-react';

// Tombol layar penuh browser di tray taskbar (Windows) / menu bar (Mac). Flat seperti tombol chat/bel. Tidak dirender bila tak didukung.
export default function FullscreenButton({ supported, isFullscreen, onToggle }: { supported: boolean; isFullscreen: boolean; onToggle: () => void }) {
  if (!supported) return null;
  const label = isFullscreen ? 'Keluar dari layar penuh' : 'Layar penuh';
  return (
    <button type="button" className="dsk-fs-btn" aria-label={label} title={label} aria-pressed={isFullscreen} onClick={onToggle}>
      {isFullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
    </button>
  );
}
