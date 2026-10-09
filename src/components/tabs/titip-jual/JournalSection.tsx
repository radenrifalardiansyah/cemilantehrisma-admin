'use client';

import { useState, useEffect, useCallback } from 'react';
import { BookOpen, ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import FilterSelect from '@/components/FilterSelect';
import SearchSelect from '@/components/SearchSelect';
import NumberInput from '@/components/NumberInput';
import PageLoader from '@/components/PageLoader';
import { useToast } from '@/components/Toast';
import { periodRange, type PeriodKey } from '@/lib/period';
import { WALLET_CATEGORIES, WALLET_CATEGORY_LABEL, WALLET_KIND_LABEL } from '@/lib/stall-wallet';
import PeriodBar from './PeriodBar';
import DataList, { type ExportCol } from './DataList';
import { API, Badge, Field, ModalShell, ModalFooter, ErrorBox, rupiah, type SectionProps } from './shared';

interface Entry {
  id: string; stallId: string; stallName: string; kind: string; amount: number; note: string; category: string;
  createdBy: string; createdAt: { seconds: number } | null; balanceAfter: number;
}
interface Journal { entries: Entry[]; summary: { openingBalance: number; inflow: number; outflow: number; currentBalance: number } }

const todayKey = () => new Date().toLocaleDateString('en-CA');
const dt = (t: { seconds: number } | null) => t ? new Date(t.seconds * 1000).toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';

async function fetchJournal(creds: string, from: string, to: string, stallId: string): Promise<Journal | null> {
  const r = await fetch(`${API}/api/consign/wallet-journal?from=${from}&to=${to}&stallId=${stallId}`, { headers: { 'x-admin-auth': creds } });
  return r.ok ? await r.json() as Journal : null;
}

// Jurnal kas dompet lapak: semua pergerakan uang (penjualan, bayar penitip, kas manual, selisih shift)
// dengan saldo berjalan per lapak, filter periode/lapak/jenis, dan export. Terpisah total dari kas toko.
export default function JournalSection({ creds, data, reload, can, journalStallId }: SectionProps) {
  const [journal, setJournal] = useState<Journal | null>(null);
  const [period, setPeriod] = useState<PeriodKey>('month');
  const [customFrom, setCustomFrom] = useState(todayKey());
  const [customTo, setCustomTo] = useState(todayKey());
  const { from, to } = periodRange(period, customFrom, customTo);
  const [stallFilter, setStallFilter] = useState(journalStallId ?? '');
  const [kindFilter, setKindFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => { setJournal(await fetchJournal(creds, from, to, stallFilter)); }, [creds, from, to, stallFilter]);
  useEffect(() => {
    let alive = true;
    fetchJournal(creds, from, to, stallFilter).then(d => { if (alive) setJournal(d); });
    return () => { alive = false; };
  }, [creds, from, to, stallFilter]);

  if (journal === null) return <PageLoader />;

  const items = journal.entries
    .filter(e => !kindFilter || e.kind === kindFilter)
    .filter(e => !categoryFilter || e.category === categoryFilter);
  const s = journal.summary;
  const stallName = stallFilter ? data.stalls.find(x => x.id === stallFilter)?.name : '';

  const cols: ExportCol<Entry>[] = [
    { header: 'Waktu', width: '14%', value: e => dt(e.createdAt) },
    { header: 'Lapak', width: '11%', value: e => e.stallName },
    { header: 'Jenis', width: '11%', value: e => WALLET_KIND_LABEL[e.kind] ?? e.kind },
    { header: 'Kategori', width: '12%', value: e => WALLET_CATEGORY_LABEL[e.category] ?? '-' },
    { header: 'Keterangan', width: '20%', value: e => e.note || '-' },
    { header: 'Masuk', width: '9%', align: 'right', value: e => e.amount > 0 ? rupiah(e.amount) : '-' },
    { header: 'Keluar', width: '9%', align: 'right', value: e => e.amount < 0 ? rupiah(-e.amount) : '-' },
    { header: 'Saldo', width: '10%', align: 'right', value: e => rupiah(e.balanceAfter) },
    { header: 'Oleh', width: '4%', value: e => e.createdBy || '-' },
  ];

  return (
    <div className="space-y-4">
      <PeriodBar period={period} onPeriod={setPeriod} from={customFrom} to={customTo} onFrom={setCustomFrom} onTo={setCustomTo} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
        {[
          { label: 'Saldo awal periode', val: rupiah(s.openingBalance) },
          { label: 'Total masuk', val: rupiah(s.inflow), color: '#059669' },
          { label: 'Total keluar', val: rupiah(s.outflow), color: 'var(--danger)' },
          { label: stallName ? `Saldo ${stallName} sekarang` : 'Saldo semua lapak sekarang', val: rupiah(s.currentBalance), color: 'var(--accent)' },
        ].map(c => (
          <div key={c.label} className="card p-2.5 sm:p-3 min-w-0">
            <p className="text-[9px] sm:text-[10px] font-semibold uppercase tracking-wide leading-tight" style={{ color: 'var(--text-muted)' }}>{c.label}</p>
            <p className="text-xs sm:text-sm font-bold mt-0.5 break-words" style={{ color: c.color ?? 'var(--text-primary)' }}>{c.val}</p>
          </div>
        ))}
      </div>

      <DataList<Entry>
        creds={creds} items={items} totalCount={Math.max(journal.entries.length, 1)} getId={e => e.id} noun="entri kas"
        searchText={e => `${e.note} ${e.stallName} ${e.createdBy} ${WALLET_KIND_LABEL[e.kind] ?? ''} ${WALLET_CATEGORY_LABEL[e.category] ?? ''}`}
        searchPlaceholder="Cari keterangan, lapak, atau petugas…" viewKey="consign-journal" resetKey={`${stallFilter}|${kindFilter}|${categoryFilter}|${from}|${to}`}
        addLabel={can('edit') ? 'Catat Kas' : undefined} onAdd={can('edit') ? () => setAdding(true) : undefined}
        emptyHint="Belum ada pergerakan kas pada periode ini."
        filters={(
          <>
            <FilterSelect value={stallFilter} onChange={setStallFilter} searchPlaceholder="Cari lapak…"
              options={[{ value: '', label: 'Semua lapak' }, ...data.stalls.map(x => ({ value: x.id, label: x.name }))]} />
            <FilterSelect value={kindFilter} onChange={setKindFilter}
              options={[{ value: '', label: 'Semua jenis' }, ...Object.entries(WALLET_KIND_LABEL).map(([value, label]) => ({ value, label }))]} />
            <FilterSelect value={categoryFilter} onChange={setCategoryFilter}
              options={[{ value: '', label: 'Semua kategori' }, ...WALLET_CATEGORIES.map(c => ({ value: c.value, label: c.label }))]} />
          </>
        )}
        renderBody={e => (
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{WALLET_KIND_LABEL[e.kind] ?? e.kind}</p>
                {e.category && <Badge tone="accent">{WALLET_CATEGORY_LABEL[e.category] ?? e.category}</Badge>}
                {!stallFilter && <Badge>{e.stallName}</Badge>}
              </div>
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{e.note || '–'}</p>
              <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{dt(e.createdAt)}{e.createdBy ? ` · ${e.createdBy}` : ''}</p>
            </div>
            <div className="text-right flex-shrink-0">
              <p className="text-sm font-bold tabular" style={{ color: e.amount >= 0 ? '#059669' : 'var(--danger)' }}>{e.amount >= 0 ? '+' : '-'}{rupiah(Math.abs(e.amount))}</p>
              <p className="text-[10px] tabular" style={{ color: 'var(--text-muted)' }}>saldo {rupiah(e.balanceAfter)}</p>
            </div>
          </div>
        )}
        exportCols={cols} exportTitle={`JURNAL KAS LAPAK${stallName ? ` — ${stallName.toUpperCase()}` : ''}`} exportFile="jurnal-kas-lapak"
      />

      {adding && (
        <EntryModal creds={creds} data={data} initialStallId={stallFilter} onClose={() => setAdding(false)}
          onDone={async () => { setAdding(false); await Promise.all([reload(), load()]); }} />
      )}
    </div>
  );
}

function EntryModal({ creds, data, initialStallId, onClose, onDone }: {
  creds: string; data: SectionProps['data']; initialStallId: string; onClose: () => void; onDone: () => Promise<void>;
}) {
  const toast = useToast();
  const [stallId, setStallId] = useState(initialStallId);
  const [direction, setDirection] = useState<'in' | 'out'>('in');
  const [category, setCategory] = useState('modal');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const categories = WALLET_CATEGORIES.filter(c => c.dir === 'both' || c.dir === direction);

  const save = async () => {
    setSaving(true); setError('');
    const r = await fetch(`${API}/api/stalls/${stallId}/wallet`, {
      method: 'POST', headers: { 'x-admin-auth': creds, 'Content-Type': 'application/json' },
      body: JSON.stringify({ direction, amount: Number(amount), note, category }),
    });
    if (r.ok) { toast.success('Entri kas dicatat.'); await onDone(); }
    else {
      const msg = ((await r.json().catch(() => ({}))) as { error?: string }).error ?? 'Gagal mencatat entri.';
      setError(msg); toast.error(msg);
    }
    setSaving(false);
  };

  return (
    <ModalShell title="Catat Kas Lapak" subtitle="Tambah kas atau ambil kas dari dompet lapak" icon={<BookOpen size={17} />} onClose={onClose}
      footer={<ModalFooter onClose={onClose} onSave={save} saving={saving} disabled={!stallId || !(Number(amount) > 0) || !note.trim()} label="Catat" />}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Field label="Lapak" required>
          <SearchSelect value={stallId} onChange={setStallId} options={data.stalls.map(s => ({ value: s.id, label: s.name, sublabel: s.code }))}
            placeholder="– Pilih lapak –" searchPlaceholder="Cari lapak…" />
        </Field>
        <div className="flex gap-2">
          {([['in', 'Tambah kas', ArrowDownLeft], ['out', 'Ambil kas', ArrowUpRight]] as const).map(([d, label, Icon]) => (
            <button key={d} type="button" onClick={() => { setDirection(d); setCategory(d === 'in' ? 'modal' : 'setor_toko'); }}
              className="flex-1 px-3 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5"
              style={direction === d ? { background: 'linear-gradient(135deg,#E8821A,#C96018)', color: 'white' } : { background: 'var(--surface-2)', color: 'var(--text-muted)' }}>
              <Icon size={13} /> {label}
            </button>
          ))}
        </div>
        <Field label="Kategori">
          <SearchSelect value={category} onChange={setCategory} options={categories.map(c => ({ value: c.value, label: c.label }))} searchPlaceholder="Cari kategori…" />
        </Field>
        <Field label="Jumlah (Rp)" required><NumberInput value={amount} placeholder="0" onChange={setAmount} /></Field>
        <Field label="Keterangan" required>
          <input className="input" value={note} maxLength={200} placeholder={direction === 'in' ? 'cth: modal awal minggu ini' : 'cth: beli plastik & kertas struk'} onChange={e => setNote(e.target.value)} />
        </Field>
        <ErrorBox message={error} />
      </div>
    </ModalShell>
  );
}
