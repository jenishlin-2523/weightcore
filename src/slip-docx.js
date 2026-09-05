'use strict';
/*
 * slip-docx.js — native Word (.docx) copy of the weighment slip.
 *
 * Consumes the SAME per-company data object the renderer builds for the PDF
 * export (slipData in views-ops.js) plus the SAME photo bytes (base64 data
 * URLs from images:forTxn) — nothing is re-derived or re-read here, so the
 * Word copy can never disagree with the PDF. Built with docx.js (pure JS,
 * real OOXML, images embedded); layout mirrors the printed slip: centred
 * letterhead, Print Time, two-column detail sheet, weights block, 2x2 photo
 * grid with captions, User Name / Operator Sign. footer. A4, 0.5" margins.
 */
const {
  Document, Packer, Paragraph, TextRun, ImageRun,
  Table, TableRow, TableCell, TableBorders,
  WidthType, AlignmentType, BorderStyle, VerticalAlign
} = require('docx');

const MONO = 'Consolas';
const SANS = 'Arial';

const text = (t, opts) => new TextRun(Object.assign({ text: String(t == null ? '' : t), font: MONO, size: 20 }, opts || {}));
const para = (children, opts) => new Paragraph(Object.assign({ children: Array.isArray(children) ? children : [children] }, opts || {}));
const center = (children, opts) => para(children, Object.assign({ alignment: AlignmentType.CENTER }, opts || {}));

function labelValue(label, value) {
  return para([
    text(label + ' : ', { bold: true }),
    text(value)
  ], { spacing: { after: 40 } });
}

function twoCol(leftChildren, rightChildren) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: TableBorders.NONE,
    rows: [new TableRow({
      children: [
        new TableCell({ width: { size: 50, type: WidthType.PERCENTAGE }, children: leftChildren }),
        new TableCell({ width: { size: 50, type: WidthType.PERCENTAGE }, children: rightChildren })
      ]
    })]
  });
}

const rule = () => new Paragraph({
  spacing: { before: 120, after: 120 },
  border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: '111111', space: 1 } }
});

function photoCell(shot) {
  const b64 = String(shot.src || '').replace(/^data:image\/\w+;base64,/, '');
  const children = [];
  try {
    children.push(center(new ImageRun({
      type: 'jpg', data: Buffer.from(b64, 'base64'),
      transformation: { width: 250, height: 141 }
    }), { spacing: { before: 80 } }));
  } catch (_) {
    children.push(center(text('[photo unavailable]')));
  }
  children.push(center(text(shot.cap || '', { size: 18 }), { spacing: { after: 80 } }));
  return new TableCell({
    width: { size: 50, type: WidthType.PERCENTAGE },
    verticalAlign: VerticalAlign.CENTER,
    children
  });
}

/**
 * data:  the per-company slip data object (see slipData in views-ops.js):
 *        { company, project, line3, printTime, fields:{...}, weights:{...},
 *          manual, operator }
 * shots: [{ src: base64 data URL, cap }] — the same bytes the PDF embeds.
 * Returns a Promise<Buffer> of the finished .docx.
 */
module.exports = async function buildSlipDocx(data, shots) {
  const f = data.fields || {}, w = data.weights || {};
  const children = [
    center(text(data.company + '.', { font: SANS, bold: true, size: 30, characterSpacing: 20 }), { spacing: { after: 60 } }),
    center(text(data.project + '.', { font: SANS, size: 22 })),
    center(text(data.line3 + '.', { font: SANS, size: 22 }), { spacing: { after: 120 } }),
    center(text('Print Time :  ' + data.printTime), { spacing: { after: 160 } }),
    twoCol(
      [
        labelValue('TicketID', f.ticketId),
        labelValue('Vehicle No.', f.vehicleNo),
        labelValue('Transporter', f.transporter),
        labelValue('Product', f.product),
        labelValue('Gate', f.gate)
      ],
      [
        labelValue('Vehicle Type', f.vehicleType),
        labelValue('Party Name', f.partyName),
        labelValue('Buyer Name', f.buyerName),
        labelValue('Package No', f.packageNo),
        labelValue('WeighBridge No', f.wbNo)
      ]
    ),
    rule(),
    twoCol(
      [
        labelValue('Gross Weight', w.gross),
        labelValue('Tare Weight', w.tare),
        para([text('Net Weight : ', { bold: true }), text(w.net, { bold: true })], { spacing: { after: 40 } })
      ],
      [
        labelValue('Gross Time', w.grossTime),
        labelValue('Tare Time', w.tareTime)
      ]
    )
  ];

  // 2x2 photo grid, captions under each frame — same bytes as the PDF copy
  const list = (shots || []).slice(0, 8);
  for (let i = 0; i < list.length; i += 2) {
    const cells = [photoCell(list[i])];
    if (list[i + 1]) cells.push(photoCell(list[i + 1]));
    else cells.push(new TableCell({ width: { size: 50, type: WidthType.PERCENTAGE }, children: [new Paragraph('')] }));
    children.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: TableBorders.NONE,
      rows: [new TableRow({ children: cells })]
    }));
  }

  if (data.manual) {
    children.push(para(text('✱ MANUAL ENTRY — one or more weights were keyed by the operator, not read from the indicator.', { bold: true, size: 18 }), { spacing: { before: 120 } }));
  }

  children.push(new Paragraph({ text: '', spacing: { before: 240 } }));
  children.push(twoCol(
    [labelValue('User Name', data.operator)],
    [
      new Paragraph({
        spacing: { before: 240 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 10, color: '111111', space: 1 } },
        children: [text('')]
      }),
      center(text('Operator Sign.', { bold: true }))
    ]
  ));

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          size: { width: 11906, height: 16838 },                      // A4 in twips
          margin: { top: 720, bottom: 720, left: 720, right: 720 }    // 0.5"
        }
      },
      children
    }]
  });
  return await Packer.toBuffer(doc);
};
