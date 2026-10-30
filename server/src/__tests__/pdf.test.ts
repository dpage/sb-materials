import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type Database from 'better-sqlite3';
import type { Express } from 'express';
import { createTestDb, createTestApp, loginAsAdmin, createTestCustomerAndSite, extractPdfText } from './helpers';
import { generatePdf } from '../utils/pdf-generator';
import { SB_LOGO_DATA_URL } from '../utils/logo';
import { deploymentWatermark } from '../utils/watermark';
import { loadCollectionNote } from '../utils/collection-note-loader';
import {
  generateCollectionNotePdf,
  collectionNotePdfFilename,
  collectionNoteItemRows,
  containerLine,
  itemDetailLine,
  formatUkDate,
  HEADER_CELLS,
} from '../utils/collection-note-pdf';
import os from 'os';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import crypto from 'crypto';
import zlib from 'zlib';

// Count `/Ixx Do` image-draw operators across every page content stream, and
// the pages themselves. pdfkit writes an image XObject as soon as it is
// measured, whether or not it ends up drawn, so the object table is no guide
// to what is actually visible; the draw operators are. Every page draws the
// letterhead logo once, so `drawn - pages` is the number of report images that
// made it onto a page.
// How many report images each page paints, in page order. pdfkit writes an
// image XObject as soon as it is measured, whether or not it ever ends up
// drawn, so the object table is no guide to what is actually visible; the
// `/Ixx Do` draw operators in the page content streams are. Every page paints
// the letterhead logo exactly once, which both identifies a page content
// stream (fonts and images inflate to something with no draw operators in it)
// and accounts for the one draw that is not a report photo.
function photosDrawnPerPage(buf: Buffer): number[] {
  const perPage: number[] = [];
  let idx = 0;
  while ((idx = buf.indexOf('stream', idx)) !== -1) {
    const start = buf.indexOf('\n', idx) + 1;
    const end = buf.indexOf('endstream', start);
    if (end === -1) break;
    try {
      const content = zlib.inflateSync(buf.subarray(start, end)).toString('latin1');
      const draws = (content.match(/\/I\d+\s+Do/g) || []).length;
      if (draws > 0) perPage.push(draws - 1);
    } catch {
      // not a deflate stream (e.g. an image) - skip
    }
    idx = end + 'endstream'.length;
  }
  return perPage;
}

