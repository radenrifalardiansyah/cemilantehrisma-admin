'use client';

import { useState, useEffect } from 'react';
import { Wallet, BookOpen, Plus, ArrowLeft, HandCoins } from 'lucide-react';
import Tooltip from '@/components/Tooltip';
import DataList, { type ExportCol } from './DataList';
import JournalSection, { EntryModal } from './JournalSection';
import { API, Badge, HEADER_BTN_H, rupiah, type SectionProps, type Stall } from './shared';

// Dompet Lapak: satu dompet per lapak, TERPISAH dari dompet toko. Tampilan ringkasan seperti halaman Dompet
// (total saldo + kartu per lapak); membuka sebuah lapak menampilkan jurnal kas (riwayat + saldo berjalan).
export default function WalletOverview(props: SectionProps) {
  const { creds, data, reload, can, journalStallId } = props;
  const [selected, setSelected] = useState(journalStallId ?? '');
  const [adding, setAdding] = useState<string | null>(null);
  const [owed, setOwed] = useState<number | null>(null);

  // Hutang ke penitip: penjualan yang belum direkap + rekap yang belum dibayar.
  useEffect(() => {
    let alive = true;
    fetch(`${API}/api/consign/settlements`, { headers: { 'x-admin-auth': creds } })
      .then(r => r.ok ? r.json() as Promise<{ settlements: { status: string; totalAmount: number }[]; payables: { amount: number }[] }> : null)
      .then(d => {
        if (!alive || !d) return;
        setOwed(d.payables.reduce((a, p) => a + p.amount, 0) + d.settlements.filter(s => s.status === 'unpaid').reduce((a, s) => a + s.totalAmount, 0));
      });
    return () => { alive = false; };
  }, [creds, data.stalls]);

  const total = data.stalls.filter(s => s.isActive).reduce((a, s) => a + s.balance, 0);
  const current = data.stalls.find(s => s.id === selected);

  if (selected && current) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <button onClick={() => setSelected('')} className="btn-ghost text-xs" style={{ height: HEADER_BTN_H }}>
            <ArrowLeft size={13} /> Semua Dompet
          </button>
          <div className="min-w-0">
            <p className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>{current.name}</p>
            <p className="text-xs tabular" style={{ color: 'var(--text-muted)' }}>Saldo dompet {rupiah(current.balance)}</p>
          </div>
        </div>
        <JournalSection {...props} journalStallId={selected} />
      </div>
    );
  }

  const cols: ExportCol<Stall>[] = [
    { header: 'Lapak', width: '40%', bold: true, value: s => s.name },
    { header: 'Kode', width: '20%', value: s => s.code },
    { header: 'Status', width: '15%', value: s => s.isActive ? 'Aktif' : 'Nonaktif' },
    { header: 'Saldo Dompet', width: '25%', align: 'right', value: s => rupiah(s.balance) },
  ];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="card p-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'var(--success-bg)', color: 'var(--success)' }}><Wallet size={16} /></div>
          <div>
            <p className="text-lg font-extrabold tabular leading-none" style={{ color: 'var(--success)' }}>{rupiah(total)}</p>
            <p className="text-[11px] font-medium mt-1" style={{ color: 'var(--text-muted)' }}>Total Saldo Dompet Lapak Aktif</p>
          </div>
        </div>
        <div className="card p-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}><HandCoins size={16} /></div>
          <div>
            <p className="text-lg font-extrabold tabular leading-none" style={{ color: 'var(--accent)' }}>{owed === null ? '…' : rupiah(owed)}</p>
            <p className="text-[11px] font-medium mt-1" style={{ color: 'var(--text-muted)' }}>Hak Penitip yang Belum Dibayar</p>
          </div>
        </div>
      </div>

      <DataList<Stall>
        creds={creds} items={data.stalls} totalCount={data.stalls.length} getId={s => s.id} noun="dompet"
        searchText={s => `${s.name} ${s.code}`} searchPlaceholder="Cari nama lapak…" viewKey="stall-wallets"
        emptyHint="Dompet dibuat otomatis untuk setiap lapak. Tambahkan lapak di Titip Jual → Lapak."
        renderBody={(s, view) => (
          <div className={view === 'card' ? 'flex flex-col items-center text-center gap-1' : undefined}>
            <div className="flex items-center gap-1.5 flex-wrap" style={view === 'card' ? { justifyContent: 'center' } : undefined}>
              <p className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>{s.name}</p>
              <Badge>Dompet Lapak</Badge>
              {s.isStore && <Badge tone="accent">Toko</Badge>}
              {!s.isActive && <Badge tone="danger">Nonaktif</Badge>}
            </div>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{s.code}</p>
            <p className="text-base font-extrabold tabular mt-0.5" style={{ color: s.balance >= 0 ? 'var(--text-primary)' : 'var(--danger)' }}>{rupiah(s.balance)}</p>
          </div>
        )}
        actions={s => (
          <>
            <Tooltip label="Lihat jurnal kas">
              <button onClick={() => setSelected(s.id)} className="btn-ghost p-2" style={{ color: 'var(--accent)' }}><BookOpen size={13} /></button>
            </Tooltip>
            {can('edit') && (
              <Tooltip label="Catat kas (tambah/ambil)">
                <button onClick={() => setAdding(s.id)} className="btn-ghost p-2"><Plus size={13} /></button>
              </Tooltip>
            )}
          </>
        )}
        exportCols={cols} exportTitle="SALDO DOMPET LAPAK" exportFile="dompet-lapak"
      />

      {adding && (
        <EntryModal creds={creds} data={data} initialStallId={adding} onClose={() => setAdding(null)}
          onDone={async () => { setAdding(null); await reload(); }} />
      )}
    </div>
  );
}
