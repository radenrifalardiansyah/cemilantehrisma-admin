'use client';

import { useEffect, useRef, useState, PointerEvent as ReactPointerEvent } from 'react';
import { Check, Loader2, RotateCcw, RotateCw, X, ZoomIn, ZoomOut } from 'lucide-react';

interface ImageCropperModalProps {
  file: File;
  /** Rasio lebar/tinggi bingkai crop, mis. 1 untuk persegi. */
  aspect?: number;
  /** Sisi terpanjang hasil akhir dalam px. */
  outputSize?: number;
  /** Simpan transparansi (PNG). Kalau false, latar putih (JPEG). */
  keepAlpha?: boolean;
  title?: string;
  subtitle?: string;
  onCancel: () => void;
  onConfirm: (file: File) => void;
}

const FRAME_BASE = 240; // px, sisi terpanjang bingkai crop di layar
const STAGE_PAD = 44;   // px, ruang ekstra di sekeliling bingkai supaya area luar terlihat redup

export default function ImageCropperModal({
  file, aspect = 1, outputSize = 1000, keepAlpha = true,
  title = 'Edit Foto', subtitle = 'Geser untuk atur posisi, lalu zoom & putar sesuai kebutuhan.',
  onCancel, onConfirm,
}: ImageCropperModalProps) {
  const [imgUrl, setImgUrl] = useState('');
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [saving, setSaving] = useState(false);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  const frameW = aspect >= 1 ? FRAME_BASE : FRAME_BASE * aspect;
  const frameH = aspect >= 1 ? FRAME_BASE / aspect : FRAME_BASE;
  const stageW = frameW + STAGE_PAD;
  const stageH = frameH + STAGE_PAD;

  // objectURL dibuat & dilepas di dalam efek yang sama supaya aman dari
  // double-invoke Strict Mode (dibuat ulang tiap "mount", bukan sekali di render).
  useEffect(() => {
    const url = URL.createObjectURL(file);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- turunan dari resource eksternal (blob URL), bukan derivable dari state React
    setImgUrl(url);
    const img = new window.Image();
    img.onload = () => setNatural({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const baseScale = natural.w && natural.h ? Math.max(frameW / natural.w, frameH / natural.h) : 1;
  const scale = baseScale * zoom;

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
    setDragging(true);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    setOffset({ x: dragRef.current.ox + (e.clientX - dragRef.current.x), y: dragRef.current.oy + (e.clientY - dragRef.current.y) });
  };
  const onPointerUp = () => { dragRef.current = null; setDragging(false); };

  const rotateBy = (delta: number) => setRotation(r => {
    const n = ((r + delta + 180) % 360 + 360) % 360 - 180;
    return n;
  });
  const reset = () => { setZoom(1); setRotation(0); setOffset({ x: 0, y: 0 }); };

  const confirm = async () => {
    if (!natural.w) return;
    setSaving(true);
    try {
      const outW = aspect >= 1 ? outputSize : Math.round(outputSize * aspect);
      const outH = aspect >= 1 ? Math.round(outputSize / aspect) : outputSize;
      const outScale = outW / frameW;

      const img = new window.Image();
      img.src = imgUrl;
      if (!img.complete) await new Promise(res => { img.onload = () => res(null); });

      const canvas = document.createElement('canvas');
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext('2d')!;
      if (!keepAlpha) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, outW, outH); }
      ctx.save();
      ctx.translate(outW / 2 + offset.x * outScale, outH / 2 + offset.y * outScale);
      ctx.rotate((rotation * Math.PI) / 180);
      ctx.scale(scale * outScale, scale * outScale);
      ctx.drawImage(img, -natural.w / 2, -natural.h / 2);
      ctx.restore();

      const type = keepAlpha ? 'image/png' : 'image/jpeg';
      const ext = keepAlpha ? '.png' : '.jpg';
      canvas.toBlob(blob => {
        setSaving(false);
        if (!blob) return;
        onConfirm(new File([blob], file.name.replace(/\.\w+$/, ext), { type }));
      }, type, keepAlpha ? undefined : 0.92);
    } catch {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-sheet modal-sm" onClick={e => e.stopPropagation()}>
        <div className="modal-accent" />
        <span className="modal-handle" />
        <div className="modal-header">
          <div className="modal-header-left">
            <div>
              <p className="modal-title">{title}</p>
              <p className="modal-subtitle">{subtitle}</p>
            </div>
          </div>
          <button onClick={onCancel} className="modal-close"><X size={14} /></button>
        </div>

        <div className="modal-body flex flex-col items-center gap-4">
          <div
            className="relative select-none touch-none rounded-2xl"
            style={{ width: stageW, height: stageH, overflow: 'hidden', background: 'var(--surface-2)', cursor: dragging ? 'grabbing' : 'grab' }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            {imgUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={imgUrl}
                alt=""
                draggable={false}
                style={{
                  position: 'absolute', left: '50%', top: '50%',
                  width: natural.w, height: natural.h, maxWidth: 'none',
                  transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px) rotate(${rotation}deg) scale(${scale})`,
                  pointerEvents: 'none',
                }}
              />
            )}
            {/* Cincin bingkai crop — box-shadow menggelapkan area di luar bingkai */}
            <div
              className="absolute rounded-xl"
              style={{
                left: '50%', top: '50%', width: frameW, height: frameH,
                transform: 'translate(-50%, -50%)',
                boxShadow: '0 0 0 2000px rgba(15,8,4,0.55)',
                border: '2px solid rgba(255,255,255,0.9)',
                pointerEvents: 'none',
              }}
            />
          </div>

          <div className="w-full flex flex-col gap-3">
            <div className="flex items-center gap-2.5">
              <ZoomOut size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
              <input
                type="range" min={1} max={4} step={0.01} value={zoom}
                onChange={e => setZoom(Number(e.target.value))}
                className="flex-1" style={{ accentColor: 'var(--accent)' }}
              />
              <ZoomIn size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
            </div>
            <div className="flex items-center gap-2.5">
              <button type="button" onClick={() => rotateBy(-90)} className="btn-ghost p-2" title="Putar kiri 90°">
                <RotateCcw size={14} />
              </button>
              <input
                type="range" min={-180} max={180} step={1} value={rotation}
                onChange={e => setRotation(Number(e.target.value))}
                className="flex-1" style={{ accentColor: 'var(--accent)' }}
              />
              <button type="button" onClick={() => rotateBy(90)} className="btn-ghost p-2" title="Putar kanan 90°">
                <RotateCw size={14} />
              </button>
            </div>
            <button type="button" onClick={reset} className="text-[11px] font-semibold self-center" style={{ color: 'var(--text-muted)' }}>
              Reset posisi, zoom & rotasi
            </button>
          </div>
        </div>

        <div className="modal-footer">
          <button onClick={onCancel} className="btn-ghost" style={{ flex: 1, justifyContent: 'center', padding: '10px 0' }}>
            Batal
          </button>
          <button onClick={confirm} disabled={saving} className="btn-primary" style={{ flex: 2, justifyContent: 'center', padding: '10px 0' }}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            {saving ? 'Memproses…' : 'Simpan'}
          </button>
        </div>
      </div>
    </div>
  );
}
