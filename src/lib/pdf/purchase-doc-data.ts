import { formatDocDate, type PurchaseDocData, type PurchaseDocKind } from './PurchaseDocPDF';
import type { PoStatus, GrStatus, PoItem, GrItem } from '@/lib/purchase-orders-pg';

// Pemetaan data PO/GR (bentuk JSON API) ke data PDF — dipakai di browser maupun route publik PO,
// supaya isi dokumen identik di mana pun dicetak.

export interface PoLike {
  poNumber: string; supplierName: string; supplierPhone: string; items: PoItem[]; total: number;
  date: string; expectedDate: string | null; note: string; status: PoStatus; cancelNote: string | null;
}
export interface GrLike {
  grNumber: string; doNumber: string; supplierDoNumber: string; poNumber: string | null; supplierName: string | null;
  items: GrItem[]; total: number; receivedDate: string; note: string; status: GrStatus; cancelNote: string | null;
}

export function printedNow() {
  return new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function poToDocData(po: PoLike): PurchaseDocData {
  return {
    kind: 'po', number: po.poNumber, date: formatDocDate(po.date), printedAt: printedNow(),
    supplierName: po.supplierName, supplierPhone: po.supplierPhone || undefined,
    expectedDate: po.expectedDate ? formatDocDate(po.expectedDate) : undefined,
    items: po.items, total: po.total, note: po.note || undefined,
    ...(po.status === 'batal' ? { statusLabel: 'DIBATALKAN', statusTone: 'void' as const, cancelNote: po.cancelNote || undefined } : {}),
  };
}

export function grToDocData(gr: GrLike, kind: Exclude<PurchaseDocKind, 'po'>, supplierPhone?: string): PurchaseDocData {
  const status = gr.status === 'approved'
    ? { statusLabel: 'APPROVED', statusTone: 'ok' as const }
    : gr.status === 'dibatalkan'
      ? { statusLabel: 'DIBATALKAN', statusTone: 'void' as const, cancelNote: gr.cancelNote || undefined }
      : { statusLabel: 'DRAFT — BELUM DI-APPROVE', statusTone: 'warn' as const };
  return {
    kind, number: kind === 'do' ? gr.doNumber : gr.grNumber, date: formatDocDate(gr.receivedDate), printedAt: printedNow(),
    supplierName: gr.supplierName ?? '', supplierPhone,
    refPoNumber: gr.poNumber ?? undefined, refGrNumber: gr.grNumber, supplierDoNumber: gr.supplierDoNumber || undefined,
    items: gr.items, total: gr.total, note: gr.note || undefined, ...status,
  };
}
