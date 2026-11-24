'use client';

import { useState } from 'react';
import { Home, Info, LogOut, Palette, UserCog } from 'lucide-react';
import { useEscapeLayer } from '@/components/Modal';

interface Props {
  username: string;
  avatar: string | null;
  roleLabel: string;
  storeUrl: string;
  side: 'up' | 'down';
  onEditProfile: () => void;
  onAbout: () => void;
  onLogout: () => void;
  onAppearance?: () => void;
}

// Tombol avatar + menu akun kecil: Edit Profil, Tentang, Lihat Toko, Keluar (aksi yang di Klasik ada di footer sidebar / header).
export default function AccountMenu(props: Props) {
  const [open, setOpen] = useState(false);
  return (
    <div className="dsk-account">
      <button type="button" className="dsk-avatar" aria-label="Menu akun" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        {props.avatar
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={props.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : (props.username[0] ?? '?').toUpperCase()}
      </button>
      {open && <AccountPopover {...props} onClose={() => setOpen(false)} />}
    </div>
  );
}

function AccountPopover({ username, roleLabel, storeUrl, side, onEditProfile, onAbout, onLogout, onAppearance, onClose }: Props & { onClose: () => void }) {
  useEscapeLayer(onClose);
  const run = (fn: () => void) => () => { onClose(); fn(); };
  return (
    <>
      <div className="dsk-scrim" onPointerDown={onClose} />
      <div className="dsk-pop" data-side={side} role="menu" aria-label="Menu akun">
        <div className="who"><b>{username}</b><small>{roleLabel}</small></div>
        <hr />
        <button type="button" role="menuitem" onClick={run(onEditProfile)}><UserCog size={15} /> Edit Profil</button>
        {onAppearance && <button type="button" role="menuitem" onClick={run(onAppearance)}><Palette size={15} /> Personalisasi</button>}
        <button type="button" role="menuitem" onClick={run(onAbout)}><Info size={15} /> Tentang Aplikasi</button>
        <a role="menuitem" href={storeUrl} target="_blank" rel="noopener noreferrer" onClick={onClose}><Home size={15} /> Lihat Toko</a>
        <hr />
        <button type="button" role="menuitem" className="danger" onClick={run(onLogout)}><LogOut size={15} /> Keluar</button>
      </div>
    </>
  );
}
