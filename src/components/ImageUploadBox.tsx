'use client';

import { CSSProperties, ReactNode, useState } from 'react';
import { Crop, Loader2, Image as ImageIcon, Pencil, X } from 'lucide-react';
import Tooltip from '@/components/Tooltip';
import ImageCropperModal from '@/components/ImageCropperModal';

interface ImageUploadBoxProps {
  src?: string;
  alt: string;
  uploading?: boolean;
  onSelect: (file: File) => void;
  onRemove?: () => void;
  onView?: () => void;
  accept?: string;
  capture?: 'environment';
  aspect?: string;
  fit?: 'contain' | 'cover';
  icon?: ReactNode;
  emptyText?: string;
  changeText?: string;
  size?: number;
  className?: string;
  /** Buka editor crop/rotate/zoom sebelum file dipakai. */
  crop?: boolean;
  cropAspect?: number;
  cropTitle?: string;
  /** Simpan transparansi (PNG) di hasil crop — cocok untuk tanda tangan/cap. Default true. */
  cropKeepAlpha?: boolean;
}

export default function ImageUploadBox({
  src, alt, uploading = false, onSelect, onRemove, onView,
  accept = 'image/*', capture, aspect = '1 / 1', fit = 'cover',
  icon, emptyText = 'Upload', changeText = 'Ganti',
  size, className = '',
  crop = false, cropAspect = 1, cropTitle, cropKeepAlpha = true,
}: ImageUploadBoxProps) {
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [fetchingSrc, setFetchingSrc] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const boxStyle: CSSProperties = size ? { width: size, height: size } : { width: '100%', aspectRatio: aspect };

  const handleFile = (f: File) => {
    if (crop) setPendingFile(f);
    else onSelect(f);
  };

  const editExisting = async () => {
    if (!src || fetchingSrc) return;
    setFetchingSrc(true);
    try {
      const r = await fetch(src);
      const blob = await r.blob();
      setPendingFile(new File([blob], 'image', { type: blob.type || 'image/png' }));
    } catch {
      // gambar mungkin diblokir CORS — biarkan, pengguna masih bisa "Ganti" dengan file baru
    } finally {
      setFetchingSrc(false);
    }
  };

  const input = (
    <input
      type="file" accept={accept} capture={capture} className="hidden" disabled={uploading}
      onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) handleFile(f); }}
    />
  );

  const dropHandlers = {
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); if (!uploading) setDragOver(true); },
    onDragLeave: () => setDragOver(false),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (uploading) return;
      const f = e.dataTransfer.files?.[0];
      if (f) handleFile(f);
    },
  };

  const modal = pendingFile && (
    <ImageCropperModal
      file={pendingFile}
      aspect={cropAspect}
      keepAlpha={cropKeepAlpha}
      title={cropTitle ?? 'Edit Foto'}
      onCancel={() => setPendingFile(null)}
      onConfirm={f => { setPendingFile(null); onSelect(f); }}
    />
  );

  if (!src) {
    return (
      <>
        <label
          className={`relative flex flex-col items-center justify-center gap-1.5 rounded-xl flex-shrink-0 cursor-pointer transition-all duration-150 ${className}`}
          style={{
            ...boxStyle,
            border: `1.5px dashed ${dragOver ? 'var(--accent)' : 'var(--border)'}`,
            background: dragOver ? 'var(--accent-bg)' : 'var(--surface-2)',
            color: dragOver ? 'var(--accent)' : 'var(--text-muted)',
            opacity: uploading ? 0.6 : 1,
            transform: dragOver ? 'scale(1.03)' : 'scale(1)',
          }}
          {...dropHandlers}
        >
          {input}
          {uploading ? <Loader2 size={18} className="animate-spin" /> : (icon ?? <ImageIcon size={18} />)}
          <span className="text-[11px] font-semibold text-center px-1.5 leading-tight">{uploading ? 'Mengunggah…' : emptyText}</span>
        </label>
        {modal}
      </>
    );
  }

  return (
    <>
      <div
        className={`relative rounded-xl overflow-hidden flex-shrink-0 group transition-shadow duration-150 ${className}`}
        style={{
          ...boxStyle,
          border: `1px solid ${dragOver ? 'var(--accent)' : 'var(--border)'}`,
          background: 'var(--surface-2)',
          boxShadow: dragOver ? '0 0 0 3px var(--accent-bg)' : undefined,
        }}
        {...dropHandlers}
      >
        {onView ? (
          <button type="button" onClick={onView} className="absolute inset-0 w-full h-full" style={{ border: 'none', padding: 0, cursor: 'pointer' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt={alt} className="w-full h-full transition-transform duration-200 group-hover:scale-105" style={{ objectFit: fit }} />
          </button>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={alt} className="w-full h-full transition-transform duration-200 group-hover:scale-105" style={{ objectFit: fit }} />
        )}

        {(uploading || fetchingSrc) && (
          <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.45)' }}>
            <Loader2 size={18} className="animate-spin" style={{ color: '#fff' }} />
          </div>
        )}

        {!uploading && !fetchingSrc && (
          <>
            {crop && (
              <Tooltip label="Edit foto">
                <button
                  type="button" onClick={editExisting}
                  className="absolute bottom-1 left-1 w-6 h-6 rounded-full flex items-center justify-center cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ background: 'rgba(0,0,0,0.6)', color: '#fff' }}
                >
                  <Crop size={11} />
                </button>
              </Tooltip>
            )}
            <Tooltip label={changeText}>
              <label
                className="absolute bottom-1 right-1 w-6 h-6 rounded-full flex items-center justify-center cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ background: 'var(--accent)', color: '#fff' }}
              >
                {input}
                <Pencil size={11} />
              </label>
            </Tooltip>
            {onRemove && (
              <Tooltip label="Hapus">
                <button
                  type="button" onClick={onRemove}
                  className="absolute top-1 right-1 w-6 h-6 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ background: 'rgba(0,0,0,0.6)', color: '#fff' }}
                >
                  <X size={11} />
                </button>
              </Tooltip>
            )}
          </>
        )}
      </div>
      {modal}
    </>
  );
}
