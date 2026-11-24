'use client';

import { Maximize, Minimize } from 'lucide-react';
import { useFullscreen } from '@/lib/use-fullscreen';

// Tombol layar penuh browser di header Klasik (>= lg, di samping bel notifikasi). Gaya mengikuti tombol bel/header Klasik
// (kotak 36px berborder, latar --surface-2). Tidak dirender bila peramban tak mendukung Fullscreen API. Ukuran tetap saat ikon berganti.
export default function ClassicFullscreenButton() {
  const { supported, isFullscreen, toggle } = useFullscreen();
  if (!supported) return null;
  const label = isFullscreen ? 'Keluar dari layar penuh' : 'Layar penuh';
  return (
    <button
      type="button" onClick={() => { void toggle(); }} aria-label={label} title={label} aria-pressed={isFullscreen}
      className="hidden lg:flex items-center justify-center h-9 w-9 rounded-lg transition-colors flex-shrink-0"
      style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
    >
      {isFullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
    </button>
  );
}
