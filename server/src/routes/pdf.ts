import { Router } from 'express';
import Database from 'better-sqlite3';
import { requireAuth } from '../middleware/auth';
import { generatePdf } from '../utils/pdf-generator';
import { config } from '../config';
import { loadReportWithDetails } from '../utils/report-loader';
import { loadCollectionNote } from '../utils/collection-note-loader';
import { generateCollectionNotePdf, collectionNotePdfFilename } from '../utils/collection-note-pdf';
import { logger } from '../utils/logger';

export function pdfRoutes(db: Database.Database): Router {
  const router = Router();

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
      const pdfBuffer = await generateCollectionNotePdf(note, config.uploadsDir);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${collectionNotePdfFilename(note)}"`);
      res.send(pdfBuffer);
    } catch (err) {
      logger.error('Collection note PDF generation error:', err);
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
      const pdfBuffer = await generatePdf(report, config.uploadsDir);

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
