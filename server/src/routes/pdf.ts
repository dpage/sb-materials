import { Router } from 'express';
import Database from 'better-sqlite3';
import { requireAuth } from '../middleware/auth';
import { generatePdf } from '../utils/pdf-generator';
import { config } from '../config';
import { loadReportWithDetails } from '../utils/report-loader';
import { logger } from '../utils/logger';

export function pdfRoutes(db: Database.Database): Router {
  const router = Router();

  router.use(requireAuth);

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