// Count the image XObjects the PDF actually contains. Unlike the draw
// operators, this counts each embedded image once however many times it is
// painted, which is what tells us whether the letterhead is being shared
// across pages or re-embedded on every one of them. A PNG with transparency
// costs two XObjects (the image and its soft mask); a JPEG costs one.
function countImageXObjects(buf: Buffer): number {
  return (buf.toString('latin1').match(/\/Subtype\s*\/Image/g) || []).length;
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

  it('embeds tall portrait photos rather than dropping them onto blank pages', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-pdf-'));
    const photoDir = path.join(tmpDir, '1');
    fs.mkdirSync(photoDir, { recursive: true });

    // Aspect ratios a phone actually produces: a long weighbridge ticket
    // photographed end to end, a tall modern phone screenshot, a 16:9
    // screenshot, and a normal 4:3 photo. Scaled to a fixed 400pt width, all
    // but the last are taller than the printable area of an A4 page. The
    // tallest comes first deliberately, so that the photo sharing a page with
    // the "Photos" section heading is the one least able to afford the room.
    const shapes: [number, number][] = [
      [1000, 3000],
      [1080, 2340],
      [1080, 1920],
      [3000, 4000],
    ];

    const photos = [];
    for (const [w, h] of shapes) {
      const name = `${w}x${h}.jpg`;
      await sharp({ create: { width: w, height: h, channels: 3, background: { r: 30, g: 140, b: 200 } } })
        .jpeg()
        .toFile(path.join(photoDir, name));
      photos.push({ file_path: `1/${name}`, photo_label: `${w}x${h}`, container_id: null });
    }

    const report = {
      id: 1,
      report_type: 'quarterly_pern',
      customer_name: 'Test',
      site_address: 'Test',
      inspection_date: '2026-08-05',
      inspector_name: 'Test',
      status: 'completed',
      inspection_details: { product_grade: 'OCC' },
      unwanted_materials: [],
      contaminants: [],
      containers: [],
      photos,
    };

    const buffer = await generatePdf(report as any, tmpDir);

    // A page of report details, and then exactly one photo on each page that
    // follows. A photo that could not be placed would show up here twice over:
    // as a missing photo, and as a page carrying none.
    expect(photosDrawnPerPage(buffer)).toEqual([0, ...shapes.map(() => 1)]);

    // The caption travels in the same unbreakable block as the photo, so a
    // dropped photo takes its label with it.
    const text = extractPdfText(buffer);
    for (const [w, h] of shapes) {
      expect(text).toContain(`${w}x${h}`);
    }

    fs.rmSync(tmpDir, { recursive: true });
  });

  it('embeds the letterhead logo once, not once per page', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-pdf-'));
    const photoDir = path.join(tmpDir, '1');
    fs.mkdirSync(photoDir, { recursive: true });

    // Six photos is enough to run the report well past half a dozen pages,
    // since each one takes a page of its own.
    const photos = [];
    for (let i = 0; i < 6; i++) {
      const name = `p${i}.jpg`;
      await sharp({ create: { width: 1200, height: 1600, channels: 3, background: { r: 200, g: 60, b: 40 } } })
        .jpeg()
        .toFile(path.join(photoDir, name));
      photos.push({ file_path: `1/${name}`, photo_label: `Photo ${i}`, container_id: null });
    }

    const report = {
      id: 1,
      report_type: 'quarterly_pern',
      customer_name: 'Test',
      site_address: 'Test',
      inspection_date: '2026-08-05',
      inspector_name: 'Test',
      status: 'completed',
      inspection_details: { product_grade: 'OCC' },
      unwanted_materials: [],
      contaminants: [],
      containers: [],
      photos,
    };

    const buffer = await generatePdf(report as any, tmpDir);

    expect(photosDrawnPerPage(buffer).length).toBeGreaterThan(6);

    // Two XObjects for the logo (it is a PNG with an alpha channel) plus one
    // per JPEG photo. Re-embedding the logo would make this scale with the
    // page count instead.
    expect(countImageXObjects(buffer)).toBe(2 + photos.length);

    fs.rmSync(tmpDir, { recursive: true });
  });

  it('keeps the embedded logo small enough not to bloat every report', () => {
    // The logo is only ever drawn 140pt wide, so it needs a few hundred pixels
    // across, not a few thousand. Regenerate it with `npm run logo:generate`
    // if this ever fails after the artwork is replaced.
    expect(SB_LOGO_DATA_URL.length).toBeLessThan(60_000);
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
        buyer_reference: 'BR-1',
        minimum_weight: '22t',
        collection_date: '2026-08-03',
        transport_company: 'Test Haulage',
        items: [
          {
            quantity: '1x',
            description: 'Poly cup reels',
            nett_weight: '1250',
            reference: 'REF-1',
            vehicle_registration: 'AB12 CDE',
          },
          {
            quantity: '2x',
            description: 'Mixed paper bales',
            nett_weight: '980',
            reference: 'REF-2',
            vehicle_registration: 'FG34 HIJ',
            is_container: 1,
            container_number: 'ABCU1234567',
            seal_number: 'SEAL-9',
          },
          { quantity: '3x', description: 'Shrink wrap', nett_weight: '640', reference: 'REF-3' },
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
    expect(rows[2][2]).toBe('640');
    expect(rows[2][3]).toBe('REF-3');
    expect(rows[0][4]).toBe('AB12 CDE');
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
    expect(text).toContain('REF-2');
    expect(text).toContain('AB12 CDE');
  });

  it('prints the container and seal beneath the line they belong to', async () => {
    const note = loadCollectionNote(db, noteId)!;
    const text = extractPdfText(await generateCollectionNotePdf(note, '/tmp/does-not-exist'));
    expect(text).toContain('Container ABCU1234567');
    expect(text).toContain('Seal SEAL-9');
    // The line that is not containerised gets no stray heading of its own.
    expect(containerLine({ is_container: 0, container_number: 'X', seal_number: 'Y' })).toBe('');
    expect(containerLine({ is_container: 1, container_number: 'ABCU1', seal_number: null })).toBe('Container ABCU1');
  });

  it("prints each line's own reference beneath its description", async () => {
    const note = loadCollectionNote(db, noteId)!;
    const text = extractPdfText(await generateCollectionNotePdf(note, '/tmp/does-not-exist'));
    expect(text).toContain(note.items[0].line_reference!);
    expect(itemDetailLine({ line_reference: 'SBM1061-1' })).toBe('SBM1061-1');
    expect(itemDetailLine({ line_reference: 'SBM1061-1', is_container: 1, container_number: 'ABCU1' })).toBe(
      'SBM1061-1  Container ABCU1',
    );
  });

  it('no longer prints a collection point column', async () => {
    const note = loadCollectionNote(db, noteId)!;
    const text = extractPdfText(await generateCollectionNotePdf(note, '/tmp/does-not-exist'));
    expect(text).not.toContain('COLLECTION POINT');
    expect(text).toContain('VEHICLE REG');
  });

  it('never prints the sale: the note travels with the load', async () => {
    db.prepare('UPDATE collection_notes SET buyer = ?, buy_price = ?, sale_price = ? WHERE id = ?').run(
      'Test Buyer',
      100,
      150,
      noteId,
    );
    const note = loadCollectionNote(db, noteId)!;
    const text = extractPdfText(await generateCollectionNotePdf(note, '/tmp/does-not-exist'));
    expect(text).not.toContain('Test Buyer');
    expect(text).not.toContain('150');
    expect(text).not.toMatch(/SALE PRICE|BUY PRICE/i);
  });

  it('renders the heading, reference, and footer lines', async () => {
    const note = loadCollectionNote(db, noteId)!;
    const buffer = await generateCollectionNotePdf(note, '/tmp/does-not-exist');
    const text = extractPdfText(buffer);
    expect(text).toContain('COLLECTION NOTE');
    expect(text).toContain('SBM1061');
    expect(text).toContain('BUYER REFERENCE');
    expect(text).toContain('MINIMUM WEIGHT TO BE LOADED');
    // The bare "WEIGHT" column that sat beside the minimum is gone. Asserted on
    // the columns rather than the rendered text, which still legitimately
    // mentions a weight twice over.
    expect(HEADER_CELLS).not.toContain('WEIGHT');
    expect(HEADER_CELLS).toHaveLength(5);
    expect(text).toContain('NETT WEIGHT (KG)');
    expect(text).toContain('Goods Dispatched');
    // Goods are never signed for on the returning copy, so that row is gone.
    expect(text).not.toContain('Goods Received');
    expect(text).not.toContain('PO NUMBER');
    expect(text).not.toContain('PACKING LIST');
    expect(text).toContain('NRW Waste brokers registration CBDU027716');
    expect(text).toContain(
      'SB Materials UK LTD 1 Deva Way, Wrexham, Wales LL13 9EU Registered in Wales & England No. 10896256',
    );
  });

  it('gives the transport company a row of its own rather than an item row', async () => {
    const note = loadCollectionNote(db, noteId)!;
    const buffer = await generateCollectionNotePdf(note, '/tmp/does-not-exist');
    const text = extractPdfText(buffer);
    expect(text).toContain('Transport Company');
    expect(text).toContain('Test Haulage');
    // It belongs to the collection, not to any line item, so it must never be
    // one of the rows collectionNoteItemRows() produces.
    expect(collectionNoteItemRows(note).flat()).not.toContain('Test Haulage');
  });

  it('carries the letterhead logo', async () => {
    const note = loadCollectionNote(db, noteId)!;
    const buffer = await generateCollectionNotePdf(note, '/tmp/does-not-exist');
    // The logo is a PNG with an alpha channel, so it costs two XObjects: the
    // image and its soft mask.
    expect(countImageXObjects(buffer)).toBe(2);
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

  it('sanitises the reference in the filename', () => {
    // The reference is hand-typed, so a stray quote or slash must not break
    // the quoted Content-Disposition header the filename is interpolated
    // into.
    const note = loadCollectionNote(db, noteId)!;
    expect(collectionNotePdfFilename({ ...note, reference: 'SBM/1061"' })).toBe(
      'SBM-1061-2026-08-03-Acme-Recycling-Ltd.pdf',
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
    expect(formatUkDate('2026-08-03T14:30')).toBe('03/08/2026 14:30');
    expect(formatUkDate(null)).toBe('');
    expect(formatUkDate('not a date')).toBe('not a date');
  });
});

describe('test deployment watermark', () => {
  let tmpDir: string;
  let db: Database.Database;
  let noteId: number;

  const report = {
    id: 1,
    report_type: 'quarterly_pern',
    status: 'completed',
    customer_name: 'Cust',
    site_address: 'Addr',
    inspection_date: '2026-05-02',
    inspector_name: 'Insp',
    inspection_details: {},
    unwanted_materials: [],
    contaminants: [],
    containers: [],
    photos: [],
  };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-pdf-watermark-'));
    db = createTestDb();
    const cust = db.prepare('INSERT INTO customers (name) VALUES (?)').run('Acme Recycling Ltd');
    const info = db
      .prepare('INSERT INTO collection_notes (reference, customer_id, collection_date) VALUES (?, ?, ?)')
      .run('SBM2001', cust.lastInsertRowid, '2026-08-03');
    noteId = Number(info.lastInsertRowid);
  });

  it('stamps the label across a report when one is supplied', async () => {
    const buffer = await generatePdf(report as any, tmpDir, { watermark: deploymentWatermark('PRE-PROD') });
    expect(extractPdfText(buffer)).toContain('PRE-PROD');
  });

  it('leaves a report unmarked when no watermark is supplied', async () => {
    const buffer = await generatePdf(report as any, tmpDir);
    expect(extractPdfText(buffer)).not.toContain('PRE-PROD');
  });

  it('stamps the label across a collection note when one is supplied', async () => {
    const note = loadCollectionNote(db, noteId)!;
    const buffer = await generateCollectionNotePdf(note, tmpDir, { watermark: deploymentWatermark('PRE-PROD') });
    expect(extractPdfText(buffer)).toContain('PRE-PROD');
  });

  it('leaves a collection note unmarked when no watermark is supplied', async () => {
    const note = loadCollectionNote(db, noteId)!;
    const buffer = await generateCollectionNotePdf(note, tmpDir);
    expect(extractPdfText(buffer)).not.toContain('PRE-PROD');
  });
});

