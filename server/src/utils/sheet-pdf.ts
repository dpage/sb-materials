import PdfPrinter from 'pdfmake';
import path from 'path';
import type { TDocumentDefinitions, Content, TableCell } from 'pdfmake/interfaces';
import { SB_LOGO_DATA_URL } from './logo';
import { imageFileToJpegDataUrl, PDF_MAX_DIM, PDF_QUALITY } from './image';
import { formatUkDate } from './collection-note-pdf';
import {
  type ExpenseTotals,
  type MileagePayment,
  formatMiles,
  formatMoney,
  formatSheetMonth,
  journeyMiles,
  toNumber,
} from './mileage';
import type { PdfOptions } from './watermark';

// The monthly travel and expenses sheets, rendered on the same letterhead as
// the collection note so that what is handed to the accountant looks of a
// piece with everything else the company issues.

export const TRAVEL_TITLE = 'TRAVEL & MILEAGE';
export const EXPENSES_TITLE = 'EXPENSES';
export const TRAVEL_HEADER_CELLS = ['DATE', 'JOB', 'FROM', 'TO', 'CUSTOMER', 'MILES', 'RETURN'];
export const EXPENSE_HEADER_CELLS = ['DATE', 'DESCRIPTION', 'COST', 'VAT?', 'VAT'];
const TRAVEL_COLUMN_WIDTHS: (number | string)[] = [55, '*', 70, 70, '*', 40, 36];
const EXPENSE_COLUMN_WIDTHS: (number | string)[] = [60, '*', 60, 36, 60];
const RECEIPTS_PER_ROW = 3;
const LOGO_IMAGE_KEY = 'sbLogo';

const printer = new PdfPrinter({
  Roboto: {
    normal: 'Helvetica',
    bold: 'Helvetica-Bold',
    italics: 'Helvetica-Oblique',
    bolditalics: 'Helvetica-BoldOblique',
  },
});

export interface SheetHeader {
  id: number;
  year: number;
  month: number;
  notes?: string | null;
  display_name?: string;
}

export interface JourneyRecord {
  journey_date?: string | null;
  job?: string | null;
  from_location?: string | null;
  to_location?: string | null;
  customer_name?: string | null;
  miles?: number | string | null;
  round_trip?: number | boolean | null;
}

export interface ExpenseItemRecord {
  id?: number;
  item_date?: string | null;
  description?: string | null;
  cost?: number | string | null;
  vat_applicable?: number | boolean | null;
  vat_amount?: number | string | null;
}

export interface ExpensePhotoRecord {
  file_path: string;
  item_id?: number | null;
}

/**
 * The journey rows as rendered, exported so a test can assert on them without
 * decoding the PDF byte stream. The miles column shows the miles actually
 * claimed, so a round trip reads as the doubled figure rather than leaving the
 * reader to work it out.
 */
export function travelRows(journeys: JourneyRecord[]): string[][] {
  return journeys.map((journey) => [
    formatUkDate(journey.journey_date),
    journey.job ?? '',
    journey.from_location ?? '',
    journey.to_location ?? '',
    journey.customer_name ?? '',
    formatMiles(journeyMiles(journey)),
    journey.round_trip ? 'Yes' : '',
  ]);
}

export function expenseRows(items: ExpenseItemRecord[]): string[][] {
  return items.map((item) => [
    formatUkDate(item.item_date),
    item.description ?? '',
    formatMoney(toNumber(item.cost)),
    item.vat_applicable ? 'Yes' : 'No',
    item.vat_applicable ? formatMoney(toNumber(item.vat_amount)) : '',
  ]);
}

/** `<month>-<person>-travel.pdf`, identifiable from the filename alone. */
export function sheetPdfFilename(kind: 'travel' | 'expenses', sheet: SheetHeader): string {
  const person = (sheet.display_name || 'sheet').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `${sheet.year}-${String(sheet.month).padStart(2, '0')}-${person}-${kind}.pdf`;
}

function letterhead(title: string, sheet: SheetHeader): Content[] {
  return [
    {
      columns: [
        { image: LOGO_IMAGE_KEY, width: 170 },
        {
          text: title,
          fontSize: 18,
          bold: true,
          alignment: 'right' as const,
          margin: [0, 14, 0, 0] as [number, number, number, number],
        },
      ],
      margin: [0, 0, 0, 20] as [number, number, number, number],
    },
    {
      text: `${sheet.display_name || ''}${sheet.display_name ? ' / ' : ''}${formatSheetMonth(sheet.year, sheet.month)}`,
      fontSize: 13,
      bold: true,
      margin: [0, 0, 0, 14] as [number, number, number, number],
    },
  ];
}

function headerRow(cells: string[]): TableCell[] {
  return cells.map((text) => ({ text, bold: true }));
}

function notesBlock(notes: string | null | undefined): Content[] {
  if (!notes || !notes.trim()) return [];
  return [{ text: 'Notes', bold: true, margin: [0, 16, 0, 2] as [number, number, number, number] }, { text: notes }];
}

