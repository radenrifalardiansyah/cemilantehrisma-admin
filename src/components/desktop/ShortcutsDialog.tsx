'use client';

import { Keyboard, X } from 'lucide-react';
import Modal from '@/components/Modal';
import { SHORTCUTS } from './use-desktop-shortcuts';

// Daftar pintasan keyboard mode Desktop (dibuka dari menu klik kanan wallpaper). Esc / klik di luar menutup.
export default function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal onClose={onClose} className="modal-sm">
      <div className="modal-accent" />
      <span className="modal-handle" />
      <div className="modal-header">
        <div className="modal-header-left">
          <div className="modal-icon"><Keyboard size={17} /></div>
          <div><p className="modal-title">Pintasan keyboard</p><p className="modal-subtitle">Mode Desktop</p></div>
        </div>
        <button onClick={onClose} className="modal-close" aria-label="Tutup"><X size={14} /></button>
      </div>
      <div className="modal-body">
        <ul className="dsk-keys" aria-label="Daftar pintasan">
          {SHORTCUTS.map(s => (
            <li key={s.keys}><kbd>{s.keys}</kbd><span>{s.label}</span></li>
          ))}
        </ul>
        <p className="text-[11px] mt-3" style={{ color: 'var(--text-muted)' }}>Pintasan tidak aktif saat mengetik di kolom isian atau saat dialog terbuka.</p>
      </div>
    </Modal>
  );
}
