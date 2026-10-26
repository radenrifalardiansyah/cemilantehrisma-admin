// Worker "Teruskan Stok WA": membaca grup WA mitra dan meneruskan pesan stok ke grup kita.
// Jalankan di laptop/PC/server sendiri (bukan Vercel): proses harus hidup terus agar koneksi WhatsApp terjaga.
import makeWASocket, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, normalizeMessageContent } from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import QRCode from 'qrcode';
import { createServer } from 'node:http';
import { assertEnv, getConfig, postGroups, postLog, patchLog, postEvents } from './api.mjs';
import { shouldForward, buildForwardMessage } from './filter.mjs';

assertEnv();
const logger = pino({ level: process.env.LOG_LEVEL ?? 'warn' });
// Semua log juga dikirim ke admin (tabel wa_worker_events) agar kejadian worker terlihat tanpa membuka Terminal.
const eventBuf = [];
const pushEvent = (level, a) => { eventBuf.push({ at: Date.now(), level, text: a.map(x => (typeof x === 'string' ? x : String(x?.message ?? x))).join(' ') }); if (eventBuf.length > 300) eventBuf.shift(); };
const log = (...a) => { console.log(new Date().toLocaleTimeString('id-ID'), ...a); pushEvent(/gagal|error|ditolak|GAGAL/i.test(a.join(' ')) ? 'error' : 'info', a); };
async function flushEvents() {
  if (eventBuf.length === 0) return;
  const batch = eventBuf.splice(0, 100);
  try { const r = await postEvents(batch); if (!r.ok) eventBuf.unshift(...batch.slice(0, 20)); } catch { eventBuf.unshift(...batch.slice(0, 20)); }
}

const HEARTBEAT_MS = 60_000;
const GROUPS_REFRESH_MS = 6 * 3600_000;
const MAX_AGE_S = 24 * 3600; // pesan lebih tua dari ini (mis. dikirim saat worker mati lama) tidak diteruskan
const MIN_DELAY_MS = 4_000, MAX_DELAY_MS = 10_000; // jeda acak antar kirim — kurangi risiko dianggap bot

let sock = null;
let state = 'connecting';
let config = null; // { enabled, targetJid, keywords, excludeKeywords, maxPerHour, links: Map<jid, {locationName}> }
let lastGroupsAt = 0;
const seen = new Set(); // anti-dobel di memori (server juga menjaga lewat message_key unik)
const queue = [];
const sentAt = []; // waktu kirim sukses (ms) — untuk batas per jam
let draining = false;

let desiredOn = true; // tombol Nyalakan/Matikan koneksi di admin (false = standby: program hidup, koneksi WhatsApp diputus)
let currentQr = null; // QR login terbaru — ditampilkan juga di halaman lokal agar mudah dipindai
// Opsional (FORWARD_OWN=1 di .env): ikut meneruskan pesan yang diketik dari nomor ini sendiri (mis. untuk uji coba). Default mati.
const FORWARD_OWN = process.env.FORWARD_OWN === '1';
const QR_PORT = Number(process.env.QR_PORT ?? 3939);

const DEBUG = process.env.DEBUG_MESSAGES === '1'; // catat alasan tiap pesan grup dilewati (untuk diagnosa)
const dbg = (...a) => { if (DEBUG) log('[debug]', ...a); };

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function refreshConfig() {
  try {
    const r = await getConfig(state);
    if (!r.ok) { log('config ditolak server:', r.status, r.data?.error ?? ''); return; }
    const d = r.data;
    config = {
      enabled: d.enabled, targetJid: d.targetJid, keywords: d.keywords, excludeKeywords: d.excludeKeywords, maxPerHour: d.maxPerHour,
      links: new Map(d.links.map(l => [l.jid, { locationName: l.locationName }])),
    };
    desiredOn = d.workerOn !== false;
    await applyDesired();
    if (d.resync) await syncGroups();
  } catch (e) { log('config gagal (jaringan?):', e.message); }
}