function render(docDefinition: TDocumentDefinitions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = printer.createPdfKitDocument(docDefinition);
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

function documentOf(content: Content[], options: PdfOptions): TDocumentDefinitions {
  return {
    content,
    ...(options.watermark ? { watermark: options.watermark } : {}),
    defaultStyle: { fontSize: 10 },
    images: { [LOGO_IMAGE_KEY]: SB_LOGO_DATA_URL },
    pageMargins: [45, 45, 45, 45] as [number, number, number, number],
  };
}

export async function generateTravelSheetPdf(
  sheet: SheetHeader,
  journeys: JourneyRecord[],
  totals: MileagePayment,
  options: PdfOptions = {},
): Promise<Buffer> {
  const content: Content[] = [...letterhead(TRAVEL_TITLE, sheet)];

  const body: TableCell[][] = [headerRow(TRAVEL_HEADER_CELLS)];
  for (const row of travelRows(journeys)) {
    body.push(row.map((text) => ({ text })));
  }
  if (body.length === 1) {
    body.push(TRAVEL_HEADER_CELLS.map(() => ({ text: '' })));
  }
  content.push({ table: { widths: TRAVEL_COLUMN_WIDTHS, headerRows: 1, body } });

  // The banding is stated in full rather than as a single figure, because the
  // claim has to be checkable against the mileage already claimed earlier in
  // the tax year, which this sheet alone does not show.
  const summary: TableCell[][] = [
    [{ text: 'Miles this month', bold: true }, { text: formatMiles(totals.miles) }],
    [{ text: 'Miles earlier this tax year', bold: true }, { text: formatMiles(totals.milesBroughtForward) }],
    [
      { text: `At the higher rate (${formatMiles(totals.highMiles)} miles)`, bold: true },
      { text: formatMoney(totals.highPay) },
    ],
    [
      { text: `At the lower rate (${formatMiles(totals.lowMiles)} miles)`, bold: true },
      { text: formatMoney(totals.lowPay) },
    ],
    [
      { text: 'Total claimed', bold: true },
      { text: formatMoney(totals.total), bold: true },
    ],
  ];
  content.push({
    table: { widths: [200, 90], body: summary },
    margin: [0, 16, 0, 0] as [number, number, number, number],
  });

  content.push(...notesBlock(sheet.notes));

  return render(documentOf(content, options));
}

export async function generateExpenseSheetPdf(
  sheet: SheetHeader,
  items: ExpenseItemRecord[],
  photos: ExpensePhotoRecord[],
  totals: ExpenseTotals,
  uploadsDir: string,
  options: PdfOptions = {},
): Promise<Buffer> {
  const content: Content[] = [...letterhead(EXPENSES_TITLE, sheet)];

  const body: TableCell[][] = [headerRow(EXPENSE_HEADER_CELLS)];
  for (const row of expenseRows(items)) {
    body.push(row.map((text) => ({ text })));
  }
  if (body.length === 1) {
    body.push(EXPENSE_HEADER_CELLS.map(() => ({ text: '' })));
  }
  body.push([
    { text: 'Totals', bold: true, colSpan: 2 },
    {},
    { text: formatMoney(totals.gross), bold: true },
    { text: '' },
    { text: formatMoney(totals.vat), bold: true },
  ]);
  body.push([
    { text: 'Net of VAT', bold: true, colSpan: 2 },
    {},
    { text: formatMoney(totals.net), bold: true },
    { text: '' },
    { text: '' },
  ]);
  content.push({ table: { widths: EXPENSE_COLUMN_WIDTHS, headerRows: 1, body } });

  content.push(...notesBlock(sheet.notes));

  // Receipts are piled at the bottom, three to a row, each captioned with the
  // item it belongs to so the accountant can match a photograph to a line.
  const descriptions = new Map<number, string>();
  for (const item of items) {
    if (item.id !== undefined && item.description) descriptions.set(item.id, item.description);
  }

  const cells: Content[] = [];
  for (const photo of photos) {
    const dataUrl = await imageFileToJpegDataUrl(path.resolve(uploadsDir, photo.file_path), PDF_MAX_DIM, PDF_QUALITY);
    if (!dataUrl) continue;
    const caption = photo.item_id != null ? descriptions.get(photo.item_id) : undefined;
    cells.push({
      stack: [
        { image: dataUrl, fit: [150, 200] as [number, number] },
        ...(caption ? [{ text: caption, fontSize: 8, margin: [0, 2, 0, 0] as [number, number, number, number] }] : []),
      ],
    } as Content);
  }

  if (cells.length) {
    content.push({ text: 'Receipts', bold: true, margin: [0, 20, 0, 8] as [number, number, number, number] });
    const grid: TableCell[][] = [];
    for (let i = 0; i < cells.length; i += RECEIPTS_PER_ROW) {
      const row = cells.slice(i, i + RECEIPTS_PER_ROW) as TableCell[];
      while (row.length < RECEIPTS_PER_ROW) row.push({ text: '' });
      grid.push(row);
    }
    content.push({
      table: { widths: Array.from({ length: RECEIPTS_PER_ROW }, () => '*'), body: grid },
      layout: 'noBorders',
    } as Content);
  }

  return render(documentOf(content, options));
}
