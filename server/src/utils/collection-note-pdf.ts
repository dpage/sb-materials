import PdfPrinter from 'pdfmake';
import path from 'path';
import fs from 'fs';
import type { TDocumentDefinitions, Content, TableCell } from 'pdfmake/interfaces';
import { logger } from './logger';
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
export const GOODS_RECEIVED_LABEL = 'Goods Received';
export const SIGNED_RULE = 'Signed…………………………………………………………………………………………………';
export const DATE_LABEL = 'Date;';
export const WASTE_BROKER_LINE = 'NRW Waste brokers registration CBDU027716';
export const COMPANY_FOOTER_LINE =
  'SB Materials UK LTD 1 Deva Way, Wrexham, Wales LL13 9EU Registered in Wales & England No. 10896256';

const HEADER_CELLS = ['CONTACT', 'PO NUMBER', 'REFERENCE', 'WEIGHT', 'PACKING LIST NO.', 'DATE OF COLLECTION'];
const ITEM_HEADER_CELLS = ['QUANTITY', 'DESCRIPTION', 'COLLECTION POINT'];

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
  return (note.items || []).map((item) => [item.quantity ?? '', item.description ?? '', item.collection_point ?? '']);
}

/**
 * `<reference>-<collection date>-<customer>.pdf`, so a saved note is
 * identifiable from its filename alone.
 */
export function collectionNotePdfFilename(note: CollectionNoteRecord): string {
  const date = (note.collection_date || note.created_at || '').slice(0, 10);
  const customer = (note.customer_name || 'customer').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `${note.reference}-${date}-${customer}.pdf`;
}

function signatureImage(uploadsDir: string, relPath: string | null): string | null {
  if (!relPath) return null;
  const filePath = path.resolve(uploadsDir, relPath);
  if (!filePath.startsWith(path.resolve(uploadsDir))) return null;
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
 * One of the two signature boxes: the captured signature when there is one, and
 * the original's ruled line when there is not.
 */
function signatureCell(label: string, image: string | null): Content {
  const stack: Content[] = [{ text: label, margin: [0, 2, 0, 8] as [number, number, number, number] }];
  if (image) {
    stack.push({ image, width: 180, margin: [0, 0, 0, 4] as [number, number, number, number] } as Content);
    stack.push({ text: 'Signed', margin: [0, 0, 0, 4] as [number, number, number, number] });
  } else {
    stack.push({ text: SIGNED_RULE, margin: [0, 0, 0, 4] as [number, number, number, number] });
  }
  return { stack };
}

function dateCell(value: string | null): Content {
  return {
    text: value ? `${DATE_LABEL} ${formatUkDate(value)}` : DATE_LABEL,
    margin: [0, 20, 0, 4] as [number, number, number, number],
  };
}

export async function generateCollectionNotePdf(note: CollectionNoteRecord, uploadsDir: string): Promise<Buffer> {
  const content: Content[] = [];

  content.push({
    text: COLLECTION_NOTE_TITLE,
    fontSize: 22,
    bold: true,
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
      { text: note.po_number ?? '' },
      { text: note.reference },
      { text: note.weight ?? '' },
      { text: note.packing_list_no ?? '' },
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
    itemBody.push([{ text: row[0] }, { text: row[1], bold: true }, { text: row[2] }]);
  }
  if (itemBody.length === 1) {
    itemBody.push([{ text: '' }, { text: '' }, { text: '' }]);
  }
  itemBody.push([
    { text: '' },
    {
      text: `${TRANSPORT_COMPANY_LABEL}\n${note.transport_company ?? ''}`,
      margin: [0, 0, 0, 20] as [number, number, number, number],
    },
    { text: '' },
  ]);

  content.push({
    table: { widths: [80, '*', 130], headerRows: 1, body: itemBody },
  });

  const dispatched = signatureImage(uploadsDir, note.dispatched_signature_path);
  const received = signatureImage(uploadsDir, note.received_signature_path);
  content.push({
    table: {
      widths: ['*', 130],
      body: [
        [signatureCell(GOODS_DISPATCHED_LABEL, dispatched), dateCell(note.dispatched_signed_date)],
        [signatureCell(GOODS_RECEIVED_LABEL, received), dateCell(note.received_signed_date)],
      ],
    },
    margin: [0, 0, 0, 30] as [number, number, number, number],
  });

  content.push({ text: WASTE_BROKER_LINE, margin: [0, 0, 0, 10] as [number, number, number, number] });
  content.push({ text: COMPANY_FOOTER_LINE });

  const docDefinition: TDocumentDefinitions = {
    content,
    defaultStyle: { fontSize: 10 },
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
