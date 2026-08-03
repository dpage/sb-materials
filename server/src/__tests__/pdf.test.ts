import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type Database from 'better-sqlite3';
import type { Express } from 'express';
import { createTestDb, createTestApp, loginAsAdmin, createTestCustomerAndSite } from './helpers';
import { generatePdf } from '../utils/pdf-generator';
import { loadCollectionNote } from '../utils/collection-note-loader';
import {
  generateCollectionNotePdf,
  collectionNotePdfFilename,
  collectionNoteItemRows,
  formatUkDate,
} from '../utils/collection-note-pdf';
import os from 'os';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import crypto from 'crypto';
import zlib from 'zlib';

// Inflate every FlateDecode stream in a PDF and decode the hex-encoded text
// runs (e.g. `[<4f6e20> 0] TJ`) so tests can assert on rendered text. pdfmake
// emits one run per word with the trailing space inside the hex, so plain
// concatenation reconstructs the visible text. Image streams fail to inflate
// and are skipped.
function extractPdfText(buf: Buffer): string {
  const out: string[] = [];
  let idx = 0;
  while ((idx = buf.indexOf('stream', idx)) !== -1) {
    const start = buf.indexOf('\n', idx) + 1;
    const end = buf.indexOf('endstream', start);
    if (end === -1) break;
    let content = '';
    try {
      content = zlib.inflateSync(buf.subarray(start, end)).toString('latin1');
    } catch {
      // not a deflate stream (e.g. an image) - skip
    }
    for (const m of content.matchAll(/<([0-9a-fA-F]+)>/g)) {
      out.push(Buffer.from(m[1], 'hex').toString('latin1'));
    }
    idx = end + 'endstream'.length;
  }
  return out.join('');
}

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

describe('Verbatim inspection wording', () => {
  it('matches the original Google Form text exactly', async () => {
    const w = await import('../utils/wording');
    expect(w.UNWANTED_MATERIAL_QUESTION).toBe(
      'Unwanted Material (items that are not included in the grade being inspected - give details of the items found)',
    );
    expect(w.CONTAMINATES_QUESTION).toBe(
      'Contaminates (give details of items found) If any medical or Hazardous Waste is found STOP Inspection and call Buyer)',
    );
    expect(w.POST_CONSUMER_QUESTION).toBe(
      'Is the site aware of any material that is not defined as UK post consumer packaging?',
    );
    expect(w.QUALITY_SCORE_LABEL).toBe('Quality Score(1 being poor 5 being excellent)');
    expect(w.VOLUME_CONSISTENCY_QUESTION).toBe(
      'If no, how does the supplier ensure all material is consistent in source & quality?',
    );
  });

  it('names the trading company in the notify line, with a generic fallback', async () => {
    const w = await import('../utils/wording');
    expect(w.notifySiteLine('VISY Recycling UK')).toBe('If yes, the site must notify VISY Recycling UK immediately');
    expect(w.notifySiteLine(null)).toBe('If yes, the site must notify the Trading Company immediately');
    expect(w.notifySiteLine(undefined)).toBe('If yes, the site must notify the Trading Company immediately');
  });
});

