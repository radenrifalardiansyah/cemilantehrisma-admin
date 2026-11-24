'use client';

import type { CSSProperties } from 'react';
import type { UiLayout } from '@/lib/ui-layout';
import './desktop.css'; // dipakai juga di Edit Profil (mode Klasik), saat DesktopShell belum dimuat

const OPTIONS: { id: UiLayout; label: string; desc: string }[] = [
  { id: 'classic', label: 'Klasik', desc: 'Sidebar dan halaman penuh' },
  { id: 'windows', label: 'Windows', desc: 'Meja, jendela, taskbar' },
  { id: 'mac', label: 'Mac', desc: 'Menu bar, jendela, dock' },
];

const bar = (s: CSSProperties): CSSProperties => ({ position: 'absolute', ...s });

// Pratinjau mini (hanya hiasan) tiap tata letak.
function Preview({ id }: { id: UiLayout }) {
  const win = (s: CSSProperties) => bar({ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 3, ...s });
  return (
    <span className="dsk-pv" aria-hidden="true">
      {id === 'classic' && (<>
        <span style={bar({ left: 0, top: 0, bottom: 0, width: '26%', background: '#190C03' })} />
        <span style={bar({ left: '32%', top: 6, right: 6, height: 8, borderRadius: 3, background: 'var(--border)' })} />
        <span style={bar({ left: '32%', top: 19, right: 6, bottom: 6, borderRadius: 3, background: 'var(--surface)', border: '1px solid var(--border)' })} />
      </>)}
      {id === 'windows' && (<>
        <span style={bar({ inset: 0, background: 'linear-gradient(160deg,#3A1F10,#1A0D06)' })} />
        <span style={win({ left: 10, top: 6, width: '56%', height: '56%' })} />
        <span style={win({ left: '34%', top: 14, width: '52%', height: '52%' })} />
        <span style={bar({ left: 0, right: 0, bottom: 0, height: 7, background: '#140903' })} />
      </>)}
      {id === 'mac' && (<>
        <span style={bar({ inset: 0, background: 'linear-gradient(170deg,#F2A86A,#D4691E 45%,#5B2A12)' })} />
        <span style={bar({ left: 0, right: 0, top: 0, height: 5, background: 'rgba(26,12,5,.7)' })} />
        <span style={win({ left: 12, top: 10, width: '62%', height: '52%' })} />
        <span style={bar({ left: '50%', bottom: 3, width: '46%', height: 7, marginLeft: '-23%', borderRadius: 4, background: 'rgba(255,255,255,.55)' })} />
      </>)}
    </span>
  );
}

// Pemilih 3 pilihan tata letak. `compact` = deretan chip (footer menu Mulai/Launchpad), selain itu kartu
// dengan pratinjau (Edit Profil). Pemanggil menangani simpan + rollback; di sini hanya melaporkan pilihan.
export default function LayoutPicker({ value, onChange, compact = false, disabled = false }: {
  value: UiLayout; onChange: (next: UiLayout) => void; compact?: boolean; disabled?: boolean;
}) {
  return (
    <div className="dsk-lp" role="radiogroup" aria-label="Tampilan dashboard" data-compact={compact}>
      {OPTIONS.map(o => (
        <button key={o.id} type="button" role="radio" aria-checked={value === o.id} disabled={disabled}
          onClick={() => { if (o.id !== value) onChange(o.id); }}>
          {compact ? o.label : (<>
            <Preview id={o.id} />
            <b>{o.label}</b>
            <small>{o.desc}</small>
          </>)}
        </button>
      ))}
    </div>
  );
}
