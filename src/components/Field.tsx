'use client';

import { Children, cloneElement, isValidElement, useId, type CSSProperties, type ReactElement, type ReactNode } from 'react';

interface FieldProps {
  label: ReactNode;
  /** Tambah tanda bintang merah setelah label. */
  required?: boolean;
  /** Anak pertama = kontrol yang dilabeli (input/textarea/select/komponen kustom yang menerima `id`); anak lain (hint, dll.) dirender apa adanya. */
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}

// Label + kontrol dengan pasangan htmlFor/id otomatis (useId), tampilan memakai `.field-label`.
// Kalau kontrol sudah punya `id`, id itu yang dipakai. Klik label memfokuskan kontrol (untuk
// pemilih kustom berbasis tombol, klik label ikut membuka popover-nya, sama seperti <select> native).
export default function Field({ label, required, children, className, style }: FieldProps) {
  const autoId = useId();
  const nodes = Children.toArray(children);
  const idx = nodes.findIndex(isValidElement);
  const control = idx >= 0 ? (nodes[idx] as ReactElement<{ id?: string }>) : null;
  const id = control?.props.id ?? autoId;
  if (control && control.props.id == null) nodes[idx] = cloneElement(control, { id });

  return (
    <div className={className} style={style}>
      <label htmlFor={control ? id : undefined} className="field-label">
        {label}
        {required && <> <span style={{ color: 'var(--danger)' }}>*</span></>}
      </label>
      {nodes}
    </div>
  );
}
