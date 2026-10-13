'use client';

import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';
import { Camera, Loader2, X } from 'lucide-react';

// Tombol "Ambil foto". Di HP (pointer kasar) memakai input `capture` bawaan sehingga langsung membuka
// aplikasi kamera. Browser desktop MENGABAIKAN `capture` dan hanya membuka pemilih file, jadi di sana
// dibuka kamera lewat getUserMedia (butuh HTTPS/localhost + izin kamera) dan hasilnya dijepret ke JPEG.
const subscribeNoop = () => () => {};
function useCoarsePointer() {
  // Server snapshot false → tidak ada mismatch hidrasi; klien membaca media query sebenarnya.
  return useSyncExternalStore(subscribeNoop, () => window.matchMedia('(pointer: coarse)').matches, () => false);
}

export default function CameraButton({ onFiles, disabled, className, style, children, desktopOnly = false, title = 'Ambil foto' }: {
  onFiles: (files: File[]) => void; disabled?: boolean; className?: string; style?: CSSProperties; children?: ReactNode;
  /** Render hanya di desktop (untuk tempat yang sudah punya input capture sendiri di HP). */
  desktopOnly?: boolean; title?: string;
}) {
  const coarse = useCoarsePointer();
  const [open, setOpen] = useState(false);
  const content = children ?? <><Camera size={14} /> Ambil foto</>;

  if (coarse) {
    if (desktopOnly) return null;
    return (
      <label className={className} style={style} title={title}>
        {content}
        <input type="file" accept="image/*" capture="environment" className="hidden" disabled={disabled}
          onChange={e => { const f = Array.from(e.target.files ?? []); e.target.value = ''; if (f.length) onFiles(f); }} />
      </label>
    );
  }
  return (
    <>
      <button type="button" className={className} style={style} title={title} disabled={disabled} onClick={() => setOpen(true)}>{content}</button>
      {open && <CameraCaptureModal onClose={() => setOpen(false)} onCapture={f => { setOpen(false); onFiles([f]); }} />}
    </>
  );
}

function CameraCaptureModal({ onClose, onCapture }: { onClose: () => void; onCapture: (f: File) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<'starting' | 'ready' | 'error'>('starting');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('Browser ini tidak mendukung akses kamera (butuh HTTPS).'), { name: 'NotSupportedError' });
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } }, audio: false });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play().catch(() => {}); }
        setStatus('ready');
      } catch (err) {
        if (cancelled) return;
        const name = (err as { name?: string })?.name;
        setError(name === 'NotAllowedError' ? 'Izin kamera ditolak. Izinkan kamera untuk situs ini di pengaturan browser, lalu coba lagi.'
          : name === 'NotFoundError' ? 'Kamera tidak ditemukan di perangkat ini. Gunakan "Pilih foto".'
          : (err as { message?: string })?.message || 'Tidak bisa mengakses kamera.');
        setStatus('error');
      }
    })();
    return () => { cancelled = true; streamRef.current?.getTracks().forEach(t => t.stop()); };
  }, []);

  const snap = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = v.videoWidth; canvas.height = v.videoHeight;
    canvas.getContext('2d')!.drawImage(v, 0, 0);
    canvas.toBlob(b => {
      if (!b) return;
      onCapture(new File([b], `foto-${Date.now()}.jpg`, { type: 'image/jpeg' }));
    }, 'image/jpeg', 0.9);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-sheet" onClick={e => e.stopPropagation()}>
        <div className="modal-accent" />
        <span className="modal-handle" />
        <div className="modal-header">
          <div className="modal-header-left">
            <div className="modal-icon"><Camera size={17} /></div>
            <div><p className="modal-title">Ambil Foto</p><p className="modal-subtitle">Arahkan kamera lalu tekan Jepret</p></div>
          </div>
          <button onClick={onClose} className="modal-close" aria-label="Tutup"><X size={14} /></button>
        </div>
        <div className="modal-body">
          {status === 'error' ? (
            <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>
          ) : (
            <div className="relative rounded-xl overflow-hidden" style={{ background: '#000', aspectRatio: '4 / 3' }}>
              <video ref={videoRef} playsInline muted className="w-full h-full object-contain" />
              {status === 'starting' && <div className="absolute inset-0 flex items-center justify-center" style={{ color: '#fff' }}><Loader2 size={22} className="animate-spin" /></div>}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button onClick={onClose} className="btn-ghost" style={{ flex: 1, justifyContent: 'center', padding: '10px 0' }}>Batal</button>
          {status !== 'error' && (
            <button onClick={snap} disabled={status !== 'ready'} className="btn-primary" style={{ flex: 2, justifyContent: 'center', padding: '10px 0' }}><Camera size={14} /> Jepret</button>
          )}
        </div>
      </div>
    </div>
  );
}
