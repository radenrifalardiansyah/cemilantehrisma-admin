'use client';

import { Plus } from 'lucide-react';

// Tampilan standar "daftar masih kosong" untuk semua menu: kartu garis putus-putus dengan tombol
// plus dan label aksi (mis. "Tambah Gudang"), sama seperti kartu tambah di menu Gudang. Kalau
// `onClick` tidak diberikan (user tanpa hak tambah / data dibuat dari menu lain) kartu tampil
// sama tapi tidak bisa diklik.
export default function EmptyAddCard({ label, onClick, hint, minHeight = 200 }: {
  label: string; onClick?: () => void; hint?: string; minHeight?: number;
}) {
  const clickable = !!onClick;
  const style: React.CSSProperties = { border: '2px dashed var(--border)', background: 'transparent', color: 'var(--text-muted)', minHeight };
  const hover = (on: boolean) => (e: React.MouseEvent<HTMLElement>) => {
    if (!clickable) return;
    const el = e.currentTarget;
    el.style.background = on ? 'var(--surface-2)' : 'transparent';
    el.style.borderColor = on ? 'var(--accent)' : 'var(--border)';
    el.style.color = on ? 'var(--accent)' : 'var(--text-muted)';
  };
  const content = (
    <>
      <div className="w-16 h-16 rounded-3xl flex items-center justify-center" style={{ background: 'var(--surface-2)' }}>
        <Plus size={26} />
      </div>
      <span className="text-base font-semibold">{label}</span>
      {hint && <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>{hint}</span>}
    </>
  );
  const cls = 'w-full rounded-3xl flex flex-col items-center justify-center gap-3 p-8 transition-colors';
  return clickable
    ? <button type="button" onClick={onClick} className={cls} style={style} onMouseEnter={hover(true)} onMouseLeave={hover(false)}>{content}</button>
    : <div className={cls} style={style}>{content}</div>;
}
