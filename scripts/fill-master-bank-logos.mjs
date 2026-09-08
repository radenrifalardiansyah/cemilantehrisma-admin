#!/usr/bin/env node
// One-time: isi `master_banks.logo_url` secara otomatis untuk bank/e-wallet yang belum punya
// logo — cari artikel di Wikipedia Indonesia (paling akurat buat resolve akronim seperti
// "BCA"/"BRI" ke entitas yang benar), map ke item Wikidata-nya, ambil klaim P154 (logo image),
// resolve ke file Commons, unduh, konversi ke PNG kalau SVG (Cloudinary account ini tidak selalu
// mengizinkan upload SVG mentah), lalu upload ke Cloudinary & simpan URL-nya.
//
// Kalau tidak ketemu match yang meyakinkan di satu tahap manapun, bank itu DILEWATI (logo_url
// tetap null) — bukan dipaksa pakai gambar yang salah. UI sudah punya fallback ikon generik
// untuk bank yang belum ada logonya.
//
// Usage: node scripts/fill-master-bank-logos.mjs [--limit N] [--only code1,code2]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import crypto from 'node:crypto';
import postgres from 'postgres';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UA = 'CemilanTehRismaAdminBot/1.0 (internal business tool; logo lookup for payment bank picker)';

function loadEnvLocal() {
  const envPath = path.join(__dirname, '..', '.env.local');
  const content = readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) process.env[match[1]] ??= match[2].replace(/^"(.*)"$/, '$1');
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Wikimedia API kadang balas 429 text/plain ("You are making too many requests...") alih-alih
// JSON — retry dengan backoff kalau itu terjadi, jangan langsung anggap "tidak ketemu".
async function apiGet(url, attempt = 1) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    if (attempt >= 6) throw new Error(`Non-JSON response after retries: ${text.slice(0, 120)}`);
    await sleep(8000 * attempt);
    return apiGet(url, attempt + 1);
  }
}

const DELAY_MS = 2500;

async function findWikidataItem(name) {
  const candidates = [name];
  const stripped = name.replace(/\s*\([^)]*\)\s*/g, '').trim();
  if (stripped && stripped !== name) candidates.push(stripped);

  for (const q of candidates) {
    await sleep(DELAY_MS);
    const searchUrl = `https://id.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&format=json&srlimit=1`;
    const sjson = await apiGet(searchUrl);
    const top = sjson.query?.search?.[0];
    if (!top) continue;

    await sleep(DELAY_MS);
    const ppUrl = `https://id.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(top.title)}&prop=pageprops&ppprop=wikibase_item&format=json`;
    const pjson = await apiGet(ppUrl);
    const page = Object.values(pjson.query?.pages ?? {})[0];
    const qid = page?.pageprops?.wikibase_item;
    if (qid) return { qid, matchedTitle: top.title, matchedQuery: q };
  }
  return null;
}

