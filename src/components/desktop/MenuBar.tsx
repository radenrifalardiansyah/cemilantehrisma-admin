'use client';

import type { ReactNode } from 'react';
import Image from 'next/image';
import Clock from './Clock';

// Menu bar atas (skin Mac): logo + nama aplikasi + judul jendela terdepan; kanan: bel notifikasi, akun, jam.
export default function MenuBar({ title, tray }: { title: string; tray: ReactNode }) {
  return (
    <div className="dsk-mbar" role="banner">
      <Image src="/icon-192.png" alt="" width={18} height={18} />
      <b>Cemilan Teh Risma</b>
      <span>{title}</span>
      <span className="sp" />
      <div className="dsk-tray">{tray}<Clock /></div>
    </div>
  );
}
