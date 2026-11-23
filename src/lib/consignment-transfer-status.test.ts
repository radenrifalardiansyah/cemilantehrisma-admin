import { describe, expect, it } from 'vitest';
import {
  canTransferAct, transferActionBlockedReason, normalizeTransferStatus, approvedTransfers,
  mergeTransferItems, invalidTransferItemsMessage, type TransferStatus,
} from './consignment-transfer-status';

describe('aturan aksi transfer', () => {
  const all: TransferStatus[] = ['draft', 'approved', 'ditolak', 'dibatalkan'];
  it('edit/approve/reject hanya draft; cancel hanya approved; delete semua kecuali approved', () => {
    for (const st of all) {
      expect(canTransferAct(st, 'edit')).toBe(st === 'draft');
      expect(canTransferAct(st, 'approve')).toBe(st === 'draft');
      expect(canTransferAct(st, 'reject')).toBe(st === 'draft');
      expect(canTransferAct(st, 'cancel')).toBe(st === 'approved');
      expect(canTransferAct(st, 'delete')).toBe(st !== 'approved');
    }
  });
  it('pesan penolakan ada untuk semua aksi terblokir dan null bila boleh', () => {
    for (const st of all) for (const a of ['edit', 'delete', 'approve', 'reject', 'cancel'] as const) {
      expect(transferActionBlockedReason(st, a) === null).toBe(canTransferAct(st, a));
    }
  });
  it('status tak dikenal dianggap draft (tidak pernah dihitung sebagai efek stok)', () => {
    expect(normalizeTransferStatus(undefined)).toBe('draft');
    expect(normalizeTransferStatus('x')).toBe('draft');
    expect(approvedTransfers([{ status: 'approved' }, { status: 'draft' }, { status: 'dibatalkan' }, {}])).toHaveLength(1);
  });
});

describe('item transfer', () => {
  it('menggabungkan produk duplikat', () => {
    expect(mergeTransferItems([{ productId: 'a', qty: 2 }, { productId: 'b', qty: 1 }, { productId: 'a', qty: 3 }]))
      .toEqual([{ productId: 'a', qty: 5 }, { productId: 'b', qty: 1 }]);
  });
  it('validasi', () => {
    expect(invalidTransferItemsMessage(undefined)).toBeTruthy();
    expect(invalidTransferItemsMessage([])).toBeTruthy();
    expect(invalidTransferItemsMessage([{ productId: '', qty: 1 }])).toBeTruthy();
    expect(invalidTransferItemsMessage([{ productId: 'a', qty: 0 }])).toBeTruthy();
    expect(invalidTransferItemsMessage([{ productId: 'a', qty: 1 }])).toBeNull();
  });
});
