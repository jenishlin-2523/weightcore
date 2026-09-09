'use strict';
/*
 * report-docx.js — native Word (.docx) copy of the Transaction Summary
 * Report, built with docx.js from the same summaryData object as the popup,
 * PDF and Excel copies. A4 landscape (the table is ten columns wide).
 * Returns a Promise<Buffer>.
 */
const {
  Document, Packer, Paragraph, TextRun,
  Table, TableRow, TableCell, WidthType, AlignmentType, ShadingType
} = require('docx');

const text = (t, opts) => new TextRun(Object.assign({ text: String(t == null ? '' : t), font: 'Arial', size: 16 }, opts || {}));
const cell = (t, opts, right, shade) => new TableCell({
  shading: shade ? { type: ShadingType.CLEAR, fill: 'F0F0F0' } : undefined,
  children: [new Paragraph({
    alignment: right ? AlignmentType.RIGHT : AlignmentType.LEFT,
    children: [text(t, opts)]
  })]
});

module.exports = async function buildReportDocx(d) {
  const cols = d.columns.length;
  const children = [
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 40 },
      children: [text(d.company, { bold: true, size: 28 })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 },
      children: [text(d.title, { bold: true, size: 22 })] }),
    new Paragraph({ spacing: { after: 160 }, children: [text(d.filter, { size: 18 })] })
  ];

  const rows = [
    new TableRow({ tableHeader: true, children: d.columns.map((h) => cell(h, { bold: true }, false, true)) })
  ];
  d.rows.forEach((r) => {
    rows.push(new TableRow({
      children: r.map((v, i) => cell(v, null, (d.rightCols || []).indexOf(i) >= 0))
    }));
  });
  const totalCells = [cell(d.totalLabel, { bold: true })];
  for (let i = 1; i < cols - 1; i++) totalCells.push(cell(''));
  totalCells.push(cell(d.totalNet, { bold: true }, true));
  rows.push(new TableRow({ children: totalCells }));

  children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows }));

  /* Hourly ledger, when the report was run for a specific time window —
     the same rows the popup, PDF and Excel copies show. */
  const h = d.hourly;
  if (h && h.rows && h.rows.length) {
    children.push(new Paragraph({ spacing: { before: 300, after: 120 },
      children: [text(h.title, { bold: true, size: 22 })] }));
    const right = (i) => (h.rightCols || []).indexOf(i) >= 0;
    const hRows = [
      new TableRow({ tableHeader: true, children: h.columns.map((c) => cell(c, { bold: true }, false, true)) })
    ];
    h.rows.forEach((r) => {
      hRows.push(new TableRow({ children: r.map((v, i) => cell(v, null, right(i))) }));
    });
    hRows.push(new TableRow({
      children: (h.totalRow || []).map((v, i) => cell(v, { bold: true }, right(i)))
    }));
    children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: hRows }));
  }

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          size: { width: 16838, height: 11906 },                      // A4 landscape (twips)
          margin: { top: 576, bottom: 576, left: 576, right: 576 }    // 0.4"
        }
      },
      children
    }]
  });
  return await Packer.toBuffer(doc);
};
