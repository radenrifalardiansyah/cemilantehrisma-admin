// Versi Postgres dari koleksi Firestore `masterBanks`.

export interface MasterBankRow {
  code: string; name: string; bank_code: string | null; ewallet: boolean;
}

export function rowToBank(r: MasterBankRow) {
  return { id: r.code, code: r.code, name: r.name, bankCode: r.bank_code ?? undefined, ewallet: r.ewallet };
}
