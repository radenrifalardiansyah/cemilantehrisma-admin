'use client';

import { useRef, useState, type CSSProperties } from 'react';
import Image from 'next/image';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface ImageCarouselProps {
  imageUrls?: string[];
  emoji: string;
  alt: string;
  sizes: string;
  emojiClassName?: string;
  onImageClick?: (index: number) => void;
  innerStyle?: CSSProperties;
}

// Kartu foto produk yang bisa digeser (swipe) langsung tanpa perlu klik dulu,
// dipakai di grid Produk & grid Gudang (Open PO, Stok per gudang, Riwayat).
export default function ImageCarousel({
  imageUrls, emoji, alt, sizes, emojiClassName = 'text-4xl', onImageClick, innerStyle,
}: ImageCarouselProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  if (!imageUrls?.length) {
    return (
      <div className="w-full h-full flex items-center justify-center" style={innerStyle}>
        <span className={emojiClassName}>{emoji}</span>
      </div>
    );
  }

  if (imageUrls.length === 1) {
    return (
      <div
        className="w-full h-full relative"
        style={{ ...innerStyle, cursor: onImageClick ? 'pointer' : undefined }}
        onClick={() => onImageClick?.(0)}
      >
        <Image src={imageUrls[0]} alt={alt} fill className="object-contain" sizes={sizes} unoptimized />
      </div>
    );
  }

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el || el.clientWidth === 0) return;
    setActive(Math.round(el.scrollLeft / el.clientWidth));
  };

  const goTo = (index: number) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ left: index * el.clientWidth, behavior: 'smooth' });
  };

  const arrowBtnStyle: CSSProperties = {
    width: 24, height: 24, borderRadius: 999,
    background: 'rgba(0,0,0,0.4)', color: '#fff',
    alignItems: 'center', justifyContent: 'center',
  };

  return (
    <div className="w-full h-full relative group" style={innerStyle}>
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="carousel-scroll w-full h-full flex overflow-x-auto snap-x snap-mandatory"
      >
        {imageUrls.map((url, i) => (
          <div
            key={i}
            className="relative w-full h-full flex-shrink-0 snap-center"
            style={{ cursor: onImageClick ? 'pointer' : undefined }}
            onClick={() => onImageClick?.(i)}
          >
            <Image src={url} alt={`${alt} ${i + 1}`} fill className="object-contain" sizes={sizes} unoptimized />
          </div>
        ))}
      </div>

      {active > 0 && (
        <button
          type="button"
          onClick={e => { e.stopPropagation(); goTo(active - 1); }}
          className="hidden md:flex absolute left-1.5 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ ...arrowBtnStyle, zIndex: 3 }}
          aria-label="Foto sebelumnya"
        >
          <ChevronLeft size={15} />
        </button>
      )}
      {active < imageUrls.length - 1 && (
        <button
          type="button"
          onClick={e => { e.stopPropagation(); goTo(active + 1); }}
          className="hidden md:flex absolute right-1.5 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ ...arrowBtnStyle, zIndex: 3 }}
          aria-label="Foto berikutnya"
        >
          <ChevronRight size={15} />
        </button>
      )}

      <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 flex gap-1" style={{ zIndex: 2, pointerEvents: 'none' }}>
        {imageUrls.map((_, i) => (
          <span key={i} style={{
            width: i === active ? 11 : 4.5, height: 4.5, borderRadius: 999,
            background: i === active ? '#fff' : 'rgba(255,255,255,0.55)',
            boxShadow: '0 0 0 1px rgba(0,0,0,0.2)',
            transition: 'width 0.15s ease',
          }} />
        ))}
      </div>
    </div>
  );
}
