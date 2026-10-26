// Logika murni fitur "Teruskan Stok WA": worker WhatsApp membaca grup mitra, memfilter pesan stok, lalu meneruskannya
// ke grup kita. Dipakai API (validasi) dan worker (pencocokan & format pesan).

// Huruf kecil, tanda baca → spasi, spasi berlebih dirapikan — supaya "Stok:" / "STOK!!" / "mie  kremes" cocok.
export function normalizeText(s: string): string {
  return s.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

// Kata kunci cocok bila muncul sebagai kata/frasa utuh ("sisa" tidak cocok dengan "disiapkan").
function containsPhrase(normalizedText: string, keyword: string): boolean {
  const k = normalizeText(keyword);
  if (!k) return false;
  return ` ${normalizedText} `.includes(` ${k} `);
}

// Lolos bila memuat minimal satu kata kunci dan tidak memuat kata kunci pengecualian.
export function shouldForward(text: string, keywords: string[], excludeKeywords: string[] = []): boolean {
  const t = normalizeText(text);
  if (!t) return false;
  if (excludeKeywords.some(k => containsPhrase(t, k))) return false;
  return keywords.some(k => containsPhrase(t, k));
}

// Baris-baris pesan yang memuat kata kunci (dan tidak memuat kata pengecualian). Update stok mitra biasanya daftar panjang berisi
// banyak produk; yang diteruskan hanya baris produk kita (mis. "Mie kremes 4"), bukan seluruh daftar.
export function extractMatchingLines(text: string, keywords: string[], excludeKeywords: string[] = []): string[] {
  return text.split(/\r?\n/).map(l => l.trim()).filter(l => l && shouldForward(l, keywords, excludeKeywords));
}

// Isi yang diteruskan: baris yang cocok; bila tak ada satu baris pun yang cocok sendiri (kata kunci terbelah antar baris) → pesan utuh.
export function forwardBody(text: string, keywords: string[], excludeKeywords: string[] = []): string {
  const lines = extractMatchingLines(text, keywords, excludeKeywords);
  return lines.length > 0 ? lines.join('\n') : text.trim();
}

// Daftar kata kunci dari input admin (dipisah koma/baris): dirapikan, tanpa duplikat & kosong.
export function parseKeywordList(raw: unknown, max = 50): string[] {
  const parts = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[,\n]/) : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    if (typeof p !== 'string') continue;
    const k = p.trim().replace(/\s+/g, ' ').slice(0, 60);
    const n = normalizeText(k);
    if (!n || seen.has(n)) continue;
    seen.add(n); out.push(k);
    if (out.length >= max) break;
  }
  return out;
}

// Kunci unik satu pesan WA (anti-dobel saat worker restart / pesan terkirim dua kali).
export function messageKey(jid: string, messageId: string): string {
  return `${jid}:${messageId}`;
}

const WIB_FMT = new Intl.DateTimeFormat('id-ID', {
  timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

// Pesan yang dikirim ke grup kita: label mitra + pengirim & waktu (WIB) + isi asli.
export function buildForwardMessage(p: { locationName: string; senderName: string; at: Date; body: string }): string {
  const when = WIB_FMT.format(p.at).replace(/\./g, ':').replace(' pukul ', ' ');
  const meta = [p.senderName.trim(), when].filter(Boolean).join(' · ');
  return `📦 *${p.locationName}*\n_${meta}_\n\n${p.body.trim()}`;
}

export const WA_GROUP_JID_RE = /^[0-9]+(-[0-9]+)?@g\.us$/;

// Saran grup untuk satu mitra berdasarkan kemiripan nama (hanya saran — admin yang memutuskan). Skor = porsi kata nama mitra
// (≥3 huruf) yang ada di nama grup; minimal 0,5. Grup yang sudah dipakai (`takenJids`) dilewati. Tanpa kecocokan → null.
export function suggestGroup(locationName: string, groups: { jid: string; subject: string }[], takenJids: Set<string> = new Set()): string | null {
  const words = normalizeText(locationName).split(' ').filter(w => w.length >= 3);
  if (words.length === 0) return null;
  let best: { jid: string; score: number } | null = null;
  for (const g of groups) {
    if (takenJids.has(g.jid)) continue;
    const subject = ` ${normalizeText(g.subject)} `;
    const score = words.filter(w => subject.includes(` ${w} `)).length / words.length;
    if (score >= 0.5 && (!best || score > best.score)) best = { jid: g.jid, score };
  }
  return best?.jid ?? null;
}
