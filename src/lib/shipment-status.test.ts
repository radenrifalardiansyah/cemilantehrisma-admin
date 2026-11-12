import { describe, expect, it } from 'vitest';
import {
  normalizeShipmentStatus, isApprovedShipment, approvedShipments, canShipmentAct,
  shipmentActionBlockedReason, isStaleShipmentDate, STALE_APPROVE_DAYS, SHIPMENT_APPROVED,
} from './shipment-status';
import { rowToShipment, type ShipmentRow } from './shipments-pg';

describe('normalizeShipmentStatus', () => {
  it('status dikenal dipertahankan', () => {
    expect(normalizeShipmentStatus('draft')).toBe('draft');
    expect(normalizeShipmentStatus('approved')).toBe('approved');
    expect(normalizeShipmentStatus('ditolak')).toBe('ditolak');
  });
  it('kosong/tak dikenal = approved (data lama)', () => {
    for (const v of [null, undefined, '', 'DRAFT', 'x', 1]) expect(normalizeShipmentStatus(v)).toBe('approved');
  });
});

describe('filter approved', () => {
  it('isApprovedShipment & approvedShipments', () => {
    const list = [{ id: 1, status: 'draft' }, { id: 2, status: 'approved' }, { id: 3, status: 'ditolak' }, { id: 4 }, { id: 5, status: null }];
    expect(isApprovedShipment({ status: SHIPMENT_APPROVED })).toBe(true);
    expect(approvedShipments(list).map(s => s.id)).toEqual([2, 4, 5]);
  });
});

describe('aturan transisi', () => {
  it('approve/reject hanya dari draft', () => {
    expect(canShipmentAct('draft', 'approve')).toBe(true);
    expect(canShipmentAct('draft', 'reject')).toBe(true);
    for (const st of ['approved', 'ditolak'] as const) {
      expect(canShipmentAct(st, 'approve')).toBe(false);
      expect(canShipmentAct(st, 'reject')).toBe(false);
    }
  });
  it('edit: draft & approved boleh, ditolak tidak', () => {
    expect(canShipmentAct('draft', 'edit')).toBe(true);
    expect(canShipmentAct('approved', 'edit')).toBe(true);
    expect(canShipmentAct('ditolak', 'edit')).toBe(false);
  });
  it('hapus boleh di semua status', () => {
    for (const st of ['draft', 'approved', 'ditolak'] as const) expect(canShipmentAct(st, 'delete')).toBe(true);
  });
  it('pesan penolakan', () => {
    expect(shipmentActionBlockedReason('draft', 'approve')).toBeNull();
    expect(shipmentActionBlockedReason('approved', 'approve')).toMatch(/sudah di-approve/);
    expect(shipmentActionBlockedReason('approved', 'reject')).toMatch(/sudah di-approve/);
    expect(shipmentActionBlockedReason('ditolak', 'edit')).toMatch(/ditolak/);
    expect(shipmentActionBlockedReason('ditolak', 'approve')).toMatch(/ditolak/);
  });
});

describe('isStaleShipmentDate', () => {
  const now = Date.UTC(2026, 10, 12);
  const sec = (daysAgo: number) => Math.floor((now - daysAgo * 86400_000) / 1000);
  it('lebih dari batas hari = true, selebihnya false', () => {
    expect(STALE_APPROVE_DAYS).toBe(7);
    expect(isStaleShipmentDate(sec(8), now)).toBe(true);
    expect(isStaleShipmentDate(sec(7), now)).toBe(false);
    expect(isStaleShipmentDate(sec(0), now)).toBe(false);
    expect(isStaleShipmentDate(undefined, now)).toBe(false);
  });
});

describe('rowToShipment memetakan status', () => {
  const base: ShipmentRow = {
    id: 'a', location_id: 'L', location_name: 'Loc', warehouse_id: 'W', warehouse_name: 'Gudang', items: '[]', note: null,
    created_at: new Date('2026-11-01T00:00:00Z'), updated_at: null,
    status: null, approved_by: null, approved_at: null, rejected_by: null, rejected_at: null, reject_reason: null, created_by: null,
  };
  it('baris lama (status null) = approved', () => {
    expect(rowToShipment(base)).toMatchObject({ status: 'approved', approvedAt: null, rejectReason: null });
  });
  it('draft & ditolak membawa metadata', () => {
    expect(rowToShipment({ ...base, status: 'draft', created_by: 'rifal' })).toMatchObject({ status: 'draft', createdBy: 'rifal' });
    const r = rowToShipment({ ...base, status: 'ditolak', rejected_by: 'x', rejected_at: new Date('2026-11-02T00:00:00Z'), reject_reason: 'salah qty' });
    expect(r).toMatchObject({ status: 'ditolak', rejectedBy: 'x', rejectReason: 'salah qty' });
    expect(r.rejectedAt?.seconds).toBe(Math.floor(new Date('2026-11-02T00:00:00Z').getTime() / 1000));
  });
});
