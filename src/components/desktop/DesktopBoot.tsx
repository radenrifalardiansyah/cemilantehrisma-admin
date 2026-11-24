import type { CSSProperties } from 'react';

const WALLPAPER: Record<'windows' | 'mac', string> = {
  windows: 'radial-gradient(900px 500px at 78% 8%, rgba(240,138,60,.38), transparent 60%), radial-gradient(700px 480px at 6% 96%, rgba(212,105,30,.28), transparent 62%), linear-gradient(160deg, #3A1F10 0%, #24120A 55%, #1A0D06 100%)',
  mac: 'radial-gradient(800px 520px at 20% 12%, rgba(255,196,140,.75), transparent 62%), radial-gradient(900px 560px at 88% 78%, rgba(122,52,22,.85), transparent 64%), linear-gradient(170deg, #F2A86A 0%, #D4691E 42%, #5B2A12 100%)',
};

// Kerangka memuat bertema Desktop: wallpaper skin + taskbar/menu bar + dock kosong + spinner kecil. Gaya inline karena
// desktop.css baru dimuat bersama DesktopShell, sedangkan komponen ini tampil SEBELUM itu. Dipakai saat sesi dipulihkan
// dan sebagai fallback pemuatan DesktopShell, supaya tidak ada kilatan tampilan Klasik.
export default function DesktopBoot({ skin }: { skin: 'windows' | 'mac' }) {
  const bar: CSSProperties = { position: 'absolute', left: 0, right: 0, background: skin === 'windows' ? 'rgba(20,9,3,.96)' : 'rgba(26,12,5,.82)' };
  return (
    <div role="status" aria-live="polite" aria-label="Memuat dashboard"
      style={{ position: 'fixed', inset: 0, zIndex: 40, background: WALLPAPER[skin], display: 'grid', placeItems: 'center' }}>
      {skin === 'windows'
        ? <div style={{ ...bar, bottom: 0, height: 48, borderTop: '1px solid rgba(255,255,255,.1)' }} />
        : (<>
            <div style={{ ...bar, top: 0, height: 28 }} />
            <div style={{ position: 'absolute', bottom: 6, left: 0, right: 0, margin: '0 auto', width: 260, height: 54, borderRadius: 17, background: 'rgba(255,255,255,.28)', border: '1px solid rgba(255,255,255,.4)' }} />
          </>)}
      <div className="page-loader-ring" aria-hidden="true" />
    </div>
  );
}
