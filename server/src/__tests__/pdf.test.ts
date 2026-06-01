import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type Database from 'better-sqlite3';
import type { Express } from 'express';
import { createTestDb, createTestApp, loginAsAdmin, createTestCustomerAndSite } from './helpers';
import { generatePdf } from '../utils/pdf-generator';
import os from 'os';
import fs from 'fs';
import path from 'path';

describe('PDF Routes', () => {
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

  it('should generate PDF for a fibre report', async () => {
    const createRes = await request(app)
      .post('/api/reports')
      .set('Cookie', cookie)
      .send({
        report_type: 'inspection_fibre',
        customer_id: customerId,
        site_id: siteId,
        inspection_date: '2025-01-15',
        inspector_name: 'Test Inspector',
        quality_score: 4,
        inspection_passed: true,
        inspection_details: {
          product_grade: 'OCC',
          mode_of_storage: 'Bale Stacking Outside Storage',
        },
      });

    const res = await request(app).get(`/api/pdf/${createRes.body.id}`).set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['content-disposition']).toContain('.pdf');
  });

  it('should generate PDF for a plastics report', async () => {
    const createRes = await request(app)
      .post('/api/reports')
      .set('Cookie', cookie)
      .send({
        report_type: 'inspection_plastics',
        customer_id: customerId,
        site_id: siteId,
        inspection_date: '2025-02-15',
        inspector_name: 'Test Inspector',
        inspection_details: { product_description: 'PET', product_grade: '98/2' },
        containers: [{ container_number: 'C001', seal_number: 'S001' }],
      });

    const res = await request(app).get(`/api/pdf/${createRes.body.id}`).set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
  });

  it('should generate PDF for a PERN audit', async () => {
    const createRes = await request(app)
      .post('/api/reports')
      .set('Cookie', cookie)
      .send({
        report_type: 'pern_audit',
        customer_id: customerId,
        site_id: siteId,
        inspection_date: '2025-03-15',
        inspector_name: 'Auditor',
        pern_details: {
          company_name_address: 'Test Co',
          site_type: ['MRF'],
          accreditations: ['ISO 9001'],
        },
      });

    const res = await request(app).get(`/api/pdf/${createRes.body.id}`).set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
  });

  it('should return 404 for non-existent report', async () => {
    const res = await request(app).get('/api/pdf/999').set('Cookie', cookie);
    expect(res.status).toBe(404);
  });
});

