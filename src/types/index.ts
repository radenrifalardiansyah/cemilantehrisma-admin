import type { StaticImageData } from 'next/image';

export interface Product {
  id: string;
  name: string;
  description: string;
  details: string[];
  price: number;
  originalPrice?: number;
  emoji: string;
  images?: StaticImageData[];
  category: 'keripik' | 'mie' | 'snack' | 'paket';
  badge?: 'Popular' | 'New' | 'Best Seller';
  stock: 'ready' | 'habis' | 'open_po';
  gradient: string;
  bgColor: string;
  weight: string;
}

export interface CartItem {
  product: Product;
  quantity: number;
}

export interface CustomerInfo {
  name: string;
  phone: string;
  address: string;
  note: string;
  deliveryMethod: 'pickup' | 'delivery';
}

export type Category = 'semua' | 'keripik' | 'mie' | 'snack' | 'paket';
