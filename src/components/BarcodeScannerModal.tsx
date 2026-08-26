'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import type { CameraDevice } from 'html5-qrcode/camera/core';
import { X, ScanLine, CheckCircle2, Zap, ZapOff, SwitchCamera, Loader2, VideoOff, RotateCcw } from 'lucide-react';

interface Props {
  title?: string;
  subtitle?: string;
  onDetect: (text: string) => void;
  onClose: () => void;
  /** Extra controls rendered above the camera view (e.g. a mode toggle). */
  headerExtra?: React.ReactNode;
}

const REGION_ID = 'barcode-scanner-region';
const RESCAN_COOLDOWN_MS = 1500;

function playBeep() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 1568;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.28, ctx.currentTime + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.13);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.14);
    osc.onended = () => ctx.close().catch(() => {});
  } catch { /* audio not available */ }
}

function vibrate() {
  try { navigator.vibrate?.(55); } catch { /* not supported */ }
}

type Status = 'init' | 'scanning' | 'error';

export default function BarcodeScannerModal({ title = 'Scan Produk', subtitle, onDetect, onClose, headerExtra }: Props) {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const lastScanRef = useRef<{ text: string; at: number }>({ text: '', at: 0 });
  const mountedRef = useRef(true);

  const [status, setStatus] = useState<Status>('init');
  const [errorMsg, setErrorMsg] = useState('');
  const [lastLabel, setLastLabel] = useState('');
  const [flash, setFlash] = useState(false);
  const [cameras, setCameras] = useState<CameraDevice[]>([]);
  const [cameraIdx, setCameraIdx] = useState(0);
  const [torchOn, setTorchOn] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);

  const stopScanner = useCallback(async () => {
    const s = scannerRef.current;
    scannerRef.current = null;
    if (!s) return;
    try { if (s.isScanning) await s.stop(); } catch { /* already stopped */ }
    try { s.clear(); } catch { /* no-op */ }
  }, []);

  const start = useCallback(async (deviceId?: string) => {
    setStatus('init');
    setErrorMsg('');
    await stopScanner();
    if (!mountedRef.current) return;

    if (typeof window !== 'undefined' && !window.isSecureContext) {
      setErrorMsg('Kamera hanya bisa diakses lewat koneksi HTTPS (atau localhost). Buka halaman ini lewat link https://.');
      setStatus('error');
      return;
    }
    if (typeof navigator === 'undefined' || !navigator.mediaDevices) {
      setErrorMsg('Browser ini tidak mendukung akses kamera. Coba pakai Chrome/Safari versi terbaru.');
      setStatus('error');
      return;
    }

    try {
      let list = cameras;
      if (list.length === 0) {
        list = await Html5Qrcode.getCameras();
        if (mountedRef.current) setCameras(list);
      }

      const target = deviceId
        ?? list.find(c => /back|rear|environment/i.test(c.label))?.id
        ?? list[list.length - 1]?.id;

      const scanner = new Html5Qrcode(REGION_ID, { verbose: false });
      scannerRef.current = scanner;

      await scanner.start(
        target ? { deviceId: { exact: target } } : { facingMode: 'environment' },
        { fps: 12, qrbox: { width: 260, height: 260 }, aspectRatio: 1 },
        text => {
          const now = Date.now();
          if (text === lastScanRef.current.text && now - lastScanRef.current.at < RESCAN_COOLDOWN_MS) return;
          lastScanRef.current = { text, at: now };
          playBeep();
          vibrate();
          setLastLabel(text);
          setFlash(true);
          setTimeout(() => mountedRef.current && setFlash(false), 400);
          onDetect(text);
        },
        () => {},
      );

      if (!mountedRef.current) { await stopScanner(); return; }
      setStatus('scanning');

      try {
        const caps = scanner.getRunningTrackCameraCapabilities();
        setTorchSupported(caps.torchFeature().isSupported());
      } catch { setTorchSupported(false); }
      setTorchOn(false);
    } catch (err) {
      if (!mountedRef.current) return;
      const name = (err as { name?: string })?.name;
      const msg = name === 'NotAllowedError'
        ? 'Izin kamera ditolak. Aktifkan izin kamera untuk situs ini di pengaturan browser HP kamu.'
        : name === 'NotFoundError'
        ? 'Tidak ditemukan kamera di perangkat ini.'
        : (err as { message?: string })?.message || 'Tidak bisa mengakses kamera.';
      setErrorMsg(msg);
      setStatus('error');
    }
  }, [cameras, onDetect, stopScanner]);

  useEffect(() => {
    mountedRef.current = true;
    start();
    return () => {
      mountedRef.current = false;
      stopScanner();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const switchCamera = () => {
    if (cameras.length < 2) return;
    const next = (cameraIdx + 1) % cameras.length;
    setCameraIdx(next);
    start(cameras[next].id);
  };

  const toggleTorch = async () => {
    const s = scannerRef.current;
    if (!s) return;
    try {
      await s.applyVideoConstraints({ advanced: [{ torch: !torchOn } as MediaTrackConstraintSet] });
      setTorchOn(v => !v);
    } catch { /* torch toggle failed silently */ }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-sheet modal-sm" onClick={e => e.stopPropagation()}>
        <div className="modal-accent" />
        <span className="modal-handle" />

        <div className="modal-header">
          <div className="modal-header-left">
            <div className="modal-icon"><ScanLine size={17} /></div>
            <div>
              <p className="modal-title">{title}</p>
              {subtitle && <p className="modal-subtitle">{subtitle}</p>}
            </div>
          </div>
          <button onClick={onClose} className="modal-close"><X size={14} /></button>
        </div>

        <div className="modal-body">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {headerExtra}

            <div className="bcsm-frame" data-flash={flash ? '1' : '0'}>
              <div id={REGION_ID} className="bcsm-region" />

              {status === 'scanning' && (
                <div className="bcsm-overlay" aria-hidden>
                  <span className="bcsm-corner bcsm-corner-tl" />
                  <span className="bcsm-corner bcsm-corner-tr" />
                  <span className="bcsm-corner bcsm-corner-bl" />
                  <span className="bcsm-corner bcsm-corner-br" />
                  <span className="bcsm-laser" />
                </div>
              )}

              {status === 'init' && (
                <div className="bcsm-state">
                  <Loader2 size={26} className="animate-spin" style={{ color: '#fff' }} />
                  <p>Menyalakan kamera…</p>
                </div>
              )}

              {status === 'error' && (
                <div className="bcsm-state">
                  <VideoOff size={26} style={{ color: '#fff' }} />
                  <p style={{ maxWidth: 220 }}>{errorMsg}</p>
                  <button type="button" onClick={() => start()} className="bcsm-retry">
                    <RotateCcw size={12} /> Coba Lagi
                  </button>
                </div>
              )}

              {status === 'scanning' && (
                <div className="bcsm-controls">
                  {torchSupported && (
                    <button type="button" onClick={toggleTorch} className="bcsm-icon-btn" data-active={torchOn ? '1' : '0'}>
                      {torchOn ? <ZapOff size={15} /> : <Zap size={15} />}
                    </button>
                  )}
                  {cameras.length > 1 && (
                    <button type="button" onClick={switchCamera} className="bcsm-icon-btn">
                      <SwitchCamera size={15} />
                    </button>
                  )}
                </div>
              )}
            </div>

            <p className="text-xs text-center" style={{ color: 'var(--text-muted)' }}>
              Arahkan kamera ke QR Code produk
            </p>

            {lastLabel && status === 'scanning' && (
              <div className="flex items-center gap-1.5 justify-center text-xs font-bold" style={{ color: 'var(--accent)' }}>
                <CheckCircle2 size={13} /> Terakhir discan: {lastLabel.length > 40 ? lastLabel.slice(0, 40) + '…' : lastLabel}
              </div>
            )}
          </div>
        </div>

        <div className="modal-footer">
          <button onClick={onClose} className="btn-primary" style={{ flex: 1, justifyContent: 'center', padding: '10px 0' }}>
            Selesai
          </button>
        </div>
      </div>

      <style>{`
        .bcsm-frame {
          position: relative;
          border-radius: 20px;
          overflow: hidden;
          background: #0a0a0a;
          aspect-ratio: 1 / 1;
          box-shadow: 0 0 0 1px var(--border);
          transition: box-shadow 0.25s ease;
        }
        .bcsm-frame[data-flash="1"] {
          box-shadow: 0 0 0 3px #22c55e;
        }
        .bcsm-region, .bcsm-region video {
          width: 100% !important;
          height: 100% !important;
          object-fit: cover !important;
        }
        .bcsm-overlay {
          position: absolute;
          inset: 0;
          pointer-events: none;
        }
        .bcsm-corner {
          position: absolute;
          width: 28px;
          height: 28px;
          border: 3px solid #fff;
          opacity: 0.85;
        }
        .bcsm-corner-tl { top: 14%; left: 14%; border-right: none; border-bottom: none; border-top-left-radius: 8px; }
        .bcsm-corner-tr { top: 14%; right: 14%; border-left: none; border-bottom: none; border-top-right-radius: 8px; }
        .bcsm-corner-bl { bottom: 14%; left: 14%; border-right: none; border-top: none; border-bottom-left-radius: 8px; }
        .bcsm-corner-br { bottom: 14%; right: 14%; border-left: none; border-top: none; border-bottom-right-radius: 8px; }
        .bcsm-laser {
          position: absolute;
          left: 14%;
          right: 14%;
          top: 14%;
          height: 2px;
          background: linear-gradient(90deg, transparent, #22c55e, transparent);
          box-shadow: 0 0 8px 1px #22c55e;
          animation: bcsm-sweep 2.1s ease-in-out infinite;
        }
        @keyframes bcsm-sweep {
          0%   { top: 14%; opacity: 0; }
          10%  { opacity: 1; }
          50%  { top: 72%; opacity: 1; }
          90%  { opacity: 1; }
          100% { top: 14%; opacity: 0; }
        }
        .bcsm-state {
          position: absolute;
          inset: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 10px;
          text-align: center;
          padding: 20px;
          color: #fff;
          font-size: 12px;
        }
        .bcsm-retry {
          display: flex;
          align-items: center;
          gap: 5px;
          font-size: 11.5px;
          font-weight: 700;
          color: #0a0a0a;
          background: #fff;
          border: none;
          border-radius: 999px;
          padding: 7px 14px;
          margin-top: 4px;
        }
        .bcsm-controls {
          position: absolute;
          top: 10px;
          right: 10px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .bcsm-icon-btn {
          width: 32px;
          height: 32px;
          border-radius: 999px;
          background: rgba(0,0,0,0.5);
          backdrop-filter: blur(4px);
          border: 1px solid rgba(255,255,255,0.25);
          color: #fff;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .bcsm-icon-btn[data-active="1"] {
          background: #f59e0b;
          border-color: #f59e0b;
          color: #1c1917;
        }
        @media (max-width: 480px) {
          .bcsm-frame { aspect-ratio: 3 / 4; }
        }
      `}</style>
    </div>
  );
}