// Full-text Wikipedia search hanya menjamin nama muncul DI SUATU TEMPAT di artikel, bukan bahwa
// artikelnya benar-benar TENTANG entitas itu (kejadian nyata: "AstraPay" nyangkut ke artikel "MRT
// Jakarta" karena MRT Jakarta menyebut AstraPay sebagai metode bayar; "ShopeePay" nyangkut ke
// "QRIS"). Makanya match harus diverifikasi dulu sebelum dipakai:
//
// 1. Token overlap — pecah nama & judul artikel jadi kata (huruf/angka saja, lowercase), match
//    diterima kalau ada minimal satu kata SIGNIFIKAN yang sama persis di keduanya. Ini menangkap
//    kasus normal terlepas dari urutan kata ("Permata Bank" vs "Bank Permata") maupun typo/
//    singkatan resmi ("GoPay" vs "Gopay"), sekaligus menolak match yang beneran tidak berhubungan
//    sama sekali ("AstraPay" vs "MRT Jakarta" — nol kata yang sama).
//    Kata generik ("bank", "syariah", "indonesia", dst) DIBUANG dari perhitungan overlap — kejadian
//    nyata: "Bank Aceh Syariah" sempat lolos nyangkut ke logo "Bank Syariah Indonesia" (BSI) cuma
//    gara-gara sama-sama punya kata "bank" & "syariah", padahal dua bank yang beda sama sekali.
//    Kata generik ini muncul di puluhan nama bank syariah/BUMN/BPD berbeda, jadi tidak boleh
//    dianggap bukti kecocokan.
// 2. Fallback akronim — kalau nama aslinya cuma singkatan huruf besar tanpa spasi (BCA, BRI, BNI,
//    BTN, dst), token overlap PASTI gagal karena hurufnya tidak match kata hasil kepanjangannya.
//    Untuk kasus ini diterima asal deskripsi Wikidata-nya masih menyebut sesuatu yang berbau
//    korporat/finansial (bank/perusahaan/company/dompet/dst) sebagai pengaman tambahan.
const STOPWORDS = new Set([
  'bank', 'syariah', 'indonesia', 'negara', 'rakyat', 'tabungan', 'nasional', 'internasional',
  'international', 'daerah', 'pembangunan', 'digital', 'perusahaan', 'company', 'dan', 'the', 'of',
]);
function tokenize(s) {
  return new Set((s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(t => t.length >= 3 && !STOPWORDS.has(t)));
}
function tokenOverlap(a, b) {
  const ta = tokenize(a), tb = tokenize(b);
  for (const t of ta) if (tb.has(t)) return true;
  return false;
}
const ACRONYM_RE = /^[A-Z]{2,6}$/;
const GENERIC_CORP_RE = /bank|compan|perusahaan|wallet|dompet|pembayaran|payment|platform|aplikasi|digital/i;

async function getLogoFilename(qid, name, matchedTitle) {
  await sleep(DELAY_MS);
  const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qid}&props=claims|descriptions&languages=id|en&format=json`;
  const json = await apiGet(url);
  const entity = json.entities?.[qid];
  const claims = entity?.claims;
  const desc = [entity?.descriptions?.id?.value, entity?.descriptions?.en?.value].filter(Boolean).join(' | ');

  const nameNoParens = name.replace(/\s*\([^)]*\)\s*/g, '').trim();
  const overlaps = tokenOverlap(nameNoParens, matchedTitle);
  const isAcronym = ACRONYM_RE.test(nameNoParens.replace(/\s+/g, ''));
  const accepted = overlaps || (isAcronym && GENERIC_CORP_RE.test(desc));
  if (!accepted) return { filename: null, desc, rejected: true };

  const logo = claims?.P154?.[0]?.mainsnak?.datavalue?.value;
  return { filename: logo ?? null, desc, rejected: false };
}

async function resolveCommonsFile(filename) {
  await sleep(DELAY_MS);
  const title = `File:${filename}`;
  const url = `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(title)}&prop=imageinfo&iiprop=url|mime&format=json`;
  const json = await apiGet(url);
  const page = Object.values(json.query?.pages ?? {})[0];
  const info = page?.imageinfo?.[0];
  if (!info?.url) return null;
  return { url: info.url, mime: info.mime };
}

async function downloadBuffer(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`download failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function toPngIfNeeded(buffer, mime) {
  if (mime === 'image/svg+xml' || mime === 'image/svg') {
    return sharp(buffer).resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  }
  // Raster logos from Wikimedia can be large; downsize + normalize to PNG (keeps alpha) so
  // Cloudinary storage/display stays consistent with the SVG-derived ones.
  return sharp(buffer).resize(512, 512, { fit: 'inside', withoutEnlargement: true }).png().toBuffer();
}

