import { describe, it, expect } from 'vitest';
import { normalizeText, shouldForward, parseKeywordList, messageKey, buildForwardMessage, WA_GROUP_JID_RE, suggestGroup } from './wa-forward';

describe('shouldForward', () => {
  const kw = ['stok', 'sisa', 'mie kremes'];
  it('cocok tanpa peduli huruf besar & tanda baca', () => {
    expect(shouldForward('STOK: mie kremes 12 pcs', kw)).toBe(true);
    expect(shouldForward('sisa!! 5', kw)).toBe(true);
    expect(shouldForward('Mie   Kremes habis', kw)).toBe(true);
  });
  it('hanya kata utuh, bukan potongan kata', () => {
    expect(shouldForward('sudah disiapkan ya', kw)).toBe(false);
    expect(shouldForward('stokis baru datang', kw)).toBe(false);
  });
  it('obrolan biasa tidak lolos', () => {
    expect(shouldForward('selamat pagi semua', kw)).toBe(false);
    expect(shouldForward('   ', kw)).toBe(false);
  });
  it('kata kunci pengecualian menolak walau ada kata stok', () => {
    expect(shouldForward('stok kosong? tolong kirim ya', kw, ['tolong'])).toBe(false);
  });
});

describe('parseKeywordList', () => {
  it('memecah koma/baris, merapikan, membuang duplikat', () => {
    expect(parseKeywordList('Stok, sisa\n  mie   kremes , STOK, ,')).toEqual(['Stok', 'sisa', 'mie kremes']);
  });
  it('menerima array & mengabaikan non-string', () => {
    expect(parseKeywordList(['a', 1, 'b', 'A'])).toEqual(['a', 'b']);
  });
  it('input aneh → kosong', () => { expect(parseKeywordList(null)).toEqual([]); });
});

describe('lain-lain', () => {
  it('normalizeText', () => { expect(normalizeText(' Stok: 12!! ')).toBe('stok 12'); });
  it('messageKey', () => { expect(messageKey('1@g.us', 'ABC')).toBe('1@g.us:ABC'); });
  it('JID grup', () => {
    expect(WA_GROUP_JID_RE.test('120363012345678901@g.us')).toBe(true);
    expect(WA_GROUP_JID_RE.test('6281234@s.whatsapp.net')).toBe(false);
  });
  it('format pesan memuat mitra, pengirim, dan isi', () => {
    const m = buildForwardMessage({ locationName: 'Kopi Nusantara', senderName: 'Budi', at: new Date('2026-10-14T03:32:00Z'), body: ' stok 12 ' });
    expect(m).toContain('📦 *Kopi Nusantara*');
    expect(m).toContain('Budi');
    expect(m).toContain('2026');
    expect(m.endsWith('stok 12')).toBe(true);
  });
});

describe('suggestGroup', () => {
  const groups = [
    { jid: '1@g.us', subject: 'Mie Kremes - Kopi Nusantara' },
    { jid: '2@g.us', subject: 'Warung Bu Sari Stok' },
    { jid: '3@g.us', subject: 'Keluarga Besar' },
  ];
  it('memilih grup dengan nama paling mirip', () => {
    expect(suggestGroup('Kopi Nusantara', groups)).toBe('1@g.us');
    expect(suggestGroup('Warung Sari', groups)).toBe('2@g.us');
  });
  it('tanpa kecocokan → null; grup terpakai dilewati', () => {
    expect(suggestGroup('Toko Maju Jaya', groups)).toBeNull();
    expect(suggestGroup('Kopi Nusantara', groups, new Set(['1@g.us']))).toBeNull();
  });
  it('nama terlalu pendek → null', () => { expect(suggestGroup('A B', groups)).toBeNull(); });
});
