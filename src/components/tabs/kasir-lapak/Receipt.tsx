'use client';

import { rupiah } from '../titip-jual/shared';
import { PAY_LABEL, type Sale } from './types';

// Struk cetak 80mm. Id `stall-receipt` (bukan `pos-receipt` milik Kasir toko, yang selalu ter-mount)
// terdaftar di aturan @media print globals.css: seluruh halaman disembunyikan kecuali struk ini.
export default function Receipt({ sale, store, printedAt }: { sale: Sale; store: { name: string; address?: string; logo?: string }; printedAt: string }) {
  const row = { display: 'flex', justifyContent: 'space-between' } as const;
  const line = { borderTop: '1px dashed #000', margin: '6px 0' } as const;
  return (
    <div id="stall-receipt">
      <div style={{ fontFamily: 'monospace', fontSize: 11, color: '#000', padding: 8, width: '80mm', boxSizing: 'border-box' }}>
        {store.logo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={store.logo} alt={store.name} style={{ display: 'block', maxHeight: 44, maxWidth: '55%', margin: '0 auto 4px' }} />
        )}
        <p style={{ textAlign: 'center', fontWeight: 700, fontSize: 13, margin: 0 }}>{store.name}</p>
        <p style={{ textAlign: 'center', fontSize: 11, margin: '2px 0 0' }}>{sale.stallName}</p>
        {store.address && <p style={{ textAlign: 'center', fontSize: 10, margin: '2px 0 0' }}>{store.address}</p>}
        <div style={line} />
        <p style={{ margin: 0 }}>No: {sale.invoiceNo}</p>
        <p style={{ margin: 0 }}>{sale.date} · Kasir: {sale.cashier}</p>
        {sale.customerName && <p style={{ margin: 0 }}>Pelanggan: {sale.customerName}</p>}
        {printedAt && <p style={{ margin: 0 }}>Dicetak: {printedAt}</p>}
        <div style={line} />
        {sale.items.map((it, i) => (
          <div key={i} style={{ marginBottom: 3 }}>
            <div>{it.name}</div>
            <div style={row}><span>{it.qty} x {rupiah(it.price)}</span><span>{rupiah(it.subtotal)}</span></div>
          </div>
        ))}
        <div style={line} />
        <div style={row}><span>Subtotal</span><span>{rupiah(sale.subtotal)}</span></div>
        {sale.discount > 0 && <div style={row}><span>Diskon</span><span>-{rupiah(sale.discount)}</span></div>}
        <div style={{ ...row, fontWeight: 700, fontSize: 12 }}><span>TOTAL</span><span>{rupiah(sale.total)}</span></div>
        <div style={line} />
        {sale.paymentMethod === 'cash' ? (
          <>
            <div style={row}><span>Tunai</span><span>{rupiah(sale.amountPaid)}</span></div>
            <div style={row}><span>Kembali</span><span>{rupiah(sale.changeAmount)}</span></div>
          </>
        ) : (
          <div style={row}><span>{PAY_LABEL[sale.paymentMethod]}</span><span>{rupiah(sale.amountPaid)}</span></div>
        )}
        <div style={line} />
        <p style={{ textAlign: 'center' }}>Terima kasih telah berbelanja!</p>
      </div>
    </div>
  );
}
