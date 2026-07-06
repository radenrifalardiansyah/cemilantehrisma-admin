'use client';

import { useEffect } from 'react';
import Image from 'next/image';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';

interface ImageLightboxProps {
  images: string[];
  index: number;
  title?: string;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}

export default function ImageLightbox({ images, index, title, onIndexChange, onClose }: ImageLightboxProps) {
  const count = images.length;
  const prev  = () => onIndexChange((index - 1 + count) % count);
  const next  = () => onIndexChange((index + 1) % count);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && count > 1) prev();
      if (e.key === 'ArrowRight' && count > 1) next();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (count === 0) return null;

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.85)' }}
    >
      <button
        onClick={onClose}
        className="absolute top-4 right-4 w-9 h-9 rounded-full bg-white/10 text-white flex items-center justify-center hover:bg-white/20 transition-colors"
      >
        <X size={18} />
      </button>

      {title && (
        <p className="absolute top-5 left-5 text-sm font-semibold text-white/90 max-w-[60%] truncate">
          {title}
        </p>
      )}

      {count > 1 && (
        <button
          onClick={e => { e.stopPropagation(); prev(); }}
          className="absolute left-3 sm:left-6 w-10 h-10 rounded-full bg-white/10 text-white flex items-center justify-center hover:bg-white/20 transition-colors"
        >
          <ChevronLeft size={20} />
        </button>
      )}

      <div
        onClick={e => e.stopPropagation()}
        className="relative"
        style={{ width: 'min(90vw, 640px)', height: 'min(80vh, 640px)' }}
      >
        <Image src={images[index]} alt="" fill className="object-contain" sizes="640px" unoptimized />
      </div>

      {count > 1 && (
        <button
          onClick={e => { e.stopPropagation(); next(); }}
          className="absolute right-3 sm:right-6 w-10 h-10 rounded-full bg-white/10 text-white flex items-center justify-center hover:bg-white/20 transition-colors"
        >
          <ChevronRight size={20} />
        </button>
      )}

      {count > 1 && (
        <div
          onClick={e => e.stopPropagation()}
          className="absolute bottom-5 left-1/2 -translate-x-1/2 flex items-center gap-1.5"
        >
          {images.map((_, i) => (
            <button
              key={i}
              onClick={() => onIndexChange(i)}
              className="rounded-full transition-all"
              style={{
                width: i === index ? 18 : 6, height: 6,
                background: i === index ? '#fff' : 'rgba(255,255,255,0.4)',
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
