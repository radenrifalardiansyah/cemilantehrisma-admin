// Ringkasan untuk Laporan PO, Laporan GR, dan Laporan Stok Opname (logika murni, tanpa database —
// dipakai route /api/reports/* dan diuji di procurement-report.test.ts).

export interface PoReportRow {
  id: string; poNumber: string; date: string; supplierName: string; items: string; total: number;
  status: string; expectedDate: string | null; receivedValue: number; late: boolean;
}
export interface GrReportRow {
  id: string; grNumber: string; doNumber: string; poNumber: string; supplierName: string; receivedDate: string;
  items: string; total: number; status: string; approvedBy: string | null; paymentStatus: string | null; purchaseVoided: boolean;
}
export interface OpnameReportRow {
  id: string; createdAt: string; warehouseName: string; productName: string;
  delta: number;        // + = fisik lebih banyak dari sistem, − = kurang
  unitCost: number; value: number; // value bertanda mengikuti delta
  note: string;
}

export interface SupplierBreakdown { name: string; count: number; total: number }

export function summarizePo(rows: PoReportRow[]) {
  const active = rows.filter(r => r.status !== 'batal');
  const byStatus: Record<string, number> = {};
  rows.forEach(r => { byStatus[r.status] = (byStatus[r.status] ?? 0) + 1; });
  const totalValue = active.reduce((s, r) => s + r.total, 0);
  const receivedValue = active.reduce((s, r) => s + Math.min(r.receivedValue, r.total), 0);
  return {
    count: rows.length, byStatus, totalValue, receivedValue,
    outstandingValue: Math.max(0, totalValue - receivedValue),
    lateCount: rows.filter(r => r.late).length,
    bySupplier: breakdown(active.map(r => ({ name: r.supplierName, total: r.total }))),
  };
}

export function summarizeGr(rows: GrReportRow[]) {
  const approved = rows.filter(r => r.status === 'approved' && !r.purchaseVoided);
  const byStatus: Record<string, number> = {};
  rows.forEach(r => { byStatus[r.status] = (byStatus[r.status] ?? 0) + 1; });
  return {
    count: rows.length, byStatus,
    approvedValue: approved.reduce((s, r) => s + r.total, 0),
    unpaidValue: approved.filter(r => r.paymentStatus === 'belum_lunas').reduce((s, r) => s + r.total, 0),
    pendingValue: rows.filter(r => r.status === 'draft').reduce((s, r) => s + r.total, 0),
    bySupplier: breakdown(approved.map(r => ({ name: r.supplierName, total: r.total }))),
  };
}

export function summarizeOpname(rows: OpnameReportRow[]) {
  const gain = rows.filter(r => r.delta > 0).reduce((s, r) => s + r.value, 0);
  const loss = rows.filter(r => r.delta < 0).reduce((s, r) => s + Math.abs(r.value), 0);
  const byWarehouse = new Map<string, { name: string; count: number; total: number }>();
  rows.forEach(r => {
    const w = byWarehouse.get(r.warehouseName) ?? { name: r.warehouseName, count: 0, total: 0 };
    w.count += 1; w.total += r.value; byWarehouse.set(r.warehouseName, w);
  });
  return {
    count: rows.length, gain, loss, net: gain - loss,
    unitsOver: rows.filter(r => r.delta > 0).reduce((s, r) => s + r.delta, 0),
    unitsShort: rows.filter(r => r.delta < 0).reduce((s, r) => s + Math.abs(r.delta), 0),
    byWarehouse: [...byWarehouse.values()].sort((a, b) => a.total - b.total),
  };
}

function breakdown(items: { name: string; total: number }[]): SupplierBreakdown[] {
  const m = new Map<string, SupplierBreakdown>();
  for (const it of items) {
    const key = it.name || 'Tanpa nama';
    const b = m.get(key) ?? { name: key, count: 0, total: 0 };
    b.count += 1; b.total += it.total; m.set(key, b);
  }
  return [...m.values()].sort((a, b) => b.total - a.total);
}
