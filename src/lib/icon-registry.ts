import type { LucideIcon } from 'lucide-react';
import {
  BarChart2, ShoppingCart, Package, Receipt, Tag, Users, Contact, Warehouse,
  Settings, Boxes, Truck, Factory, Store, Banknote, LineChart, Landmark, Coins,
  FileBarChart, User, ShieldCheck, IdCard, Archive, ListTree, Lock, Blocks, History, Bell,
} from 'lucide-react';

// Icon names are stored as plain strings on `modules`/`menus` Firestore docs
// (Struktur Menu / Modul screens). This is the fixed, curated set they can
// pick from — keep it in sync with IconPicker.tsx's picker grid.
export const ICON_REGISTRY: Record<string, LucideIcon> = {
  BarChart2, ShoppingCart, Package, Receipt, Tag, Users, Contact, Warehouse,
  Settings, Boxes, Truck, Factory, Store, Banknote, LineChart, Landmark, Coins,
  FileBarChart, User, ShieldCheck, IdCard, Archive, ListTree, Lock, Blocks, History, Bell,
};

export const ICON_NAMES = Object.keys(ICON_REGISTRY);

export function resolveIcon(name: string): LucideIcon {
  return ICON_REGISTRY[name] ?? Package;
}
