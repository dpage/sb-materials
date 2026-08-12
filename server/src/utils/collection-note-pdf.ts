import PdfPrinter from 'pdfmake';
import path from 'path';
import fs from 'fs';
import type { TDocumentDefinitions, Content, TableCell } from 'pdfmake/interfaces';
import { logger } from './logger';
import { SB_LOGO_DATA_URL } from './logo';
import type { CollectionNoteRecord } from './collection-note-loader';

// Fixed wording, reproduced verbatim from the collection note the company has
// been issuing as a Word document. It is signed by two parties at the
// collection point, so the text is legally significant and lives here as
// named constants rather than inline literals.
export const COLLECTION_NOTE_TITLE = 'COLLECTION NOTE';
export const COLLECT_FROM_LABEL = 'COLLECT FROM;';
export const COMMENTS_LABEL = 'COMMENTS OR SPECIAL INSTRUCTIONS:';
export const DEFAULT_COMMENTS = 'COLLECTING ON BEHALF OF SB MATERIALS UK LTD';
export const TRANSPORT_COMPANY_LABEL = 'Transport Company';
export const GOODS_DISPATCHED_LABEL = 'Goods Dispatched';
// The dot leader runs most of the width of its cell, as it does on the original
// Word document, so that there is physical room to sign across it. It cannot run
// the whole width: the leader is a single unbreakable run, so pdfmake sizes the
// column to fit it, and an over-long leader pushes the QUANTITY + DESCRIPTION +
// NETT WEIGHT columns it spans past the page margin. At the document's 10pt
// default font those three columns give 395pt, "Signed" takes 31.13pt, and each
// leader glyph takes 10pt, so 36 glyphs is the ceiling; 30 leaves a comfortable
// margin for cell padding and font-metric rounding.
export const SIGNED_RULE = `Signed${'…'.repeat(30)}`;
export const DATE_LABEL = 'Date;';
export const WASTE_BROKER_LINE = 'NRW Waste brokers registration CBDU027716';
export const COMPANY_FOOTER_LINE =
  'SB Materials UK LTD 1 Deva Way, Wrexham, Wales LL13 9EU Registered in Wales & England No. 10896256';

const HEADER_CELLS = [
  'CONTACT',
  'BUYER REFERENCE',
  'REFERENCE',
  'WEIGHT',
  'MINIMUM WEIGHT TO BE LOADED',
  'DATE OF COLLECTION',
];
const ITEM_HEADER_CELLS = ['QUANTITY', 'DESCRIPTION', 'NETT WEIGHT (KG)', 'COLLECTION POINT'];

// The line-item table's fixed columns. The description column is elastic and
// takes whatever is left, which at A4 with 45pt margins is 240pt.
const ITEM_COLUMN_WIDTHS: (number | string)[] = [70, '*', 85, 110];

const LOGO_IMAGE_KEY = 'sbLogo';

const printer = new PdfPrinter({
  Roboto: {
    normal: 'Helvetica',
    bold: 'Helvetica-Bold',
    italics: 'Helvetica-Oblique',
    bolditalics: 'Helvetica-BoldOblique',
  },
});

/**
 * Render an ISO date as dd/mm/yyyy. Anything unrecognised passes through
 * untouched rather than becoming "Invalid Date".
 */
