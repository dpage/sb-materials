import Database from 'better-sqlite3';

export const INSPECTION_REPORT_TYPES = ['loading_inspection', 'quarterly_pern'];

export function loadReportWithDetails(db: Database.Database, reportId: number): any | null {
  const report = db
    .prepare(
      `SELECT r.*, c.name as customer_name, cs.address as site_address
       FROM reports r
       JOIN customers c ON r.customer_id = c.id
       JOIN customer_sites cs ON r.site_id = cs.id
       WHERE r.id = ?`,
    )
    .get(reportId) as any;

  if (!report) return null;

  const isInspection = INSPECTION_REPORT_TYPES.includes(report.report_type) || report.report_type.startsWith('inspection_');
  if (isInspection) {
    report.inspection_details = db.prepare('SELECT * FROM report_inspection_details WHERE report_id = ?').get(reportId);
    report.unwanted_materials = db.prepare('SELECT * FROM report_unwanted_materials WHERE report_id = ?').all(reportId);
    report.contaminants = db.prepare('SELECT * FROM report_contaminants WHERE report_id = ?').all(reportId);
    report.containers = db
      .prepare('SELECT * FROM report_containers WHERE report_id = ? ORDER BY sort_order')
      .all(reportId);
  }
  if (report.report_type === 'pern_audit') {
    report.pern_details = db.prepare('SELECT * FROM report_pern_details WHERE report_id = ?').get(reportId);
  }

  report.photos = db.prepare('SELECT * FROM report_photos WHERE report_id = ? ORDER BY sort_order').all(reportId);

  return report;
}