async function applyDesired() {
  if (!desiredOn && sock) {
    const old = sock;
    sock = null; currentQr = null; state = 'stopped';
    log('Koneksi WhatsApp dimatikan dari admin (standby, sesi login tetap tersimpan).');
    try { old.end(undefined); } catch { /* sudah tertutup */ }
  } else if (desiredOn && state === 'stopped' && !sock) {
    state = 'connecting';
    log('Koneksi WhatsApp dinyalakan dari admin, menyambung…');
    connect().catch(e => log('gagal menyambung:', e.message));
  }
}

async function syncGroups() {
  if (!sock || state !== 'open') return;
  try {
    const all = await sock.groupFetchAllParticipating();
    const groups = Object.values(all).map(g => ({ jid: g.id, subject: g.subject ?? '' }));
    const r = await postGroups(groups);
    lastGroupsAt = Date.now();
    log(`sinkron grup: ${groups.length} grup terdeteksi`, r.ok ? '' : `(server: ${r.status})`);
  } catch (e) { log('sinkron grup gagal:', e.message); }
}

function extractText(m) {
  const c = normalizeMessageContent(m.message);
  if (!c) return '';
  return c.conversation ?? c.extendedTextMessage?.text ?? c.imageMessage?.caption ?? c.videoMessage?.caption ?? c.documentMessage?.caption ?? '';
}

async function onMessage(m) {
  const jid = m.key?.remoteJid;
  if (!jid?.endsWith('@g.us')) return;
  const preview = extractText(m).slice(0, 40).replace(/\s+/g, ' ');
  if (m.key.fromMe && !FORWARD_OWN) { dbg(`lewati (dari nomor sendiri) ${jid} "${preview}"`); return; }
  if (!config?.enabled || !config.targetJid) { dbg(`lewati (fitur nonaktif / tanpa grup tujuan) "${preview}"`); return; }
  if (jid === config.targetJid) return; // jangan pernah membaca grup tujuan (cegah loop)
  const link = config.links.get(jid);
  if (!link) { dbg(`lewati (grup tidak terpasang ke mitra) ${jid} "${preview}"`); return; }
  const ts = Number(m.messageTimestamp) || Math.floor(Date.now() / 1000);
  if (Date.now() / 1000 - ts > MAX_AGE_S) { dbg(`lewati (terlalu lama) [${link.locationName}]`); return; }
  const body = extractText(m);
  if (!body) {
    const c = normalizeMessageContent(m.message);
    dbg(`lewati (bukan teks/caption) [${link.locationName}] jenis=${c ? Object.keys(c).join(',') : 'KOSONG (gagal dibuka?)'} stub=${m.messageStubType ?? '-'} fromMe=${!!m.key.fromMe}`);
    return;
  }
  if (!shouldForward(body, config.keywords, config.excludeKeywords)) { dbg(`lewati (tanpa kata kunci) [${link.locationName}] "${preview}"`); return; }
  const key = `${jid}:${m.key.id}`;
  if (seen.has(key)) return;
  seen.add(key);
  if (seen.size > 5000) seen.delete(seen.values().next().value);

  const senderName = m.pushName ?? '';
  try {
    const r = await postLog({ messageKey: key, sourceJid: jid, senderName, body });
    if (r.data?.duplicate) return;
    if (!r.ok) { log('log ditolak:', r.status, r.data?.error ?? ''); return; }
    queue.push({ id: r.data.id, text: buildForwardMessage({ locationName: r.data.locationName, senderName, at: new Date(ts * 1000), body }) });
    log(`antre: [${r.data.locationName}] ${body.slice(0, 50).replace(/\s+/g, ' ')}`);
    drain();
  } catch (e) { log('catat pesan gagal:', e.message); seen.delete(key); }
}

async function drain() {
  if (draining) return;
  draining = true;
  try {
    while (queue.length > 0) {
      if (state !== 'open' || !sock || !config?.targetJid) { await sleep(5_000); continue; }
      const cutoff = Date.now() - 3600_000;
      while (sentAt.length && sentAt[0] < cutoff) sentAt.shift();
      if (sentAt.length >= (config.maxPerHour ?? 60)) { log('batas per jam tercapai, menunggu…'); await sleep(30_000); continue; }
      const item = queue[0];
      let lastErr = '';
      let ok = false;
      for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
        try { await sock.sendMessage(config.targetJid, { text: item.text }); ok = true; }
        catch (e) { lastErr = e.message ?? 'gagal'; await sleep(attempt * 5_000); }
      }
      queue.shift();
      try { await patchLog(item.id, ok ? 'sent' : 'failed', ok ? undefined : lastErr); } catch (e) { log('lapor status gagal:', e.message); }
      if (ok) { sentAt.push(Date.now()); log('terkirim ke grup kita'); } else log('GAGAL kirim:', lastErr);
      await sleep(MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS));
    }
  } finally { draining = false; }
}

