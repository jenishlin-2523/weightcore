'use strict';
/*
 * report-xlsx.js — native Excel (.xlsx) copy of the Transaction Summary
 * Report, built with exceljs from the same summaryData object that renders
 * the on-screen popup / PDF / Word copies. Returns a Promise<Buffer>.
 */
const ExcelJS = require('exceljs');

module.exports = async function buildReportXlsx(d) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Transaction Summary', {
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
  });
  const cols = d.columns.length;

  // title block, merged across the table width
  ws.mergeCells(1, 1, 1, cols);
  ws.getCell(1, 1).value = d.company;
  ws.getCell(1, 1).font = { bold: true, size: 14 };
  ws.getCell(1, 1).alignment = { horizontal: 'center' };
  ws.mergeCells(2, 1, 2, cols);
  ws.getCell(2, 1).value = d.title;
  ws.getCell(2, 1).font = { bold: true, size: 12 };
  ws.getCell(2, 1).alignment = { horizontal: 'center' };
  ws.mergeCells(3, 1, 3, cols);
  ws.getCell(3, 1).value = d.filter;
  ws.getCell(3, 1).font = { size: 10 };

  // header row
  const headRow = ws.getRow(5);
  d.columns.forEach((h, i) => {
    const c = headRow.getCell(i + 1);
    c.value = h;
    c.font = { bold: true };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F0F0' } };
    c.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
  });

  // data rows
  d.rows.forEach((r, ri) => {
    const row = ws.getRow(6 + ri);
    r.forEach((v, i) => {
      const c = row.getCell(i + 1);
      c.value = v;
      c.border = { top: { style: 'hair' }, bottom: { style: 'hair' }, left: { style: 'hair' }, right: { style: 'hair' } };
      if ((d.rightCols || []).indexOf(i) >= 0) c.alignment = { horizontal: 'right' };
    });
  });

  // totals row
  const tr = ws.getRow(6 + d.rows.length);
  tr.getCell(1).value = d.totalLabel;
  tr.getCell(1).font = { bold: true };
  tr.getCell(cols).value = d.totalNet;
  tr.getCell(cols).font = { bold: true };
  tr.getCell(cols).alignment = { horizontal: 'right' };

  // sensible widths: measure the longest value per column
  for (let i = 0; i < cols; i++) {
    let w = String(d.columns[i]).length;
    d.rows.forEach((r) => { const l = String(r[i] == null ? '' : r[i]).length; if (l > w) w = l; });
    ws.getColumn(i + 1).width = Math.min(Math.max(w + 2, 10), 40);
  }

  /* Hourly ledger, when the report was run for a specific time window. Placed
     below the main table with a blank spacer row, so the workbook still opens
     as one sheet the way the site is used to. */
  const h = d.hourly;
  if (h && h.rows && h.rows.length) {
    let r = 6 + d.rows.length + 2;                       // totals row, then one blank
    ws.mergeCells(r, 1, r, Math.max(h.columns.length, 2));
    ws.getCell(r, 1).value = h.title;
    ws.getCell(r, 1).font = { bold: true, size: 12 };
    r++;
    const hh = ws.getRow(r);
    h.columns.forEach((c, i) => {
      const cc = hh.getCell(i + 1);
      cc.value = c;
      cc.font = { bold: true };
      cc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F0F0' } };
      cc.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
    });
    r++;
    h.rows.forEach((row) => {
      const rw = ws.getRow(r++);
      row.forEach((v, i) => {
        const cc = rw.getCell(i + 1);
        cc.value = v;
        cc.border = { top: { style: 'hair' }, bottom: { style: 'hair' }, left: { style: 'hair' }, right: { style: 'hair' } };
        if ((h.rightCols || []).indexOf(i) >= 0) cc.alignment = { horizontal: 'right' };
      });
    });
    const tr2 = ws.getRow(r);
    (h.totalRow || []).forEach((v, i) => {
      const cc = tr2.getCell(i + 1);
      cc.value = v;
      cc.font = { bold: true };
      if ((h.rightCols || []).indexOf(i) >= 0) cc.alignment = { horizontal: 'right' };
    });
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
};
