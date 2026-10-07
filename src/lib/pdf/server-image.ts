import { isValidSignatureUrl } from '@/lib/profile-signature';

// Ambil gambar tanda tangan (URL Cloudinary) jadi data-URI untuk PDF yang dirender di server.
// Hanya URL Cloudinary yang lolos validasi (cegah SSRF), batas ukuran 1 MB & waktu 5 detik, dan hasilnya
// di-cache 1 jam di memori instance supaya link PDF yang sering dibuka tidak mengunduh ulang tiap kali.
const TTL_MS = 60 * 60 * 1000;
const MAX_BYTES = 1_000_000;
const cache = new Map<string, { value: string | undefined; at: number }>();

export async function serverSignatureDataUri(url?: string | null): Promise<string | undefined> {
  if (!url || !isValidSignatureUrl(url)) return undefined;
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  let value: string | undefined;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const type = res.headers.get('content-type') ?? '';
    if (res.ok && /^image\/(png|jpe?g|webp|gif)/.test(type)) {
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.byteLength <= MAX_BYTES) value = `data:${type.split(';')[0]};base64,${buf.toString('base64')}`;
    }
  } catch { /* tanpa tanda tangan kalau gagal diambil */ }
  cache.set(url, { value, at: Date.now() });
  return value;
}
