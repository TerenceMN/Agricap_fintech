import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export const exportToExcel = (data, fileName) => {
  try {
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1");
    XLSX.writeFile(workbook, `${fileName}.xlsx`);
  } catch (error) {
    console.error("Export to Excel failed", error);
  }
};

export const exportToPDF = (columns, data, fileName, title = 'Rapport') => {
  try {
    const doc = new jsPDF();
    doc.text(title, 14, 22);
    autoTable(doc, {
      head: [columns],
      body: data,
      startY: 30,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [16, 185, 129] } // Emerald-500
    });
    doc.save(`${fileName}.pdf`);
  } catch (error) {
    console.error("Export to PDF failed", error);
  }
};