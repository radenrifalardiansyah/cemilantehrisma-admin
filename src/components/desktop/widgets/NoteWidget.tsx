'use client';

import { MAX_NOTE_CHARS } from '@/lib/widgets';
import type { WidgetProps } from './registry';

// Catatan tempel: textarea terkontrol oleh config.text (state ada di use-widgets, jadi respons server lama tidak menimpa ketikan). Penyimpanan
// di-debounce di hook. Pintasan desktop diabaikan saat mengetik (use-desktop-shortcuts) dan seret tidak dimulai dari textarea (elemen interaktif).
// Klik kanan di dalam textarea tidak dicegat (menu bawaan peramban: salin/tempel).
export default function NoteWidget({ config, onConfigChange }: WidgetProps) {
  const text = typeof config.text === 'string' ? config.text : '';
  return (
    <textarea
      className="dsk-wg-note" value={text} maxLength={MAX_NOTE_CHARS} spellCheck={false}
      placeholder="Tulis catatan di sini…" aria-label="Catatan tempel"
      onChange={e => onConfigChange({ text: e.target.value })}
    />
  );
}
