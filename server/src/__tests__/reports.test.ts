import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type Database from 'better-sqlite3';
import type { Express } from 'express';
import { createTestDb, createTestApp, loginAsAdmin, loginAsRegularUser, createTestCustomerAndSite } from './helpers';

describe('Report Routes', () => {
  let db: Database.Database;
  let app: Express;
  let cookie: string;
  let customerId: number;
  let siteId: number;

  beforeEach(async () => {
    db = createTestDb();
    app = createTestApp(db);
    cookie = await loginAsAdmin(app);
    const result = createTestCustomerAndSite(db);
    customerId = result.customerId;
    siteId = result.siteId;
  });

  function createFibreReport(overrides: any = {}) {
    return {
      report_type: 'inspection_fibre',
      customer_id: customerId,
      site_id: siteId,
      inspection_date: '2025-01-15',
      inspection_time: '10:00',
      inspector_name: 'Test Inspector',
      quality_score: 4,
      inspection_passed: true,
      other_information: 'Test notes',
      status: 'draft',
      inspection_details: {
        product_grade: 'OCC',
        mode_of_storage: 'Bale Stacking Outside Storage',
        moisture_reading_low: '10',
        moisture_reading_high: '20',
        stock_bale_count: '50',
        mixed_paper_exceeds_34_5: 'YES',
        occ_exceeds_80: 'YES',
        material_originates_uk: 'YES',
        supplier_aware_pern: 'YES',
      },
      unwanted_materials: [{ material: 'Paper', notes: 'Some notes' }, { material: 'Cores' }],
      contaminants: [{ contaminant: 'Metal' }],
      ...overrides,
    };
  }

  function createPlasticsReport(overrides: any = {}) {
    return {
      report_type: 'inspection_plastics',
      customer_id: customerId,
      site_id: siteId,
      inspection_date: '2025-02-15',
      inspector_name: 'Test Inspector',
      status: 'draft',
      inspection_details: {
        product_description: 'PET',
        product_grade: '98/2',
        loading_reference: 'LR-001',
        number_of_containers: 2,
        moisture_readings: '5%',
        radiation_reading: '0.1',
        plastic_exceeds_97_5: 'YES',
      },
      containers: [
        { container_number: 'C001', seal_number: 'S001', weight_info: '20t' },
        { container_number: 'C002', seal_number: 'S002', weight_info: '18t' },
      ],
      ...overrides,
    };
  }

  function createPernReport(overrides: any = {}) {
    return {
      report_type: 'pern_audit',
      customer_id: customerId,
      site_id: siteId,
      inspection_date: '2025-03-15',
      inspector_name: 'Auditor Name',
      status: 'draft',
      pern_details: {
        company_name_address: 'Test Company, 123 St',
        contact_name: 'John',
        email: 'john@test.com',
        phone: '12345',
        grades_supplied: 'OCC',
        num_workers: '10',
        site_type: ['MRF', 'Transfer Station'],
        safety_inducted: 'YES',
        materials_handled: 'Card, Paper',
        prn_accredited: 'YES',
        accreditations: ['ISO 9001', 'ISO 14001'],
        site_facilities: ['Weighbridge', 'Office'],
        waste_sources: ['Commercial', 'Industrial'],
        safety_equipment: ['Gloves', 'Hi-vis'],
        worker_recording: ['Clocking in', 'Sign in'],
        training_types: ['Manual Handling', 'Fire Safety'],
        training_recording: ['Digital', 'Paper'],
        auditor_position: 'Inspector',
      },
      ...overrides,
    };
  }

  describe('POST /api/reports', () => {
    it('should create a fibre inspection report', async () => {
      const res = await request(app).post('/api/reports').set('Cookie', cookie).send(createFibreReport());
      expect(res.status).toBe(200);
      expect(res.body.id).toBeDefined();

      // Verify in DB
      const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(res.body.id) as any;
      expect(report.report_type).toBe('inspection_fibre');
      expect(report.quality_score).toBe(4);
      expect(report.inspection_passed).toBe(1);

      const details = db.prepare('SELECT * FROM report_inspection_details WHERE report_id = ?').get(res.body.id) as any;
      expect(details.product_grade).toBe('OCC');
      expect(details.moisture_reading_low).toBe('10');

      const materials = db.prepare('SELECT * FROM report_unwanted_materials WHERE report_id = ?').all(res.body.id);
      expect(materials.length).toBe(2);

      const contaminants = db.prepare('SELECT * FROM report_contaminants WHERE report_id = ?').all(res.body.id);
      expect(contaminants.length).toBe(1);
    });

    it('should create a plastics report with containers', async () => {
      const res = await request(app).post('/api/reports').set('Cookie', cookie).send(createPlasticsReport());
      expect(res.status).toBe(200);
      expect(res.body.containerIds).toHaveLength(2);

      const containers = db
        .prepare('SELECT * FROM report_containers WHERE report_id = ? ORDER BY sort_order')
        .all(res.body.id) as any[];
      expect(containers.length).toBe(2);
      expect(containers[0].container_number).toBe('C001');
      expect(containers[1].sort_order).toBe(1);
    });

    it('should create a PERN audit report', async () => {
      const res = await request(app).post('/api/reports').set('Cookie', cookie).send(createPernReport());
      expect(res.status).toBe(200);

      const pern = db.prepare('SELECT * FROM report_pern_details WHERE report_id = ?').get(res.body.id) as any;
      expect(pern.company_name_address).toBe('Test Company, 123 St');
      expect(JSON.parse(pern.site_type)).toEqual(['MRF', 'Transfer Station']);
      expect(JSON.parse(pern.accreditations)).toEqual(['ISO 9001', 'ISO 14001']);
    });

    it('should reject missing required fields', async () => {
      const res = await request(app)
        .post('/api/reports')
        .set('Cookie', cookie)
        .send({ report_type: 'inspection_fibre' });
      expect(res.status).toBe(400);
    });

    it('should reject unauthenticated', async () => {
      const res = await request(app).post('/api/reports').send(createFibreReport());
      expect(res.status).toBe(401);
    });

    it('should default status to draft', async () => {
      const data = createFibreReport();
      delete data.status;
      const res = await request(app).post('/api/reports').set('Cookie', cookie).send(data);
      expect(res.status).toBe(200);

      const report = db.prepare('SELECT status FROM reports WHERE id = ?').get(res.body.id) as any;
      expect(report.status).toBe('draft');
    });
  });

  describe('GET /api/reports', () => {
    beforeEach(async () => {
      await request(app).post('/api/reports').set('Cookie', cookie).send(createFibreReport());
      await request(app).post('/api/reports').set('Cookie', cookie).send(createPlasticsReport());
    });

    it('should list reports with pagination', async () => {
      const res = await request(app).get('/api/reports').set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(res.body.data).toBeInstanceOf(Array);
      expect(res.body.total).toBe(2);
      expect(res.body.page).toBe(1);
      expect(res.body.data[0]).toHaveProperty('customer_name');
      expect(res.body.data[0]).toHaveProperty('site_address');
    });

    it('should filter by customer', async () => {
      const res = await request(app).get(`/api/reports?customer_id=${customerId}`).set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(2);
    });

    it('should filter by report type', async () => {
      const res = await request(app).get('/api/reports?report_type=inspection_fibre').set('Cookie', cookie);
      expect(res.body.total).toBe(1);
      expect(res.body.data[0].report_type).toBe('inspection_fibre');
    });

    it('should filter by date range', async () => {
      const res = await request(app).get('/api/reports?date_from=2025-02-01&date_to=2025-02-28').set('Cookie', cookie);
      expect(res.body.total).toBe(1);
    });

    it('should filter by status', async () => {
      const res = await request(app).get('/api/reports?status=draft').set('Cookie', cookie);
      expect(res.body.total).toBe(2);
    });

    it('should search by text', async () => {
      const res = await request(app).get('/api/reports?search=Test%20Customer').set('Cookie', cookie);
      expect(res.body.total).toBe(2);
    });

    it('should sort by customer name', async () => {
      const res = await request(app).get('/api/reports?sort=customer_name&order=ASC').set('Cookie', cookie);
      expect(res.status).toBe(200);
    });

    it('should handle pagination', async () => {
      const res = await request(app).get('/api/reports?page=1&limit=1').set('Cookie', cookie);
      expect(res.body.data.length).toBe(1);
      expect(res.body.total).toBe(2);
    });

    it('should use default sort order', async () => {
      const res = await request(app).get('/api/reports?sort=invalid_sort').set('Cookie', cookie);
      expect(res.status).toBe(200);
    });
  });

  describe('GET /api/reports/:id', () => {
    it('should get a fibre report with all details', async () => {
      const createRes = await request(app).post('/api/reports').set('Cookie', cookie).send(createFibreReport());

      const res = await request(app).get(`/api/reports/${createRes.body.id}`).set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(res.body.report_type).toBe('inspection_fibre');
      expect(res.body.inspection_details).toBeDefined();
      expect(res.body.inspection_details.product_grade).toBe('OCC');
      expect(res.body.unwanted_materials).toHaveLength(2);
      expect(res.body.contaminants).toHaveLength(1);
      expect(res.body.photos).toBeInstanceOf(Array);
      expect(res.body.customer_name).toBe('Test Customer');
    });

    it('should get a plastics report with containers', async () => {
      const createRes = await request(app).post('/api/reports').set('Cookie', cookie).send(createPlasticsReport());

      const res = await request(app).get(`/api/reports/${createRes.body.id}`).set('Cookie', cookie);
      expect(res.body.containers).toHaveLength(2);
      expect(res.body.inspection_details).toBeDefined();
    });

    it('should get a PERN audit with pern_details', async () => {
      const createRes = await request(app).post('/api/reports').set('Cookie', cookie).send(createPernReport());

      const res = await request(app).get(`/api/reports/${createRes.body.id}`).set('Cookie', cookie);
      expect(res.body.pern_details).toBeDefined();
      expect(res.body.pern_details.company_name_address).toBe('Test Company, 123 St');
    });

    it('should return 404 for non-existent report', async () => {
      const res = await request(app).get('/api/reports/999').set('Cookie', cookie);
      expect(res.status).toBe(404);
    });
  });

  describe('PUT /api/reports/:id', () => {
    it('should update a fibre report', async () => {
      const createRes = await request(app).post('/api/reports').set('Cookie', cookie).send(createFibreReport());

      const res = await request(app)
        .put(`/api/reports/${createRes.body.id}`)
        .set('Cookie', cookie)
        .send({
          quality_score: 5,
          inspection_passed: false,
          status: 'completed',
          inspection_details: {
            product_grade: 'Mixed Paper',
            mode_of_storage: 'Loose Material',
          },
          unwanted_materials: [{ material: 'Greyboard' }],
          contaminants: [],
        });
      expect(res.status).toBe(200);

      const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(createRes.body.id) as any;
      expect(report.quality_score).toBe(5);
      expect(report.inspection_passed).toBe(0);
      expect(report.status).toBe('completed');

      const details = db
        .prepare('SELECT * FROM report_inspection_details WHERE report_id = ?')
        .get(createRes.body.id) as any;
      expect(details.product_grade).toBe('Mixed Paper');

      const materials = db
        .prepare('SELECT * FROM report_unwanted_materials WHERE report_id = ?')
        .all(createRes.body.id);
      expect(materials.length).toBe(1);

      const contaminants = db.prepare('SELECT * FROM report_contaminants WHERE report_id = ?').all(createRes.body.id);
      expect(contaminants.length).toBe(0);
    });

    it('should update a plastics report with containers', async () => {
      const createRes = await request(app).post('/api/reports').set('Cookie', cookie).send(createPlasticsReport());

      const res = await request(app)
        .put(`/api/reports/${createRes.body.id}`)
        .set('Cookie', cookie)
        .send({
          containers: [{ container_number: 'C003', seal_number: 'S003', weight_info: '25t' }],
        });
      expect(res.status).toBe(200);
      expect(res.body.containerIds).toHaveLength(1);
    });

    it('should preserve container photos when a report is updated', async () => {
      const createRes = await request(app).post('/api/reports').set('Cookie', cookie).send(createPlasticsReport());
      const reportId = createRes.body.id;
      const [c1, c2] = createRes.body.containerIds;

      // Simulate a previously uploaded photo attached to the first container
      db.prepare('INSERT INTO report_photos (report_id, container_id, photo_label, file_path) VALUES (?, ?, ?, ?)').run(
        reportId,
        c1,
        'Container shot',
        `${reportId}/photo.jpg`,
      );

      // Re-save as the client does: existing containers carry their real IDs,
      // new ones a temporary negative ID
      const res = await request(app)
        .put(`/api/reports/${reportId}`)
        .set('Cookie', cookie)
        .send({
          containers: [
            { id: c1, container_number: 'C001', seal_number: 'S001', weight_info: '20t' },
            { id: c2, container_number: 'C002-edited', seal_number: 'S002', weight_info: '18t' },
            { id: -1, container_number: 'C003', seal_number: 'S003', weight_info: '15t' },
          ],
        });
      expect(res.status).toBe(200);
      expect(res.body.containerIds).toHaveLength(3);

      const photo = db.prepare('SELECT * FROM report_photos WHERE report_id = ?').get(reportId) as any;
      expect(photo).toBeDefined();
      expect(photo.container_id).toBe(res.body.containerIds[0]);

      const updated = db
        .prepare('SELECT * FROM report_containers WHERE report_id = ? ORDER BY sort_order')
        .all(reportId) as any[];
      expect(updated).toHaveLength(3);
      expect(updated[1].container_number).toBe('C002-edited');
    });

    it('should delete photos of containers removed from the report', async () => {
      const createRes = await request(app).post('/api/reports').set('Cookie', cookie).send(createPlasticsReport());
      const reportId = createRes.body.id;
      const [c1, c2] = createRes.body.containerIds;

      db.prepare('INSERT INTO report_photos (report_id, container_id, photo_label, file_path) VALUES (?, ?, ?, ?)').run(
        reportId,
        c2,
        'Doomed shot',
        `${reportId}/photo2.jpg`,
      );

      // Re-save with the second container removed
      const res = await request(app)
        .put(`/api/reports/${reportId}`)
        .set('Cookie', cookie)
        .send({
          containers: [{ id: c1, container_number: 'C001', seal_number: 'S001', weight_info: '20t' }],
        });
      expect(res.status).toBe(200);
      expect(res.body.containerIds).toEqual([c1]);

      const photos = db.prepare('SELECT * FROM report_photos WHERE report_id = ?').all(reportId);
      expect(photos).toHaveLength(0);
    });

    it('should update a PERN audit', async () => {
      const createRes = await request(app).post('/api/reports').set('Cookie', cookie).send(createPernReport());

      const res = await request(app)
        .put(`/api/reports/${createRes.body.id}`)
        .set('Cookie', cookie)
        .send({
          pern_details: {
            company_name_address: 'Updated Company',
            site_type: ['Reprocessor'],
          },
        });
      expect(res.status).toBe(200);

      const pern = db.prepare('SELECT * FROM report_pern_details WHERE report_id = ?').get(createRes.body.id) as any;
      expect(pern.company_name_address).toBe('Updated Company');
    });

    it('should return 404 for non-existent report', async () => {
      const res = await request(app).put('/api/reports/999').set('Cookie', cookie).send({ status: 'completed' });
      expect(res.status).toBe(404);
    });
  });

  describe('New field persistence', () => {
    it('creates a loading_inspection with new fields and reads them back', async () => {
      const db = createTestDb();
      const app = createTestApp(db);
      const cookie = await loginAsAdmin(app);
      const { customerId, siteId } = createTestCustomerAndSite(db);

      const res = await request(app)
        .post('/api/reports')
        .set('Cookie', cookie)
        .send({
          report_type: 'loading_inspection',
          customer_id: customerId,
          site_id: siteId,
          inspection_date: '2026-05-01',
          inspector_name: 'Insp',
          on_behalf_of: 'VISY Recycling UK',
          inspection_details: {
            product_grade: '95/5 OCC',
            rejected_bales: '2',
            packaging_thresholds: ['OCC 80%', 'PET 97.5%'],
          },
          containers: [
            {
              container_number: 'AAA1',
              number_of_bales: '32 Bales',
              weighbridge_ticket: '786371',
              weight: '19.04 Tonnes',
            },
          ],
        });
      expect(res.status).toBe(200);

      const created = db.prepare('SELECT * FROM reports WHERE id = ?').get(res.body.id) as any;
      expect(created.on_behalf_of).toBe('VISY Recycling UK');
      expect(created.created_by_id).toBeGreaterThan(0);

      const full = await request(app).get(`/api/reports/${res.body.id}`).set('Cookie', cookie);
      expect(full.body.inspection_details.rejected_bales).toBe('2');
      expect(JSON.parse(full.body.inspection_details.packaging_thresholds)).toEqual(['OCC 80%', 'PET 97.5%']);
      expect(full.body.containers[0].number_of_bales).toBe('32 Bales');
      expect(full.body.containers[0].weight).toBe('19.04 Tonnes');
    });

    it('creates a quarterly_pern with bale_break fields', async () => {
      const db = createTestDb();
      const app = createTestApp(db);
      const cookie = await loginAsAdmin(app);
      const { customerId, siteId } = createTestCustomerAndSite(db);

      const res = await request(app)
        .post('/api/reports')
        .set('Cookie', cookie)
        .send({
          report_type: 'quarterly_pern',
          customer_id: customerId,
          site_id: siteId,
          inspection_date: '2026-05-02',
          inspector_name: 'Insp',
          inspection_details: { bale_break: 1, bale_break_results: 'clean', packaging_thresholds: ['OCC 97.5%'] },
        });
      expect(res.status).toBe(200);
      const full = await request(app).get(`/api/reports/${res.body.id}`).set('Cookie', cookie);
      expect(full.body.inspection_details.bale_break).toBe(1);
      expect(full.body.inspection_details.bale_break_results).toBe('clean');
    });
  });

  describe('DELETE /api/reports/:id', () => {
    it('should delete a report', async () => {
      const createRes = await request(app).post('/api/reports').set('Cookie', cookie).send(createFibreReport());

      const res = await request(app).delete(`/api/reports/${createRes.body.id}`).set('Cookie', cookie);
      expect(res.status).toBe(200);

      // Verify cascade delete
      const details = db.prepare('SELECT * FROM report_inspection_details WHERE report_id = ?').get(createRes.body.id);
      expect(details).toBeUndefined();
    });

    it('should return 404 for non-existent report', async () => {
      const res = await request(app).delete('/api/reports/999').set('Cookie', cookie);
      expect(res.status).toBe(404);
    });
  });

  describe('Access control and lifecycle', () => {
    it('non-superuser only sees own/assigned reports; superuser sees all', async () => {
      const db = createTestDb();
      const app = createTestApp(db);
      const adminCookie = await loginAsAdmin(app);
      const { customerId, siteId } = createTestCustomerAndSite(db);

      await request(app).post('/api/reports').set('Cookie', adminCookie).send({
        report_type: 'loading_inspection',
        customer_id: customerId,
        site_id: siteId,
        inspection_date: '2026-05-01',
        inspector_name: 'A',
      });

      const regularCookie = await loginAsRegularUser(app, db);
      const regList = await request(app).get('/api/reports').set('Cookie', regularCookie);
      expect(regList.body.data.length).toBe(0);

      const adminList = await request(app).get('/api/reports').set('Cookie', adminCookie);
      expect(adminList.body.total).toBeGreaterThanOrEqual(1);
    });

    it('submit marks completed; reopen returns to assigned', async () => {
      const db = createTestDb();
      const app = createTestApp(db);
      const cookie = await loginAsAdmin(app);
      const { customerId, siteId } = createTestCustomerAndSite(db);
      const res = await request(app).post('/api/reports').set('Cookie', cookie).send({
        report_type: 'loading_inspection',
        customer_id: customerId,
        site_id: siteId,
        inspection_date: '2026-05-01',
        inspector_name: 'A',
        status: 'assigned',
      });
      const id = res.body.id;

      const submit = await request(app).post(`/api/reports/${id}/submit`).set('Cookie', cookie).send({});
      expect(submit.status).toBe(200);
      expect((db.prepare('SELECT status, date_completed FROM reports WHERE id = ?').get(id) as any).status).toBe(
        'completed',
      );

      const reopen = await request(app).post(`/api/reports/${id}/reopen`).set('Cookie', cookie).send({});
      expect(reopen.status).toBe(200);
      expect((db.prepare('SELECT status FROM reports WHERE id = ?').get(id) as any).status).toBe('assigned');
    });
  });
});