describe('sampling section', () => {
  let tmpDir: string;

  const sampling = {
    sample_size_kg: 500,
    in_scope_kg: 440,
    out_of_scope_kg: 30,
    contamination_kg: 25,
    prohibited_kg: 5,
    prohibited_items: 'Aerosol can',
    pern_prn_claimed_percent: 95,
    contamination_limit_percent: 4,
    comments: 'Bale broken in the yard',
  };

  function reportFor(reportType: string, overrides: any = {}) {
    return {
      id: 7,
      report_type: reportType,
      customer_name: 'Acme Recycling Ltd',
      site_address: '1 Example Way',
      inspection_date: '2026-10-13',
      inspector_name: 'Insp',
      inspection_details: {},
      pern_details: {},
      unwanted_materials: [],
      contaminants: [],
      containers: [],
      photos: [],
      sampling,
      ...overrides,
    };
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-pdf-sampling-'));
  });

  it.each(['loading_inspection', 'quarterly_pern', 'pern_audit', 'loading_quarterly_pern', 'sampling'])(
    'prints the weights and their percentages on a %s report',
    async (reportType) => {
      const text = extractPdfText(await generatePdf(reportFor(reportType) as any, tmpDir));
      expect(text).toContain('Sampling');
      expect(text).toContain('Sample Size');
      expect(text).toContain('500 kg');
      expect(text).toContain('Post Consumer Packaging In Scope');
      expect(text).toContain('88.0%');
      expect(text).toContain('Post Consumer Packaging NOT In Scope');
      expect(text).toContain('Prohibited Items');
      expect(text).toContain('Total Accounted For');
      expect(text).toContain('PERN/PRN % Claimed');
      expect(text).toContain('Contamination Maximum Limit %');
      expect(text).toContain('Bale broken in the yard');
      expect(text).toContain('Aerosol can');
    },
  );

  it('prints the reason instead of the figures when sampling was not carried out', async () => {
    const text = extractPdfText(
      await generatePdf(
        reportFor('quarterly_pern', {
          sampling: { not_carried_out: 1, not_carried_out_reason: 'Area unsafe' },
        }) as any,
        tmpDir,
      ),
    );
    expect(text).toContain('Sampling not carried out');
    expect(text).toContain('Area unsafe');
    expect(text).not.toContain('Total Accounted For');
  });

  it('prints nothing at all when a report has no sampling', async () => {
    const text = extractPdfText(await generatePdf(reportFor('quarterly_pern', { sampling: null }) as any, tmpDir));
    expect(text).not.toContain('Sample Size');
  });

  it('no longer prints bale break fields on a new report, but still does on an old one', async () => {
    const fresh = extractPdfText(await generatePdf(reportFor('quarterly_pern') as any, tmpDir));
    expect(fresh).not.toContain('Bale Break');

    const legacy = extractPdfText(
      await generatePdf(
        reportFor('quarterly_pern', {
          inspection_details: { bale_break: 1, bale_break_results: '5% contamination' },
        }) as any,
        tmpDir,
      ),
    );
    expect(legacy).toContain('Bale Break Results');
    expect(legacy).toContain('5% contamination');
  });

  it('prints the loading and quarterly sections together on the combined report', async () => {
    const text = extractPdfText(
      await generatePdf(
        reportFor('loading_quarterly_pern', {
          inspection_details: { loading_reference: 'LR-1', product_description: 'Baled OCC', stock_bale_count: '50' },
          unwanted_materials: [{ material: 'Cores' }],
        }) as any,
        tmpDir,
      ),
    );
    expect(text).toContain('Loading & Quarterly PERN Inspection');
    expect(text).toContain('Time Of Inspection / First Loading');
    expect(text).toContain('Loading Reference Number');
    expect(text).toContain('Stock & Bale Count');
    expect(text).toContain('Unwanted Materials');
    expect(text).toContain('Compliance');
    expect(text).toContain('Sampling');
  });

  it('prints the material description and grade on a PERN audit', async () => {
    const text = extractPdfText(
      await generatePdf(
        reportFor('pern_audit', {
          pern_details: { product_description: 'Baled OCC', product_grade: 'Grade A' },
        }) as any,
        tmpDir,
      ),
    );
    expect(text).toContain('Material Description');
    expect(text).toContain('Baled OCC');
    expect(text).toContain('Material Grade');
    expect(text).toContain('Grade A');
    expect(text).not.toContain('Bale Split Results');
  });

  it('prints the pass or fail verdict and the prohibited items note', async () => {
    const text = extractPdfText(
      await generatePdf(reportFor('sampling', { sampling: { ...sampling, result: 'FAIL' } }) as any, tmpDir),
    );
    expect(text).toContain('Sampling Result');
    expect(text).toContain('FAIL');
    expect(text).toContain('0% limit: if prohibited items are found, please call the trader.');
  });

  it('prints the prohibited items note even when none were found', async () => {
    const text = extractPdfText(
      await generatePdf(reportFor('sampling', { sampling: { ...sampling, prohibited_items: null } }) as any, tmpDir),
    );
    expect(text).toContain('Prohibited Items Found');
    expect(text).toContain('None');
    expect(text).toContain('0% limit: if prohibited items are found, please call the trader.');
  });

  it('drops the results and follow-up boxes from the PERN audit, keeping the notes', async () => {
    const text = extractPdfText(
      await generatePdf(
        reportFor('pern_audit', {
          pern_details: {
            bale_split_results: '50/50',
            quality_discussion: 'Discussed standards',
            follow_up: 'None required',
            notes: 'All satisfactory',
          },
        }) as any,
        tmpDir,
      ),
    );
    expect(text).toContain('Notes');
    expect(text).toContain('All satisfactory');
    // Removed at Stew's request; the columns survive on old databases unread.
    expect(text).not.toContain('Bale Split Results');
    expect(text).not.toContain('Quality Discussion');
    expect(text).not.toContain('Follow Up');
    expect(text).not.toContain('50/50');
  });

  it('labels the PERN audit address block Supplier & Address', async () => {
    const text = extractPdfText(
      await generatePdf(
        reportFor('pern_audit', { pern_details: { company_name_address: 'Acme Recycling Ltd' } }) as any,
        tmpDir,
      ),
    );
    expect(text).toContain('Supplier & Address');
    expect(text).not.toContain('Company Name & Address');
  });

  it('prints the moisture high and low readings on the PERN audit', async () => {
    const text = extractPdfText(
      await generatePdf(
        reportFor('pern_audit', {
          pern_details: { moisture_reading_low: '8%', moisture_reading_high: '12%' },
        }) as any,
        tmpDir,
      ),
    );
    expect(text).toContain('Moisture Reading Low');
    expect(text).toContain('8%');
    expect(text).toContain('Moisture Reading High');
    expect(text).toContain('12%');
  });

  it('signs every report type with the name and position of the signatory', async () => {
    for (const type of ['loading_inspection', 'quarterly_pern', 'pern_audit', 'sampling'] as const) {
      const text = extractPdfText(
        await generatePdf(
          reportFor(type, { inspector_name: 'Test User', inspector_position: 'Senior Inspector' }) as any,
          tmpDir,
        ),
      );
      expect(text, type).toContain('Name: Test User');
      expect(text, type).toContain('Position: Senior Inspector');
    }
  });

  it('no longer prints the packaging content checks', async () => {
    const text = extractPdfText(
      await generatePdf(
        reportFor('quarterly_pern', {
          inspection_details: { packaging_thresholds: JSON.stringify(['OCC exceeds 97.5%']) },
        }) as any,
        tmpDir,
      ),
    );
    expect(text).not.toContain('Packaging Content');
    expect(text).not.toContain('OCC exceeds 97.5%');
  });

  it('prints the loading reference and the client on the standalone sampling report', async () => {
    const text = extractPdfText(
      await generatePdf(
        reportFor('sampling', {
          on_behalf_of: 'Visy',
          sampling: { ...sampling, loading_reference: 'LOAD-123' },
        }) as any,
        tmpDir,
      ),
    );
    expect(text).toContain('Loading Reference Number');
    expect(text).toContain('LOAD-123');
    expect(text).toContain('On Behalf Of');
    expect(text).toContain('Visy');
  });

  it('leaves the loading reference out of the sampling header when there is none', async () => {
    const text = extractPdfText(await generatePdf(reportFor('sampling') as any, tmpDir));
    expect(text).not.toContain('Loading Reference Number');
  });

  it('renders the standalone sampling report as the header, the block and the notes', async () => {
    const text = extractPdfText(
      await generatePdf(reportFor('sampling', { other_information: 'Yard was busy' }) as any, tmpDir),
    );
    expect(text).toContain('Sampling Report');
    expect(text).toContain('Date of Sampling');
    expect(text).toContain('Acme Recycling Ltd');
    expect(text).toContain('Yard was busy');
    expect(text).toContain('Signature');
    expect(text).not.toContain('Compliance');
    expect(text).not.toContain('Unwanted Materials');
  });
});