describe('PDF Generator', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-pdf-shared-'));
  });

  it('generates a loading_inspection PDF with refined fields', async () => {
    const report = {
      id: 1,
      report_type: 'loading_inspection',
      status: 'completed',
      customer_name: 'Cust',
      site_address: 'Addr',
      inspection_date: '2026-05-01',
      inspector_name: 'Insp',
      on_behalf_of: 'VISY Recycling UK',
      inspection_details: {
        product_grade: '95/5 OCC',
        rejected_bales: '2',
        packaging_thresholds: JSON.stringify(['OCC 80%']),
      },
      unwanted_materials: [],
      contaminants: [],
      containers: [
        {
          container_number: 'A1',
          seal_number: 'S1',
          number_of_bales: '32 Bales',
          weighbridge_ticket: '786371',
          weight: '19.04 Tonnes',
        },
      ],
      photos: [],
    };
    const buf = await generatePdf(report as any, tmpDir);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('generates a quarterly_pern PDF with bale-break results', async () => {
    const report = {
      id: 2,
      report_type: 'quarterly_pern',
      status: 'completed',
      customer_name: 'Cust',
      site_address: 'Addr',
      inspection_date: '2026-05-02',
      inspector_name: 'Insp',
      inspection_details: {
        bale_break: 1,
        bale_break_results: 'clean',
        packaging_thresholds: JSON.stringify(['OCC 97.5%']),
      },
      unwanted_materials: [],
      contaminants: [],
      containers: [],
      photos: [],
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

  it('includes On Behalf Of on the PERN audit PDF', async () => {
    const baseAudit = {
      id: 7,
      report_type: 'pern_audit',
      status: 'completed',
      customer_name: 'Test Customer',
      site_address: '123 Test St',
      inspection_date: '2026-06-11',
      inspector_name: 'Auditor',
      on_behalf_of: 'Genus',
      pern_details: { company_name_address: 'Enava Ltd', contact_name: 'Jo' },
      photos: [],
    };
    // Control: the inspection PDF already renders On Behalf Of, proving the
    // text-extraction technique works before we assert on the audit PDF.
    const inspection = {
      ...baseAudit,
      id: 8,
      report_type: 'loading_inspection',
      inspection_details: { product_grade: 'OCC' },
      pern_details: undefined,
      unwanted_materials: [],
      contaminants: [],
      containers: [],
    };
    const controlText = extractPdfText(await generatePdf(inspection as any, tmpDir));
    expect(controlText).toContain('On Behalf Of');

    const auditText = extractPdfText(await generatePdf(baseAudit as any, tmpDir));
    expect(auditText).toContain('On Behalf Of');
    expect(auditText).toContain('Genus');
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

  it('downscales large photos so the PDF stays small', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-pdf-'));
    const photoDir = path.join(tmpDir, '1');
    fs.mkdirSync(photoDir, { recursive: true });

    // A 2400x1800 incompressible (random) image: ~13MB if embedded at full
    // resolution, but a few hundred KB once downscaled to the PDF cap.
    const W = 2400;
    const H = 1800;
    const raw = crypto.randomBytes(W * H * 3);
    await sharp(raw, { raw: { width: W, height: H, channels: 3 } })
      .png()
      .toFile(path.join(photoDir, 'big.png'));

    const report = {
      id: 1,
      report_type: 'loading_inspection',
      customer_name: 'Test',
      site_address: 'Test',
      inspection_date: '2026-05-01',
      inspector_name: 'Test',
      status: 'completed',
      inspection_details: { product_grade: 'OCC' },
      unwanted_materials: [],
      contaminants: [],
      containers: [],
      photos: [{ file_path: '1/big.png', photo_label: 'Big Photo', container_id: null }],
    };

    const buffer = await generatePdf(report as any, tmpDir);
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    // Full-res embedding would be several MB; downscaled it must be well under 1MB.
    expect(buffer.length).toBeLessThan(1_000_000);
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('embeds moisture-reading photos for a loading inspection', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-pdf-'));
    const photoDir = path.join(tmpDir, '1');
    fs.mkdirSync(photoDir, { recursive: true });
    const pngData = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64',
    );
    fs.writeFileSync(path.join(photoDir, 'moist.png'), pngData);

    const report = {
      id: 1,
      report_type: 'loading_inspection',
      customer_name: 'Test',
      site_address: 'Test',
      inspection_date: '2026-05-01',
      inspector_name: 'Test',
      status: 'completed',
      inspection_details: { product_grade: 'OCC', moisture_reading_low: '9%', moisture_reading_high: '14%' },
      unwanted_materials: [],
      contaminants: [],
      containers: [],
      photos: [{ file_path: '1/moist.png', photo_label: 'Moisture Readings', container_id: null }],
    };

    const buffer = await generatePdf(report as any, tmpDir);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
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

describe('collection note PDF', () => {
  let db: Database.Database;
  let app: Express;
  let cookie: string;
  let noteId: number;

  beforeEach(async () => {
    db = createTestDb();
    app = createTestApp(db);
    cookie = await loginAsAdmin(app);
    const cust = db.prepare('INSERT INTO customers (name) VALUES (?)').run('Acme Recycling Ltd');
    const created = await request(app)
      .post('/api/collection-notes')
      .set('Cookie', cookie)
      .send({
        reference: 'SBM1061',
        customer_id: cust.lastInsertRowid,
        collect_from_address: 'Acme Recycling Ltd\n1 Test Way\nTestville TE5 7ST',
        comments: 'COLLECTING ON BEHALF OF SB MATERIALS UK LTD',
        contact_name: 'Test User',
        contact_phone: '07700 900123',
        po_number: 'N/A',
        weight: '24t',
        packing_list_no: 'PL-1',
        collection_date: '2026-08-03',
        transport_company: 'Test Haulage',
        items: [
          { quantity: '1x', description: 'Poly cup reels', collection_point: 'Bay 3' },
          { quantity: '2x', description: 'Mixed paper bales', collection_point: 'Yard' },
          { quantity: '3x', description: 'Shrink wrap', collection_point: 'Bay 1' },
        ],
      })
      .expect(200);
    noteId = created.body.id;
  });

  it('generates a PDF', async () => {
    const res = await request(app)
      .get(`/api/pdf/collection-note/${noteId}`)
      .set('Cookie', cookie)
      .expect(200)
      .expect('Content-Type', 'application/pdf');
    expect(res.body.length).toBeGreaterThan(1000);
    expect(res.body.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('names the file for the reference, date, and customer', async () => {
    const res = await request(app).get(`/api/pdf/collection-note/${noteId}`).set('Cookie', cookie).expect(200);
    expect(res.headers['content-disposition']).toBe('attachment; filename="SBM1061-2026-08-03-Acme-Recycling-Ltd.pdf"');
  });

  it('requires authentication', async () => {
    await request(app).get(`/api/pdf/collection-note/${noteId}`).expect(401);
  });

  it('returns 404 for an unknown note', async () => {
    await request(app).get('/api/pdf/collection-note/9999').set('Cookie', cookie).expect(404);
  });

  it('maps every item row for the pure helper', () => {
    const note = loadCollectionNote(db, noteId)!;
    const rows = collectionNoteItemRows(note);
    expect(rows).toHaveLength(3);
    expect(rows[2][1]).toBe('Shrink wrap');
  });

  it('renders every line item', async () => {
    const note = loadCollectionNote(db, noteId)!;
    const buffer = await generateCollectionNotePdf(note, '/tmp/does-not-exist');
    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
    // Assert on the text actually reaching the rendered page, not just on the
    // pure helper: a regression that stops item rows from being pushed into
    // the table body must fail this test.
    const text = extractPdfText(buffer);
    expect(text).toContain('Poly cup reels');
    expect(text).toContain('Mixed paper bales');
    expect(text).toContain('Shrink wrap');
  });

  it('renders the heading, reference, and footer lines', async () => {
    const note = loadCollectionNote(db, noteId)!;
    const buffer = await generateCollectionNotePdf(note, '/tmp/does-not-exist');
    const text = extractPdfText(buffer);
    expect(text).toContain('COLLECTION NOTE');
    expect(text).toContain('SBM1061');
    expect(text).toContain('NRW Waste brokers registration CBDU027716');
    expect(text).toContain(
      'SB Materials UK LTD 1 Deva Way, Wrexham, Wales LL13 9EU Registered in Wales & England No. 10896256',
    );
  });

  it('still generates when the note has no items and no signatures', async () => {
    const cust = db.prepare('INSERT INTO customers (name) VALUES (?)').run('Bare Ltd');
    const bare = await request(app)
      .post('/api/collection-notes')
      .set('Cookie', cookie)
      .send({ reference: 'SBM2', customer_id: cust.lastInsertRowid, collection_date: '2026-08-04' })
      .expect(200);
    const res = await request(app).get(`/api/pdf/collection-note/${bare.body.id}`).set('Cookie', cookie).expect(200);
    expect(res.body.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('generates when a signature file is missing from disk', async () => {
    db.prepare('UPDATE collection_notes SET dispatched_signature_path = ? WHERE id = ?').run(
      'nope/missing.png',
      noteId,
    );
    const note = loadCollectionNote(db, noteId)!;
    const buffer = await generateCollectionNotePdf(note, '/tmp/does-not-exist');
    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('sanitises the customer name in the filename', () => {
    const note = loadCollectionNote(db, noteId)!;
    expect(collectionNotePdfFilename({ ...note, customer_name: 'A/B & Co. Ltd' })).toBe(
      'SBM1061-2026-08-03-A-B-Co-Ltd.pdf',
    );
  });

  it('falls back to the created date when there is no collection date', () => {
    const note = loadCollectionNote(db, noteId)!;
    expect(collectionNotePdfFilename({ ...note, collection_date: null })).toMatch(
      /^SBM1061-\d{4}-\d{2}-\d{2}-Acme-Recycling-Ltd\.pdf$/,
    );
  });

  it('formats dates the British way', () => {
    expect(formatUkDate('2026-08-03')).toBe('03/08/2026');
    expect(formatUkDate(null)).toBe('');
    expect(formatUkDate('not a date')).toBe('not a date');
  });
});
