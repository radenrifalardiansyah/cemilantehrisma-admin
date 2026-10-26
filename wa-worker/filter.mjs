// Salinan logika src/lib/wa-forward.ts (normalizeText, shouldForward, buildForwardMessage). Worker ini paket terpisah
// sehingga tidak bisa mengimpor TypeScript aplikasi. Kesamaan perilakunya dijaga tes src/lib/wa-worker-parity.test.ts —
// ubah di dua tempat sekaligus.

export function normalizeText(s) {
  return s.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function containsPhrase(normalizedText, keyword) {
  const k = normalizeText(keyword);
  if (!k) return false;
  return ` ${normalizedText} `.includes(` ${k} `);
}

export function shouldForward(text, keywords, excludeKeywords = []) {
  const t = normalizeText(text);
  if (!t) return false;
  if (excludeKeywords.some(k => containsPhrase(t, k))) return false;
  return keywords.some(k => containsPhrase(t, k));
}

export function extractMatchingLines(text, keywords, excludeKeywords = []) {
  return text.split(/\r?\n/).map(l => l.trim()).filter(l => l && shouldForward(l, keywords, excludeKeywords));
}

export function forwardBody(text, keywords, excludeKeywords = []) {
  const lines = extractMatchingLines(text, keywords, excludeKeywords);
  return lines.length > 0 ? lines.join('\n') : text.trim();
}

const WIB_FMT = new Intl.DateTimeFormat('id-ID', {
  timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

export function buildForwardMessage({ locationName, senderName, at, body }) {
  const when = WIB_FMT.format(at).replace(/\./g, ':').replace(' pukul ', ' ');
  const meta = [senderName.trim(), when].filter(Boolean).join(' · ');
  return `📦 *${locationName}*\n_${meta}_\n\n${body.trim()}`;
}
