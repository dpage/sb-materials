import { Router } from 'express';
import Database from 'better-sqlite3';
import { requireAuth } from '../middleware/auth';
import { generatePdf } from '../utils/pdf-generator';
import { config } from '../config';
import { loadReportWithDetails } from '../utils/report-loader';
import { loadCollectionNote } from '../utils/collection-note-loader';
import { generateCollectionNotePdf, collectionNotePdfFilename } from '../utils/collection-note-pdf';
import { logger } from '../utils/logger';
import { deploymentWatermark, type PdfOptions } from '../utils/watermark';
import { loadSheetForUser } from '../utils/sheets';
import { expenseTotals, mileagePayment, mileageRates, milesBroughtForward, totalJourneyMiles } from '../utils/mileage';
import { generateExpenseSheetPdf, generateTravelSheetPdf, sheetPdfFilename } from '../utils/sheet-pdf';

export function pdfRoutes(db: Database.Database): Router {
  const router = Router();

  // A report printed from the test deployment carries a watermark saying so,
  // since a PDF outlives the browser tab it was downloaded from.
  const pdfOptions: PdfOptions = config.isTestDeployment
    ? { watermark: deploymentWatermark(config.deploymentLabel) }
    : {};

  router.use(requireAuth);

  // Registered before the /:reportId route below: Express matches routes in
  // registration order, so "collection-note" would otherwise be parsed as a
  // (non-numeric) report id and this handler would never be reached.
  router.get('/collection-note/:id', async (req, res) => {
    const note = loadCollectionNote(db, parseInt(req.params.id, 10));

    if (!note) {
      res.status(404).json({ error: 'Collection note not found' });
      return;
    }

    try {
      const pdfBuffer = await generateCollectionNotePdf(note, config.uploadsDir, pdfOptions);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${collectionNotePdfFilename(note)}"`);
      res.send(pdfBuffer);
    } catch (err) {
      logger.error('Collection note PDF generation error:', err);
      res.status(500).json({ error: 'Failed to generate PDF' });
    }
  });

  // Both sheet routes are registered before /:reportId for the same reason the
  // collection note route is: "travel" would otherwise be parsed as a report
  // id. Each goes through loadSheetForUser, so printing obeys the same
  // ownership rule as reading, and a sheet the caller may not see 404s.
  router.get('/travel/:id', async (req, res) => {
    const sheet = loadSheetForUser(db, 'travel_sheets', parseInt(req.params.id, 10), req);
    if (!sheet) {
      res.status(404).json({ error: 'Travel sheet not found' });
      return;
    }

    const journeys = db
      .prepare('SELECT * FROM travel_journeys WHERE sheet_id = ? ORDER BY sort_order, id')
      .all(sheet.id) as Record<string, unknown>[];
    const totals = mileagePayment(
      milesBroughtForward(db, sheet.user_id, sheet),
      totalJourneyMiles(journeys),
      mileageRates(db),
    );

    try {
      const pdfBuffer = await generateTravelSheetPdf(sheet, journeys, totals, pdfOptions);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${sheetPdfFilename('travel', sheet)}"`);
      res.send(pdfBuffer);
    } catch (err) {
      logger.error('Travel sheet PDF generation error:', err);
      res.status(500).json({ error: 'Failed to generate PDF' });
    }
  });

  router.get('/expenses/:id', async (req, res) => {
    const sheet = loadSheetForUser(db, 'expense_sheets', parseInt(req.params.id, 10), req);
    if (!sheet) {
      res.status(404).json({ error: 'Expense sheet not found' });
      return;
    }

    const items = db
      .prepare('SELECT * FROM expense_items WHERE sheet_id = ? ORDER BY sort_order, id')
      .all(sheet.id) as Record<string, unknown>[];
    const photos = db
      .prepare('SELECT * FROM expense_photos WHERE sheet_id = ? ORDER BY sort_order, id')
      .all(sheet.id) as { file_path: string; item_id: number | null }[];

    try {
      const pdfBuffer = await generateExpenseSheetPdf(
        sheet,
        items,
        photos,
        expenseTotals(items),
        config.uploadsDir,
        pdfOptions,
      );
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${sheetPdfFilename('expenses', sheet)}"`);
      res.send(pdfBuffer);
    } catch (err) {
      logger.error('Expense sheet PDF generation error:', err);
      res.status(500).json({ error: 'Failed to generate PDF' });
    }
  });

  router.get('/:reportId', async (req, res) => {
    const reportId = parseInt(req.params.reportId, 10);

    const report = loadReportWithDetails(db, reportId);

    if (!report) {
      res.status(404).json({ error: 'Report not found' });
      return;
    }

    try {
      const pdfBuffer = await generatePdf(report, config.uploadsDir, pdfOptions);

      const typeName = report.report_type.replace(/_/g, '-');
      const date = report.inspection_date;
      const customerName = report.customer_name.replace(/[^a-zA-Z0-9]/g, '-');
      const filename = `${date}-${customerName}-${typeName}.pdf`;

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(pdfBuffer);
    } catch (err) {
      logger.error('PDF generation error:', err);
      res.status(500).json({ error: 'Failed to generate PDF' });
    }
  });

  return router;
}
