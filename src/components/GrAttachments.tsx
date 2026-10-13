'use client';

import { useState } from 'react';
import { Camera, ImagePlus, Loader2, X } from 'lucide-react';
import { useToast } from '@/components/Toast';
import { uploadImage } from '@/components/tabs/titip-jual/shared';

// Lampiran foto Penerimaan Barang: pilih dari galeri (boleh banyak sekaligus) atau langsung foto
// dengan kamera HP. Tiap foto diperkecil lalu diunggah ke Cloudinary; yang disimpan hanya URL.
export default function GrAttachments({ creds, urls, onChange, max = 10 }: {
  creds: string; urls: string[]; onChange: (urls: string[]) => void; max?: number;
}) {
  const toast = useToast();
  const [uploading, setUploading] = useState(0);

  const pick = async (list: FileList | null) => {
    const files = Array.from(list ?? []);
    if (files.length === 0) return;
    const room = max - urls.length;
    if (room <= 0) { toast.error(`Maksimal ${max} lampiran.`); return; }
    const take = files.slice(0, room);
    if (files.length > room) toast.error(`Hanya ${room} foto lagi yang muat (maks ${max}).`);
    setUploading(take.length);
    const added: string[] = [];
    for (const f of take) {
      try { added.push(await uploadImage(f, creds, 1400)); }
      catch { toast.error(`Gagal mengunggah ${f.name}.`); }
      setUploading(n => n - 1);
    }
    if (added.length > 0) onChange([...urls, ...added]);
  };

  const busy = uploading > 0;
  const btn = 'btn-ghost text-xs flex-1 justify-center cursor-pointer';
  return (
    <div>
      {urls.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 mb-2">
          {urls.map((u, i) => (
            <div key={u} className="relative rounded-lg overflow-hidden" style={{ border: '1px solid var(--border-2)', aspectRatio: '1 / 1' }}>
              <a href={u} target="_blank" rel="noopener noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={u} alt={`Lampiran ${i + 1}`} className="w-full h-full object-cover" />
              </a>
              <button type="button" aria-label="Hapus lampiran" onClick={() => onChange(urls.filter((_, idx) => idx !== i))}
                className="absolute top-1 right-1 w-5 h-5 rounded-full flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.6)', color: '#fff' }}>
                <X size={11} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <label className={btn} style={{ height: 40, opacity: busy ? 0.6 : 1 }}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />} {busy ? `Mengunggah (${uploading})…` : 'Pilih foto'}
          <input type="file" accept="image/*" multiple className="hidden" disabled={busy || urls.length >= max} onChange={e => { void pick(e.target.files); e.target.value = ''; }} />
        </label>
        <label className={btn} style={{ height: 40, opacity: busy ? 0.6 : 1 }}>
          <Camera size={14} /> Ambil foto
          <input type="file" accept="image/*" capture="environment" className="hidden" disabled={busy || urls.length >= max} onChange={e => { void pick(e.target.files); e.target.value = ''; }} />
        </label>
      </div>
      <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-muted)' }}>{urls.length}/{max} foto · ikut tercetak sebagai halaman Lampiran di GR & DO.</p>
    </div>
  );
}
