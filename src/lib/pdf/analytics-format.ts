// Format bersama untuk builder data PDF analitik (ringan — jangan impor @react-pdf/renderer di sini).
export const pdfRp = (n: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
export const pdfDate = (d: string) => {
  const dt = new Date(`${d}T00:00:00`);
  return isNaN(dt.getTime()) ? d : dt.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
};
export const pdfNow = () => new Date().toLocaleString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
