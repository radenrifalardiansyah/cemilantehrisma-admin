import type { Stall, Warehouse } from '../titip-jual/shared';

export interface Ts { seconds: number }
export interface ShipmentItem { productId: string; name: string; qty: number; price: number }
export interface Shipment {
  id: string; docNumber: string; kind: 'send' | 'return' | 'opening'; stallId: string; stallName: string;
  fromWarehouseId: string; fromWarehouseName: string; docDate: string; items: ShipmentItem[];
  totalQty: number; totalValue: number; note: string; status: 'active' | 'void'; createdBy: string; createdAt: Ts | null;
}
export interface OwnSettlementItem { productId: string; productName: string; qty: number; amount: number }
export interface OwnSettlement {
  id: string; docNumber: string; stallId: string; stallName: string; periodFrom: string; periodTo: string;
  totalAmount: number; linesCount: number; items: OwnSettlementItem[]; status: 'unpaid' | 'paid'; note: string;
  createdBy: string; createdAt: Ts | null; paidAt: Ts | null; paidBy: string;
}
export interface PriceItem { productId: string; name: string; code: string; tokoPrice: number; stallPrice: number | null; stock: number; otherStock: number }
export interface Wallet { id: string; name: string; isActive?: boolean }

export interface OwnSectionProps {
  creds: string;
  stalls: Stall[];
  warehouses: Warehouse[];
  can: (a: 'view' | 'create' | 'edit' | 'delete') => boolean;
}

export const KIND_LABEL = { send: 'Kirim ke Lapak', return: 'Retur ke Gudang', opening: 'Saldo Awal' } as const;
export const dt = (t: Ts | null) => t ? new Date(t.seconds * 1000).toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
export const todayKey = () => new Date().toLocaleDateString('en-CA');