describe('PDF Generator', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-pdf-shared-'));
  });

  it('generates a loading_inspection PDF with refined fields', async () => {
    const report = {
      id: 1, report_type: 'loading_inspection', status: 'completed',
      customer_name: 'Cust', site_address: 'Addr', inspection_date: '2026-05-01',
      inspector_name: 'Insp', on_behalf_of: 'VISY Recycling UK',
      inspection_details: { product_grade: '95/5 OCC', rejected_bales: '2', packaging_thresholds: JSON.stringify(['OCC 80%']) },
      unwanted_materials: [], contaminants: [],
      containers: [{ container_number: 'A1', seal_number: 'S1', number_of_bales: '32 Bales', weighbridge_ticket: '786371', weight: '19.04 Tonnes' }],
      photos: [],
    };
    const buf = await generatePdf(report as any, tmpDir);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('generates a quarterly_pern PDF with bale-break results', async () => {
    const report = {
      id: 2, report_type: 'quarterly_pern', status: 'completed',
      customer_name: 'Cust', site_address: 'Addr', inspection_date: '2026-05-02', inspector_name: 'Insp',
      inspection_details: { bale_break: 1, bale_break_results: 'clean', packaging_thresholds: JSON.stringify(['OCC 97.5%']) },
      unwanted_materials: [], contaminants: [], containers: [], photos: [],
    };
    const buf = await generatePdf(report as any, tmpDir);
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('should generate a buffer for fibre report', async () => {
    const report = {
      id: 1,
      report_type: 'inspection_fibre',
      customer_name: 'Test Customer',
      site_address: '123 Test St',
      inspection_date: '2025-01-15',
      inspection_time: '10:00',
      inspector_name: 'Inspector',
      status: 'draft',
      quality_score: 4,
      inspection_passed: 1,
      other_information: 'Some notes',
      date_completed: '2025-01-15',
      inspection_details: {
        product_grade: 'OCC',
        mode_of_storage: 'Bale Stacking',
        moisture_reading_low: '10',
        moisture_reading_high: '20',
        stock_bale_count: '50',
        mixed_paper_exceeds_34_5: 'YES',
        occ_exceeds_80: 'YES',
        material_originates_uk: 'YES',
        supplier_aware_pern: 'YES',
        supplier_controls_volume: 'YES',
        volume_consistency_notes: 'Consistent',
        site_buys_prebaled: 'NO',
        prebaled_uk_assurance: null,
        site_aware_non_uk: 'YES',
      },
      unwanted_materials: [{ material: 'Paper', notes: 'lots' }, { material: 'Cores' }],
      contaminants: [{ contaminant: 'Metal', notes: 'small pieces' }],
      photos: [],
      signature_path: null,
    };

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-pdf-'));
    const buffer = await generatePdf(report, tmpDir);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(0);
    // PDF magic bytes
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('should generate a buffer for plastics report with containers', async () => {
    const report = {
      id: 2,
      report_type: 'inspection_plastics',
      customer_name: 'Test Customer',
      site_address: '123 Test St',
      inspection_date: '2025-02-15',
      inspector_name: 'Inspector',
      status: 'completed',
      quality_score: null,
      inspection_passed: null,
      inspection_details: {
        product_description: 'PET',
        product_grade: '98/2',
        loading_reference: 'LR-001',
        number_of_containers: 1,
        moisture_readings: '5%',
        radiation_reading: '0.1',
        plastic_exceeds_97_5: 'YES',
        material_originates_uk: 'YES',
        supplier_aware_pern: 'YES',
      },
      unwanted_materials: [],
      contaminants: [],
      containers: [{ id: 1, container_number: 'C001', seal_number: 'S001', weight_info: '20t' }],
      photos: [],
      signature_path: null,
    };

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-pdf-'));
    const buffer = await generatePdf(report, tmpDir);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('should generate a buffer for PERN audit', async () => {
    const report = {
      id: 3,
      report_type: 'pern_audit',
      customer_name: 'Test Customer',
      site_address: '123 Test St',
      inspection_date: '2025-03-15',
      inspector_name: 'Auditor',
      status: 'draft',
      pern_details: {
        company_name_address: 'Test Co',
        contact_name: 'John',
        email: 'john@test.com',
        phone: '12345',
        grades_supplied: 'OCC',
        num_workers: '10',
        site_type: JSON.stringify(['MRF']),
        safety_inducted: 'YES',
        materials_handled: 'Card',
        prn_accredited: 'YES',
        prn_numbers: 'PRN001',
        permits_licences: 'Licence 1',
        accreditations: JSON.stringify(['ISO 9001']),
        site_facilities: JSON.stringify(['Weighbridge']),
        area_size: '5000sqm',
        process_flow: 'Linear',
        throughput: '100t/week',
        waste_sources: JSON.stringify(['Commercial']),
        transfer_notes_checked: 'YES',
        safety_equipment: JSON.stringify(['Gloves']),
        safety_comments: 'Good',
        worker_recording: JSON.stringify(['Clocking in']),
        worker_recording_comments: 'Digital system',
        ppe_suitable: 'YES',
        uniform_or_own: 'Uniform',
        accident_log: 'Up to date',
        employer_liability: 'Yes - £10m',
        public_liability: 'Yes - £5m',
        mgmt_experience: '10 years',
        prn_expertise: 'High',
        packaging_differentiation: 'YES',
        packaging_identification: 'Visual',
        non_uk_packaging: 'NO',
        non_uk_comments: null,
        prn_claimed_once: 'YES',
        training_types: JSON.stringify(['Manual Handling']),
        training_scope: 'All workers',
        training_recording: JSON.stringify(['Digital']),
        training_review_frequency: 'Annual',
        training_records_inspected: 'YES',
        workers_consistent: 'YES',
        bale_split_results: 'Good quality',
        quality_discussion: 'Discussed standards',
        follow_up: 'None required',
        notes: 'All satisfactory',
        auditor_position: 'Senior Inspector',
      },
      photos: [],
      signature_path: null,
      date_completed: '2025-03-15',
    };

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-pdf-'));
    const buffer = await generatePdf(report, tmpDir);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('should handle photos in PDF', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-pdf-'));

    // Create a minimal JPEG file (just enough to not error)
    const photoDir = path.join(tmpDir, '1');
    fs.mkdirSync(photoDir, { recursive: true });
    // Create a minimal valid 1x1 PNG
    const pngData = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64',
    );
    fs.writeFileSync(path.join(photoDir, 'test.png'), pngData);

    const report = {
      id: 1,
      report_type: 'inspection_fibre',
      customer_name: 'Test',
      site_address: 'Test',
      inspection_date: '2025-01-15',
      inspector_name: 'Test',
      status: 'draft',
      inspection_details: { product_grade: 'OCC', mode_of_storage: 'Bale' },
      unwanted_materials: [],
      contaminants: [],
      photos: [{ file_path: '1/test.png', photo_label: 'Test Photo', container_id: null }],
      signature_path: '1/test.png',
    };

    const buffer = await generatePdf(report, tmpDir);
    expect(buffer).toBeInstanceOf(Buffer);
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('should handle report with no signature gracefully', async () => {
    const report = {
      id: 1,
      report_type: 'inspection_fibre',
      customer_name: 'Test',
      site_address: 'Test',
      inspection_date: '2025-01-15',
      inspector_name: 'Test',
      status: 'draft',
      inspection_details: {},
      unwanted_materials: [],
      contaminants: [],
      photos: [],
      signature_path: null,
    };

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-pdf-'));
    const buffer = await generatePdf(report, tmpDir);
    expect(buffer).toBeInstanceOf(Buffer);
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('should handle missing signature file gracefully', async () => {
    const report = {
      id: 1,
      report_type: 'inspection_fibre',
      customer_name: 'Test',
      site_address: 'Test',
      inspection_date: '2025-01-15',
      inspector_name: 'Test',
      status: 'draft',
      inspection_details: {},
      unwanted_materials: [],
      contaminants: [],
      photos: [],
      signature_path: '1/nonexistent.jpg',
    };

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-pdf-'));
    const buffer = await generatePdf(report, tmpDir);
    expect(buffer).toBeInstanceOf(Buffer);
    fs.rmSync(tmpDir, { recursive: true });
  });
});