async function uploadToCloudinary(buffer, filename) {
  const CLOUD = process.env.CLOUDINARY_CLOUD_NAME;
  const KEY = process.env.CLOUDINARY_API_KEY;
  const SEC = process.env.CLOUDINARY_API_SECRET;
  const folder = 'master-banks';
  const timestamp = Math.round(Date.now() / 1000);
  const paramStr = `folder=${folder}&timestamp=${timestamp}${SEC}`;
  const signature = crypto.createHash('sha1').update(paramStr).digest('hex');

  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(buffer)], { type: 'image/png' }), filename);
  form.append('folder', folder);
  form.append('timestamp', String(timestamp));
  form.append('api_key', KEY);
  form.append('signature', signature);

  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD}/image/upload`, { method: 'POST', body: form });
  if (!res.ok) throw new Error(`cloudinary upload failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data.secure_url;
}

async function main() {
  loadEnvLocal();
  const args = process.argv.slice(2);
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx >= 0 ? Number(args[limitIdx + 1]) : Infinity;
  const onlyIdx = args.indexOf('--only');
  const only = onlyIdx >= 0 ? args[onlyIdx + 1].split(',') : null;

  const sql = postgres(process.env.DIRECT_URL, { prepare: false, max: 3 });
  let banks = await sql`select code, name, ewallet from master_banks where logo_url is null order by name asc`;
  if (only) banks = banks.filter(b => only.includes(b.code));
  banks = banks.slice(0, limit);

  console.log(`Memproses ${banks.length} bank tanpa logo...\n`);

  let filled = 0, skipped = 0;
  const retryQueue = [];

  const processOne = async (b) => {
    const found = await findWikidataItem(b.name);
    if (!found) { console.log(`SKIP   ${b.name} (${b.code}) — tidak ketemu artikel Wikipedia ID yang cocok`); skipped++; return; }

    const logoResult = await getLogoFilename(found.qid, b.name, found.matchedTitle);
    if (logoResult.rejected) { console.log(`SKIP   ${b.name} (${b.code}) — ${found.qid} (${found.matchedTitle}) tidak ada kecocokan kata/deskripsi ("${logoResult.desc}"), kemungkinan match salah`); skipped++; return; }
    const filename = logoResult.filename;
    if (!filename) { console.log(`SKIP   ${b.name} (${b.code}) — ${found.qid} (${found.matchedTitle}) tidak punya klaim logo (P154)`); skipped++; return; }

    const file = await resolveCommonsFile(filename);
    if (!file) { console.log(`SKIP   ${b.name} (${b.code}) — file Commons "${filename}" tidak ketemu`); skipped++; return; }

    const raw = await downloadBuffer(file.url);
    const png = await toPngIfNeeded(raw, file.mime);
    const cdnUrl = await uploadToCloudinary(png, `${b.code}.png`);

    await sql`update master_banks set logo_url = ${cdnUrl} where code = ${b.code}`;
    console.log(`OK     ${b.name} (${b.code}) — ${found.matchedTitle} -> ${filename} -> ${cdnUrl}`);
    filled++;
  };

  for (const b of banks) {
    try {
      await processOne(b);
    } catch (err) {
      console.log(`RETRY-LATER ${b.name} (${b.code}) — ${err.message}`);
      retryQueue.push(b);
    }
  }

  let failed = 0;
  if (retryQueue.length > 0) {
    console.log(`\nMenunggu 20 detik lalu retry ${retryQueue.length} bank yang gagal (kemungkinan rate-limit sementara)...\n`);
    await sleep(20000);
    for (const b of retryQueue) {
      try {
        await processOne(b);
      } catch (err) {
        console.log(`FAILED ${b.name} (${b.code}) — ${err.message}`);
        failed++;
      }
    }
  }

  console.log(`\nSelesai. Terisi: ${filled}, dilewati: ${skipped}, gagal: ${failed}, total diproses: ${banks.length}`);
  await sql.end();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('GAGAL:', err.message);
  process.exit(1);
});
