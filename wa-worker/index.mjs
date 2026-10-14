// Worker "Teruskan Stok WA": membaca grup WA mitra dan meneruskan pesan stok ke grup kita.
// Jalankan di laptop/PC/server sendiri (bukan Vercel): proses harus hidup terus agar koneksi WhatsApp terjaga.
import makeWASocket, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, normalizeMessageContent } from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import { assertEnv, getConfig, postGroups, postLog, patchLog } from './api.mjs';
import { shouldForward, buildForwardMessage } from './filter.mjs';

assertEnv();
const logger = pino({ level: process.env.LOG_LEVEL ?? 'warn' });
const log = (...a) => console.log(new Date().toLocaleTimeString('id-ID'), ...a);

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
    if (d.resync) await syncGroups();
  } catch (e) { log('config gagal (jaringan?):', e.message); }
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
  if (!jid?.endsWith('@g.us') || m.key.fromMe || !config?.enabled || !config.targetJid) return;
  if (jid === config.targetJid) return; // jangan pernah membaca grup tujuan (cegah loop)
  const link = config.links.get(jid);
  if (!link) return;
  const ts = Number(m.messageTimestamp) || Math.floor(Date.now() / 1000);
  if (Date.now() / 1000 - ts > MAX_AGE_S) return;
  const body = extractText(m);
  if (!body || !shouldForward(body, config.keywords, config.excludeKeywords)) return;
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
  sock = makeWASocket({
    version, auth, logger, browser: ['Teruskan Stok WA', 'Chrome', '1.0'],
    syncFullHistory: false, markOnlineOnConnect: false, getMessage: async () => undefined,
  });
  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) { state = 'qr'; log('Scan QR ini di WhatsApp nomor cadangan (Perangkat tertaut → Tautkan perangkat):'); qrcode.generate(qr, { small: true }); refreshConfig(); }
    if (connection === 'connecting') state = 'connecting';
    if (connection === 'open') { state = 'open'; log('WhatsApp terhubung.'); await refreshConfig(); if (!lastGroupsAt) await syncGroups(); }
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
      connect().catch(e => { log('gagal menyambung:', e.message); });
    }
  });
  sock.ev.on('messages.upsert', ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const m of messages) onMessage(m).catch(e => log('error pesan:', e.message));
  });
}

process.on('unhandledRejection', e => log('unhandledRejection:', e?.message ?? e));
setInterval(() => {
  refreshConfig();
  if (state === 'open' && Date.now() - lastGroupsAt > GROUPS_REFRESH_MS) syncGroups();
}, HEARTBEAT_MS);
await refreshConfig();
await connect();
