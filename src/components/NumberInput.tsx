'use client';

import { CSSProperties, useLayoutEffect, useRef } from 'react';

export function formatThousands(value: string | number | null | undefined): string {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

interface NumberInputProps {
  value: string | number | null | undefined;
  onChange: (raw: string) => void;
  placeholder?: string;
  className?: string;
  style?: CSSProperties;
  disabled?: boolean;
  autoFocus?: boolean;
  id?: string;
}

// Text input that live-formats a plain digit string with "." thousands separators
// (cth: 1000000 -> 1.000.000) while keeping the underlying value as raw digits.
export default function NumberInput({
  value, onChange, placeholder = '0', className = 'input', style, disabled, autoFocus, id,
}: NumberInputProps) {
  const ref = useRef<HTMLInputElement>(null);
  const caretDigits = useRef<number | null>(null);
  const display = formatThousands(value);

  useLayoutEffect(() => {
    if (caretDigits.current == null) return;
    const el = ref.current;
    if (!el) return;
    let pos = 0, seen = 0;
    while (pos < display.length && seen < caretDigits.current) {
      if (/\d/.test(display[pos])) seen++;
      pos++;
    }
    el.setSelectionRange(pos, pos);
    caretDigits.current = null;
  }, [display]);

  return (
    <input
      ref={ref}
      id={id}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      disabled={disabled}
      autoFocus={autoFocus}
      value={display}
      placeholder={placeholder}
      className={className}
      style={style}
      onChange={e => {
        const el = e.target;
        const cursor = el.selectionStart ?? el.value.length;
        caretDigits.current = el.value.slice(0, cursor).replace(/\D/g, '').length;
        onChange(el.value.replace(/\D/g, ''));
      }}
    />
  );
}
