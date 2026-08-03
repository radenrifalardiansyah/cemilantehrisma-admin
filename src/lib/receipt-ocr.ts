// Client-side OCR (Tesseract.js) for reading the transferred amount off a
// photographed/screenshotted bank transfer receipt. Runs entirely in the
// browser — no cloud API key/billing needed.

import type { Worker } from 'tesseract.js';

const AMOUNT_RE = /(?:Rp\.?\s*|IDR\s*)?\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{2})?/gi;
const PREFIXED_HINT_RE = /(?:Rp\.?|IDR|Nominal|Jumlah|Total)\s*[:.]?\s*$/i;

function parseAmount(raw: string): number {
  const cleaned = raw.replace(/Rp\.?|IDR/gi, '').trim();
  const groups = cleaned.split(/[.,]/);
  // Last group is a 2-digit decimal remainder (e.g. "150.000,50") — drop it.
  const isDecimalTail = groups.length > 1 && groups[groups.length - 1].length === 2;
  const intGroups = isDecimalTail ? groups.slice(0, -1) : groups;
  return parseInt(intGroups.join(''), 10);
}

/**
 * Reads bank-transfer receipt text off an image and returns the most likely
 * transferred amount, or null if nothing readable/plausible was found.
 * Never throws — OCR failures should fall back to manual entry, not an error.
 */
export async function recognizeTransferAmount(image: File | Blob): Promise<number | null> {
  let worker: Worker | null = null;
  try {
    const { createWorker } = await import('tesseract.js');
    worker = await createWorker('eng');
    await worker.setParameters({ tessedit_char_whitelist: '0123456789.,RpIDRrpNominalJumlahTotal: ' });
    const { data } = await worker.recognize(image);
    const text = data.text ?? '';

    const candidates: { value: number; hinted: boolean }[] = [];
    for (const match of text.matchAll(AMOUNT_RE)) {
      const value = parseAmount(match[0]);
      if (!Number.isFinite(value) || value <= 0) continue;
      const before = text.slice(Math.max(0, match.index! - 20), match.index!);
      candidates.push({ value, hinted: PREFIXED_HINT_RE.test(before) || /rp/i.test(match[0]) });
    }
    if (candidates.length === 0) return null;

    const hinted = candidates.filter(c => c.hinted);
    const pool = hinted.length > 0 ? hinted : candidates;
    return pool.reduce((max, c) => (c.value > max.value ? c : max)).value;
  } catch {
    return null;
  } finally {
    await worker?.terminate().catch(() => {});
  }
}
