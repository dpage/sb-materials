import type { Watermark } from 'pdfmake/interfaces';

/**
 * Options shared by the PDF generators, so that the only thing a caller has to
 * know about a test deployment is that it supplies a watermark.
 */
export interface PdfOptions {
  watermark?: Watermark;
}

/**
 * Diagonal watermark stamped across every page of a PDF produced by a
 * non-production deployment, so that a report generated whilst testing cannot
 * be mistaken for a real one once it has been printed or emailed on.
 */
export function deploymentWatermark(label: string): Watermark {
  return {
    text: label,
    color: '#b3261e',
    opacity: 0.12,
    bold: true,
    italics: false,
    angle: -54,
  };
}