async function connect() {
  const { state: auth, saveCreds } = await useMultiFileAuthState('.auth');
  const { version } = await fetchLatestBaileysVersion();
  const s = sock = makeWASocket({
    version, auth, logger, browser: ['Teruskan Stok WA', 'Chrome', '1.0'],
    syncFullHistory: false, markOnlineOnConnect: false, getMessage: async () => undefined,
  });
  s.ev.on('creds.update', saveCreds);
  s.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (s !== sock) return; // socket lama (sudah dimatikan/diganti) diabaikan
    if (qr) { state = 'qr'; currentQr = qr; log('Scan QR ini di WhatsApp nomor cadangan (Perangkat tertaut → Tautkan perangkat):'); qrcode.generate(qr, { small: true }); refreshConfig(); }
    if (connection === 'connecting') state = 'connecting';
    if (connection === 'open') { state = 'open'; currentQr = null; log('WhatsApp terhubung.'); await refreshConfig(); if (!lastGroupsAt) await syncGroups(); }
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        state = 'logged-out';
        await refreshConfig();
        console.error('Nomor ini ter-logout dari WhatsApp. Hapus folder wa-worker/.auth lalu jalankan ulang untuk scan QR baru.');
        process.exit(1);
      }
      state = 'close';
      log(`koneksi putus (kode ${code ?? '?'}), menyambung ulang…`);
      await sleep(5_000);
      if (!desiredOn || s !== sock) return; // dimatikan dari admin selama jeda sambung ulang
      connect().catch(e => { log('gagal menyambung:', e.message); });
    }
  });
  s.ev.on('messages.upsert', ({ messages, type }) => {
    if (s !== sock) return;
    dbg(`messages.upsert type=${type} jumlah=${messages.length}`);
    if (type !== 'notify') return;
    for (const m of messages) onMessage(m).catch(e => log('error pesan:', e.message));
  });
}

// Halaman QR lokal (hanya 127.0.0.1): http://127.0.0.1:3939 — ikut berganti otomatis tiap QR baru.
createServer(async (req, res) => {
  if (req.url?.startsWith('/qr.png')) {
    if (!currentQr) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
    res.end(await QRCode.toBuffer(currentQr, { width: 380, margin: 2 }));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><meta charset="utf-8"><title>QR Teruskan Stok WA</title>
<body style="font-family:sans-serif;text-align:center;padding:24px">
<h2>Scan dengan WhatsApp</h2><p>Perangkat tertaut → Tautkan perangkat</p>
<div id="box"></div>
<script>
async function tick(){
  const ok=(await fetch('/qr.png',{cache:'no-store'})).ok;
  document.getElementById('box').innerHTML = ok ? '<img src="/qr.png?t='+Date.now()+'" width="380">' : '<p><b>Tidak ada QR.</b> Worker sudah terhubung, atau sedang menyambung…</p>';
}
tick(); setInterval(tick, 3000);
</script></body>`);
}).on('error', e => log('halaman QR tidak aktif:', e.message)).listen(QR_PORT, '127.0.0.1');

process.on('unhandledRejection', e => log('unhandledRejection:', e?.message ?? e));
setInterval(() => {
  refreshConfig();
  if (state === 'open' && Date.now() - lastGroupsAt > GROUPS_REFRESH_MS) syncGroups();
}, HEARTBEAT_MS);
setInterval(flushEvents, 10_000);
await refreshConfig();
if (desiredOn && !sock) await connect();
else if (!desiredOn) { state = 'stopped'; log('Worker standby: koneksi WhatsApp dimatikan dari admin.'); }
