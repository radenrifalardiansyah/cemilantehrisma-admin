import { Text, View, StyleSheet } from '@react-pdf/renderer';

// Cap "ditandatangani sistem" — dipakai di slot tanda tangan yang tidak punya gambar tanda tangan/cap,
// supaya dokumen yang sudah sah di sistem tidak tampil dengan ruang kosong. Jangan dipakai untuk pihak
// luar (supplier/penerima/mitra) yang memang harus tanda tangan basah.
const s = StyleSheet.create({
  box: { borderWidth: 1.2, borderColor: '#15803D', borderRadius: 4, paddingVertical: 3, paddingHorizontal: 7, alignItems: 'center', transform: 'rotate(-4deg)', marginBottom: 4 },
  title: { fontSize: 7.5, fontFamily: 'Helvetica-Bold', color: '#15803D', letterSpacing: 0.4 },
  sub: { fontSize: 6.5, color: '#15803D', marginTop: 1 },
});

export default function SystemSeal({ title, sub }: { title: string; sub?: string }) {
  return (
    <View style={s.box}>
      <Text style={s.title}>{title}</Text>
      {sub ? <Text style={s.sub}>{sub}</Text> : null}
    </View>
  );
}