export function formatUkDate(value: string | null | undefined): string {
  if (!value) return '';
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

/**
 * The line-item rows, excluding the header. Exported so tests can assert on the
 * rendered rows without decoding the PDF byte stream.
 */
export function collectionNoteItemRows(note: CollectionNoteRecord): string[][] {
  return (note.items || []).map((item) => [
    item.quantity ?? '',
    item.description ?? '',
    item.nett_weight ?? '',
    item.collection_point ?? '',
  ]);
}

/**
 * `<reference>-<collection date>-<customer>.pdf`, so a saved note is
 * identifiable from its filename alone.
 */
export function collectionNotePdfFilename(note: CollectionNoteRecord): string {
  const date = (note.collection_date || note.created_at || '').slice(0, 10);
  const sanitise = (value: string) => value.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const customer = sanitise(note.customer_name || 'customer');
  // The reference is hand-typed by an inspector, so it must be sanitised the
  // same way the customer name already is: it is interpolated raw into a
  // quoted Content-Disposition header, and a stray quote or slash would
  // otherwise break the filename (or the header).
  const reference = sanitise(note.reference || 'note');
  return `${reference}-${date}-${customer}.pdf`;
}

function signatureImage(uploadsDir: string, relPath: string | null): string | null {
  if (!relPath) return null;
  const resolvedUploadsDir = path.resolve(uploadsDir);
  const filePath = path.resolve(resolvedUploadsDir, relPath);
  // path.resolve alone would also match a sibling directory such as
  // "uploads-evil" because startsWith() has no notion of a path separator, so
  // require the resolved path to fall strictly inside uploadsDir (or equal it).
  const relative = path.relative(resolvedUploadsDir, filePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  if (!fs.existsSync(filePath)) return null;
  try {
    const data = fs.readFileSync(filePath);
    const mime = path.extname(relPath).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg';
    return `data:${mime};base64,${data.toString('base64')}`;
  } catch (err) {
    logger.warn(`Failed to read collection note signature ${relPath}:`, err);
    return null;
  }
}

/**
 * The signature box: the captured signature when there is one, and the
 * original's dotted rule when there is not. Returned as a `TableCell` (not bare
 * `Content`) with `colSpan: 3` so callers can drop it straight into the
 * QUANTITY+DESCRIPTION+NETT WEIGHT columns of the shared line-item table;
 * pdfmake requires matching empty placeholder cells (`{}`) immediately after a
 * colSpan cell in the same row, one per column spanned beyond the first.
 */
function signatureCell(label: string, image: string | null): TableCell {
  const stack: Content[] = [{ text: label, margin: [0, 2, 0, 8] as [number, number, number, number] }];
  if (image) {
    stack.push({ image, width: 180, margin: [0, 0, 0, 4] as [number, number, number, number] } as Content);
    stack.push({ text: 'Signed', margin: [0, 0, 0, 4] as [number, number, number, number] });
  } else {
    stack.push({ text: SIGNED_RULE, margin: [0, 0, 0, 4] as [number, number, number, number] });
  }
  return { stack, colSpan: 3 };
}

function dateCell(value: string | null): Content {
  return {
    text: value ? `${DATE_LABEL} ${formatUkDate(value)}` : DATE_LABEL,
    margin: [0, 20, 0, 4] as [number, number, number, number],
  };
}

export async function generateCollectionNotePdf(note: CollectionNoteRecord, uploadsDir: string): Promise<Buffer> {
  const content: Content[] = [];

  // Letterhead: the logo on the left, the document title ranged right against
  // it, so the note is recognisably SB Materials' the moment it is handed over.
  content.push({
    columns: [
      { image: LOGO_IMAGE_KEY, width: 170 },
      {
        text: COLLECTION_NOTE_TITLE,
        fontSize: 20,
        bold: true,
        alignment: 'right' as const,
        margin: [0, 12, 0, 0] as [number, number, number, number],
      },
    ],
    margin: [0, 0, 0, 30] as [number, number, number, number],
  });

  const addressLines = (note.collect_from_address || note.site_address || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  content.push({ text: COLLECT_FROM_LABEL, bold: true, margin: [0, 0, 0, 2] as [number, number, number, number] });
  if (!addressLines.length || addressLines[0] !== note.customer_name) {
    content.push({ text: note.customer_name });
  }
  for (const line of addressLines) {
    content.push({ text: line });
  }

  content.push({
    text: `${COMMENTS_LABEL}  ${note.comments || DEFAULT_COMMENTS}`,
    bold: true,
    margin: [0, 10, 0, 30] as [number, number, number, number],
  });

  const detailBody: TableCell[][] = [
    HEADER_CELLS.map((text) => ({ text, bold: true, alignment: 'center' as const })),
    [
      { text: [note.contact_name, note.contact_phone].filter(Boolean).join('\n') },
      { text: note.buyer_reference ?? '' },
      { text: note.reference },
      { text: note.weight ?? '' },
      { text: note.minimum_weight ?? '' },
      { text: formatUkDate(note.collection_date) },
    ],
  ];
  content.push({
    table: { widths: ['*', '*', '*', '*', '*', '*'], headerRows: 1, body: detailBody },
    margin: [0, 0, 0, 20] as [number, number, number, number],
  });

  const itemBody: TableCell[][] = [
    ITEM_HEADER_CELLS.map((text) => ({ text, bold: true, alignment: 'center' as const })),
  ];
  for (const row of collectionNoteItemRows(note)) {
    itemBody.push([{ text: row[0] }, { text: row[1], bold: true }, { text: row[2] }, { text: row[3] }]);
  }
  if (itemBody.length === 1) {
    itemBody.push([{ text: '' }, { text: '' }, { text: '' }, { text: '' }]);
  }
  itemBody.push([
    { text: '' },
    {
      text: `${TRANSPORT_COMPANY_LABEL}\n${note.transport_company ?? ''}`,
      margin: [0, 0, 0, 20] as [number, number, number, number],
    },
    { text: '' },
    { text: '' },
  ]);

  // The Goods Dispatched row is appended to this same table, rather than
  // emitted as a second table, so the whole document is one continuous grid
  // with a single right-hand edge: the signature cell spans the QUANTITY,
  // DESCRIPTION, and NETT WEIGHT columns (colSpan requires an empty
  // placeholder cell per further column spanned), and the date falls in the
  // last column, which already matches the standalone signature table's own
  // right-hand width.
  const dispatched = signatureImage(uploadsDir, note.dispatched_signature_path);
  itemBody.push([signatureCell(GOODS_DISPATCHED_LABEL, dispatched), {}, {}, dateCell(note.dispatched_signed_date)]);

  content.push({
    table: { widths: ITEM_COLUMN_WIDTHS, headerRows: 1, body: itemBody },
    margin: [0, 0, 0, 30] as [number, number, number, number],
  });

  content.push({ text: WASTE_BROKER_LINE, margin: [0, 0, 0, 10] as [number, number, number, number] });
  content.push({ text: COMPANY_FOOTER_LINE });

  const docDefinition: TDocumentDefinitions = {
    content,
    defaultStyle: { fontSize: 10 },
    images: { [LOGO_IMAGE_KEY]: SB_LOGO_DATA_URL },
    pageMargins: [45, 45, 45, 45] as [number, number, number, number],
  };

  return new Promise((resolve, reject) => {
    const doc = printer.createPdfKitDocument(docDefinition);
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}
