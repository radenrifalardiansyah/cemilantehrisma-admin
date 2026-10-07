import { formatDocDate, type PurchaseDocData, type PurchaseDocKind } from './PurchaseDocPDF';
import type { PoStatus, GrStatus, PoItem, GrItem } from '@/lib/purchase-orders-pg';

// Pemetaan data PO/GR (bentuk JSON API) ke data PDF — dipakai di browser maupun route publik PO,
// supaya isi dokumen identik di mana pun dicetak.

export interface PoLike {
  poNumber: string; supplierName: string; supplierPhone: string; supplierPic?: string; items: PoItem[]; total: number;
  date: string; expectedDate: string | null; note: string; status: PoStatus; cancelNote: string | null;
  createdBy?: string | null; createdByName?: string | null;
}
export interface GrLike {
  grNumber: string; doNumber: string; poNumber: string | null; supplierName: string | null;
  items: GrItem[]; total: number; receivedDate: string; note: string; status: GrStatus; cancelNote: string | null;
  createdBy?: string | null; createdByName?: string | null; approvedBy?: string | null; approvedByName?: string | null;
  approvedAt?: { seconds: number } | null; paymentStatus?: string | null;
}

export function printedNow() {
  return new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// `sigs` = data-URI tanda tangan yang sudah di-resolve pemanggil (browser: toDataUri, server: serverSignatureDataUri).
export function poToDocData(po: PoLike, supplierAddress?: string, sigs?: { created?: string }): PurchaseDocData {
  return {
    kind: 'po', number: po.poNumber, date: formatDocDate(po.date), printedAt: printedNow(),
    supplierName: po.supplierName, supplierPhone: po.supplierPhone || undefined, supplierPic: po.supplierPic || undefined, supplierAddress: supplierAddress || undefined,
    expectedDate: po.expectedDate ? formatDocDate(po.expectedDate) : undefined, createdBy: po.createdByName || po.createdBy || undefined, createdBySignature: sigs?.created,
    items: po.items, total: po.total, note: po.note || undefined,
    ...(po.status === 'batal'
      ? { statusLabel: 'DIBATALKAN', statusTone: 'void' as const, cancelNote: po.cancelNote || undefined }
      : po.status === 'draft' ? { statusLabel: 'DRAFT', statusTone: 'warn' as const } : {}),
  };
}

export function grToDocData(gr: GrLike, kind: Exclude<PurchaseDocKind, 'po'>, supplier?: { phone?: string; address?: string; pic?: string }, sigs?: { created?: string; approved?: string }): PurchaseDocData {
  const status = gr.status === 'approved'
    ? { statusLabel: 'APPROVED', statusTone: 'ok' as const }
    : gr.status === 'dibatalkan'
      ? { statusLabel: 'DIBATALKAN', statusTone: 'void' as const, cancelNote: gr.cancelNote || undefined }
      : { statusLabel: 'DRAFT - BELUM DI-APPROVE', statusTone: 'warn' as const };
  return {
    kind, number: kind === 'do' ? gr.doNumber : gr.grNumber, date: formatDocDate(gr.receivedDate), printedAt: printedNow(),
    supplierName: gr.supplierName ?? '', supplierPhone: supplier?.phone || undefined, supplierPic: supplier?.pic || undefined, supplierAddress: supplier?.address || undefined,
    refPoNumber: gr.poNumber ?? undefined, refGrNumber: gr.grNumber, refDoNumber: gr.doNumber,
    createdBy: gr.createdByName || gr.createdBy || undefined, createdBySignature: sigs?.created,
    approvedBy: gr.approvedByName || gr.approvedBy || undefined, approvedBySignature: sigs?.approved,
    approvedAt: gr.approvedAt ? new Date(gr.approvedAt.seconds * 1000).toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'long', year: 'numeric' }) : undefined,
    paymentLabel: gr.status === 'approved' && gr.paymentStatus ? (gr.paymentStatus === 'belum_lunas' ? 'Belum Lunas' : 'Lunas') : undefined,
    items: gr.items, total: gr.total, note: gr.note || undefined, ...status,
  };
}
