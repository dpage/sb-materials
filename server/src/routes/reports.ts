import { Router } from 'express';
import Database from 'better-sqlite3';
import { requireAuth } from '../middleware/auth';
import { loadReportWithDetails, INSPECTION_REPORT_TYPES } from '../utils/report-loader';

export function reportRoutes(db: Database.Database): Router {
  const router = Router();

  router.use(requireAuth);

  // List reports with filtering, search, sorting, pagination
  router.get('/', (req, res) => {
    const {
      page = '1',
      limit = '25',
      sort = 'inspection_date',
      order = 'DESC',
      customer_id,
      report_type,
      status,
      date_from,
      date_to,
      search,
    } = req.query;

    const conditions: string[] = [];
    const params: any[] = [];

    if (customer_id) {
      conditions.push('r.customer_id = ?');
      params.push(customer_id);
    }
    if (report_type) {
      conditions.push('r.report_type = ?');
      params.push(report_type);
    }
    if (status) {
      conditions.push('r.status = ?');
      params.push(status);
    }
    if (date_from) {
      conditions.push('r.inspection_date >= ?');
      params.push(date_from);
    }
    if (date_to) {
      conditions.push('r.inspection_date <= ?');
      params.push(date_to);
    }
    if (search) {
      conditions.push('(c.name LIKE ? OR cs.address LIKE ? OR r.inspector_name LIKE ? OR r.other_information LIKE ?)');
      const s = `%${search}%`;
      params.push(s, s, s, s);
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    const allowedSorts = ['inspection_date', 'created_at', 'customer_name', 'report_type', 'status'];
    const sortCol = allowedSorts.includes(sort as string)
      ? sort === 'customer_name'
        ? 'c.name'
        : `r.${sort}`
      : 'r.inspection_date';
    const sortOrder = order === 'ASC' ? 'ASC' : 'DESC';

    const offset = (parseInt(page as string, 10) - 1) * parseInt(limit as string, 10);

    const countRow = db
      .prepare(
        `SELECT COUNT(*) as total FROM reports r
       JOIN customers c ON r.customer_id = c.id
       JOIN customer_sites cs ON r.site_id = cs.id
       ${where}`,
      )
      .get(...params) as { total: number };

    const rows = db
      .prepare(
        `SELECT r.*, c.name as customer_name, cs.address as site_address
       FROM reports r
       JOIN customers c ON r.customer_id = c.id
       JOIN customer_sites cs ON r.site_id = cs.id
       ${where}
       ORDER BY ${sortCol} ${sortOrder}
       LIMIT ? OFFSET ?`,
      )
      .all(...params, parseInt(limit as string, 10), offset);

    res.json({
      data: rows,
      total: countRow.total,
      page: parseInt(page as string, 10),
      limit: parseInt(limit as string, 10),
    });
  });

  // Get single report with all details
  router.get('/:id', (req, res) => {
    const report = loadReportWithDetails(db, parseInt(req.params.id, 10));

    if (!report) {
      res.status(404).json({ error: 'Report not found' });
      return;
    }

    res.json(report);
  });

  // Create report
  router.post('/', (req, res) => {
    const {
      report_type,
      customer_id,
      site_id,
      inspection_date,
      inspection_time,
      inspector_name,
      quality_score,
      inspection_passed,
      other_information,
      date_completed,
      status,
      on_behalf_of,
      assigned_to_id,
      inspection_details,
      unwanted_materials,
      contaminants,
      containers,
      pern_details,
    } = req.body;

    if (!report_type || !customer_id || !site_id || !inspection_date || !inspector_name) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    const saveReport = db.transaction(() => {
      const result = db
        .prepare(
          `INSERT INTO reports (report_type, customer_id, site_id, inspection_date, inspection_time,
         inspector_id, inspector_name, quality_score, inspection_passed, other_information,
         date_completed, status, on_behalf_of, assigned_to_id, created_by_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          report_type,
          customer_id,
          site_id,
          inspection_date,
          inspection_time,
          req.session.userId,
          inspector_name,
          quality_score,
          inspection_passed !== undefined ? (inspection_passed ? 1 : 0) : null,
          other_information,
          date_completed,
          status || 'draft',
          on_behalf_of ?? null,
          assigned_to_id ?? null,
          req.session.userId,
        );

      const reportId = result.lastInsertRowid as number;

      // Save type-specific details
      const isInspection = INSPECTION_REPORT_TYPES.includes(report_type) || report_type.startsWith('inspection_');
      if (isInspection && inspection_details) {
        saveInspectionDetails(db, reportId, inspection_details);
      }
      if (report_type === 'pern_audit' && pern_details) {
        savePernDetails(db, reportId, pern_details);
      }

      // Save unwanted materials
      if (unwanted_materials?.length) {
        const stmt = db.prepare('INSERT INTO report_unwanted_materials (report_id, material, notes) VALUES (?, ?, ?)');
        for (const m of unwanted_materials) {
          stmt.run(reportId, m.material, m.notes || null);
        }
      }

      // Save contaminants
      if (contaminants?.length) {
        const stmt = db.prepare('INSERT INTO report_contaminants (report_id, contaminant, notes) VALUES (?, ?, ?)');
        for (const c of contaminants) {
          stmt.run(reportId, c.contaminant, c.notes || null);
        }
      }

      // Save containers
      const containerIds: number[] = [];
      if (containers?.length) {
        const stmt = db.prepare(
          'INSERT INTO report_containers (report_id, container_number, seal_number, weight_info, number_of_bales, weighbridge_ticket, weight, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        );
        for (let i = 0; i < containers.length; i++) {
          const c = containers[i];
          const r = stmt.run(reportId, c.container_number, c.seal_number, c.weight_info, c.number_of_bales ?? null, c.weighbridge_ticket ?? null, c.weight ?? null, i);
          containerIds.push(r.lastInsertRowid as number);
        }
      }

      return { reportId, containerIds };
    });

    const result = saveReport();
    res.json({ id: result.reportId, containerIds: result.containerIds });
  });

  // Update report
  router.put('/:id', (req, res) => {
    const {
      report_type,
      customer_id,
      site_id,
      inspection_date,
      inspection_time,
      inspector_name,
      quality_score,
      inspection_passed,
      other_information,
      date_completed,
      status,
      on_behalf_of,
      assigned_to_id,
      inspection_details,
      unwanted_materials,
      contaminants,
      containers,
      pern_details,
    } = req.body;

    const reportId = parseInt(req.params.id, 10);

    const existing = db.prepare('SELECT id, report_type FROM reports WHERE id = ?').get(reportId) as any;
    if (!existing) {
      res.status(404).json({ error: 'Report not found' });
      return;
    }

    const updateReport = db.transaction(() => {
      db.prepare(
        `UPDATE reports SET
         report_type = COALESCE(?, report_type),
         customer_id = COALESCE(?, customer_id),
         site_id = COALESCE(?, site_id),
         inspection_date = COALESCE(?, inspection_date),
         inspection_time = COALESCE(?, inspection_time),
         inspector_id = ?,
         inspector_name = COALESCE(?, inspector_name),
         quality_score = ?,
         inspection_passed = ?,
         other_information = ?,
         date_completed = ?,
         status = COALESCE(?, status),
         on_behalf_of = COALESCE(?, on_behalf_of),
         assigned_to_id = ?,
         updated_at = datetime('now')
         WHERE id = ?`,
      ).run(
        report_type,
        customer_id,
        site_id,
        inspection_date,
        inspection_time,
        req.session.userId,
        inspector_name,
        quality_score ?? null,
        inspection_passed !== undefined ? (inspection_passed ? 1 : 0) : null,
        other_information ?? null,
        date_completed ?? null,
        status,
        on_behalf_of ?? null,
        assigned_to_id ?? null,
        reportId,
      );

      const rType = report_type || existing.report_type;

      // Replace inspection details
      const isInspectionPut = INSPECTION_REPORT_TYPES.includes(rType) || rType.startsWith('inspection_');
      if (isInspectionPut && inspection_details) {
        db.prepare('DELETE FROM report_inspection_details WHERE report_id = ?').run(reportId);
        saveInspectionDetails(db, reportId, inspection_details);
      }

      if (rType === 'pern_audit' && pern_details) {
        db.prepare('DELETE FROM report_pern_details WHERE report_id = ?').run(reportId);
        savePernDetails(db, reportId, pern_details);
      }

      // Replace unwanted materials
      if (unwanted_materials !== undefined) {
        db.prepare('DELETE FROM report_unwanted_materials WHERE report_id = ?').run(reportId);
        if (unwanted_materials?.length) {
          const stmt = db.prepare(
            'INSERT INTO report_unwanted_materials (report_id, material, notes) VALUES (?, ?, ?)',
          );
          for (const m of unwanted_materials) {
            stmt.run(reportId, m.material, m.notes || null);
          }
        }
      }

      // Replace contaminants
      if (contaminants !== undefined) {
        db.prepare('DELETE FROM report_contaminants WHERE report_id = ?').run(reportId);
        if (contaminants?.length) {
          const stmt = db.prepare('INSERT INTO report_contaminants (report_id, contaminant, notes) VALUES (?, ?, ?)');
          for (const c of contaminants) {
            stmt.run(reportId, c.contaminant, c.notes || null);
          }
        }
      }

      // Replace containers
      if (containers !== undefined) {
        // Keep container IDs for photo references - delete containers without photos
        db.prepare('DELETE FROM report_containers WHERE report_id = ?').run(reportId);
        if (containers?.length) {
          const stmt = db.prepare(
            'INSERT INTO report_containers (report_id, container_number, seal_number, weight_info, number_of_bales, weighbridge_ticket, weight, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          );
          const newContainerIds: number[] = [];
          for (let i = 0; i < containers.length; i++) {
            const c = containers[i];
            const r = stmt.run(reportId, c.container_number, c.seal_number, c.weight_info, c.number_of_bales ?? null, c.weighbridge_ticket ?? null, c.weight ?? null, i);
            newContainerIds.push(r.lastInsertRowid as number);
          }
          return newContainerIds;
        }
      }

      return [];
    });

    const containerIds = updateReport();
    res.json({ ok: true, containerIds });
  });

  // Delete report
  router.delete('/:id', (req, res) => {
    const existing = db.prepare('SELECT id FROM reports WHERE id = ?').get(req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Report not found' });
      return;
    }

    db.prepare('DELETE FROM reports WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  return router;
}

function saveInspectionDetails(db: Database.Database, reportId: number, d: any): void {
  db.prepare(
    `INSERT INTO report_inspection_details (
      report_id, product_description, product_grade, mode_of_storage,
      moisture_reading_low, moisture_reading_high, moisture_readings,
      radiation_reading, loading_reference, number_of_containers,
      stock_bale_count, mixed_paper_exceeds_34_5, occ_exceeds_80,
      plastic_exceeds_97_5, material_originates_uk, supplier_aware_pern,
      supplier_controls_volume, volume_consistency_notes, site_buys_prebaled,
      prebaled_uk_assurance, site_aware_non_uk,
      rejected_bales, bale_break, bale_break_results, packaging_thresholds
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    reportId,
    d.product_description ?? null,
    d.product_grade ?? null,
    d.mode_of_storage ?? null,
    d.moisture_reading_low ?? null,
    d.moisture_reading_high ?? null,
    d.moisture_readings ?? null,
    d.radiation_reading ?? null,
    d.loading_reference ?? null,
    d.number_of_containers ?? null,
    d.stock_bale_count ?? null,
    d.mixed_paper_exceeds_34_5 ?? null,
    d.occ_exceeds_80 ?? null,
    d.plastic_exceeds_97_5 ?? null,
    d.material_originates_uk ?? null,
    d.supplier_aware_pern ?? null,
    d.supplier_controls_volume ?? null,
    d.volume_consistency_notes ?? null,
    d.site_buys_prebaled ?? null,
    d.prebaled_uk_assurance ?? null,
    d.site_aware_non_uk ?? null,
    d.rejected_bales ?? null,
    d.bale_break ?? null,
    d.bale_break_results ?? null,
    Array.isArray(d.packaging_thresholds) ? JSON.stringify(d.packaging_thresholds) : (d.packaging_thresholds ?? null),
  );
}

function savePernDetails(db: Database.Database, reportId: number, d: any): void {
  db.prepare(
    `INSERT INTO report_pern_details (
      report_id, company_name_address, contact_name, email, phone,
      grades_supplied, num_workers, site_type, safety_inducted,
      materials_handled, prn_accredited, prn_numbers, permits_licences,
      accreditations, site_facilities, area_size, process_flow,
      throughput, waste_sources, transfer_notes_checked,
      safety_equipment, safety_comments, worker_recording,
      worker_recording_comments, ppe_suitable, uniform_or_own,
      accident_log, employer_liability, public_liability,
      mgmt_experience, prn_expertise, packaging_differentiation,
      packaging_identification, non_uk_packaging, non_uk_comments,
      prn_claimed_once, training_types, training_scope,
      training_recording, training_review_frequency, training_records_inspected,
      workers_consistent, bale_split_results, quality_discussion,
      follow_up, notes, auditor_position, intro_letter
    ) VALUES (${Array(48).fill('?').join(', ')})`,
  ).run(
    reportId,
    d.company_name_address ?? null,
    d.contact_name ?? null,
    d.email ?? null,
    d.phone ?? null,
    d.grades_supplied ?? null,
    d.num_workers ?? null,
    Array.isArray(d.site_type) ? JSON.stringify(d.site_type) : (d.site_type ?? null),
    d.safety_inducted ?? null,
    d.materials_handled ?? null,
    d.prn_accredited ?? null,
    d.prn_numbers ?? null,
    d.permits_licences ?? null,
    Array.isArray(d.accreditations) ? JSON.stringify(d.accreditations) : (d.accreditations ?? null),
    Array.isArray(d.site_facilities) ? JSON.stringify(d.site_facilities) : (d.site_facilities ?? null),
    d.area_size ?? null,
    d.process_flow ?? null,
    d.throughput ?? null,
    Array.isArray(d.waste_sources) ? JSON.stringify(d.waste_sources) : (d.waste_sources ?? null),
    d.transfer_notes_checked ?? null,
    Array.isArray(d.safety_equipment) ? JSON.stringify(d.safety_equipment) : (d.safety_equipment ?? null),
    d.safety_comments ?? null,
    Array.isArray(d.worker_recording) ? JSON.stringify(d.worker_recording) : (d.worker_recording ?? null),
    d.worker_recording_comments ?? null,
    d.ppe_suitable ?? null,
    d.uniform_or_own ?? null,
    d.accident_log ?? null,
    d.employer_liability ?? null,
    d.public_liability ?? null,
    d.mgmt_experience ?? null,
    d.prn_expertise ?? null,
    d.packaging_differentiation ?? null,
    d.packaging_identification ?? null,
    d.non_uk_packaging ?? null,
    d.non_uk_comments ?? null,
    d.prn_claimed_once ?? null,
    Array.isArray(d.training_types) ? JSON.stringify(d.training_types) : (d.training_types ?? null),
    d.training_scope ?? null,
    Array.isArray(d.training_recording) ? JSON.stringify(d.training_recording) : (d.training_recording ?? null),
    d.training_review_frequency ?? null,
    d.training_records_inspected ?? null,
    d.workers_consistent ?? null,
    d.bale_split_results ?? null,
    d.quality_discussion ?? null,
    d.follow_up ?? null,
    d.notes ?? null,
    d.auditor_position ?? null,
    d.intro_letter ?? null,
  );
}
