import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type Database from 'better-sqlite3';
import type { Express } from 'express';
import { createTestDb, createTestApp, loginAsAdmin, createTestCustomerAndSite } from './helpers';
import {
  SAMPLING_BALANCE_TOLERANCE_KG,
  formatSamplingPercent,
  isSamplingEmpty,
  samplingPercent,
  samplingTotals,
  toWeight,
} from '../utils/sampling';

describe('sampling arithmetic', () => {
  it('reads a weight from whatever the form sent', () => {
    expect(toWeight(12.5)).toBe(12.5);
    expect(toWeight('12.5')).toBe(12.5);
    expect(toWeight(' 12.5 ')).toBe(12.5);
    expect(toWeight('')).toBeNull();
    expect(toWeight(null)).toBeNull();
    expect(toWeight(undefined)).toBeNull();
    expect(toWeight('twelve')).toBeNull();
    expect(toWeight('12.')).toBe(12);
  });

  it('works out a component as a percentage of the sample size', () => {
    expect(samplingPercent(25, 100)).toBe(25);
    expect(samplingPercent(1, 3)).toBe(33.3);
    expect(samplingPercent(0, 100)).toBe(0);
  });

  it('declines to divide when there is no sample size', () => {
    expect(samplingPercent(25, null)).toBeNull();
    expect(samplingPercent(25, 0)).toBeNull();
    expect(samplingPercent(null, 100)).toBeNull();
    expect(formatSamplingPercent(25, null)).toBe('');
    expect(formatSamplingPercent(25, 100)).toBe('25.0%');
  });

  it('totals the components and reports them as a share of the sample', () => {
    const totals = samplingTotals({
      sample_size_kg: 100,
      in_scope_kg: 50,
      out_of_scope_kg: 20,
      non_packaging_kg: 10,
      contamination_kg: 15,
      prohibited_kg: 5,
    });
    expect(totals.accountedKg).toBe(100);
    expect(totals.accountedPercent).toBe(100);
    expect(totals.differenceKg).toBe(0);
    expect(totals.outOfBalance).toBe(false);
  });

  it('flags weights that do not add up to the sample size', () => {
    const totals = samplingTotals({ sample_size_kg: 100, in_scope_kg: 60, contamination_kg: 10 });
    expect(totals.accountedKg).toBe(70);
    expect(totals.differenceKg).toBe(-30);
    expect(totals.outOfBalance).toBe(true);
  });

  it('tolerates a rounding-sized discrepancy', () => {
    const within = samplingTotals({ sample_size_kg: 100, in_scope_kg: 100 + SAMPLING_BALANCE_TOLERANCE_KG });
    expect(within.outOfBalance).toBe(false);
    const beyond = samplingTotals({ sample_size_kg: 100, in_scope_kg: 100.2 });
    expect(beyond.outOfBalance).toBe(true);
  });

  it('has nothing to total when no component is filled in', () => {
    const totals = samplingTotals({ sample_size_kg: 100 });
    expect(totals.accountedKg).toBeNull();
    expect(totals.outOfBalance).toBe(false);
  });

  it('counts the non-packaging weight towards the total, like any other component', () => {
    const without = samplingTotals({ sample_size_kg: 100, in_scope_kg: 90 });
    const with_ = samplingTotals({ sample_size_kg: 100, in_scope_kg: 90, non_packaging_kg: 10 });
    expect(without.accountedKg).toBe(90);
    expect(with_.accountedKg).toBe(100);
    expect(with_.outOfBalance).toBe(false);
  });

  it('treats a block holding only a non-packaging weight, description or grade as worth keeping', () => {
    expect(isSamplingEmpty({ non_packaging_kg: 12 })).toBe(false);
    expect(isSamplingEmpty({ product_description: 'Mixed paper' })).toBe(false);
    expect(isSamplingEmpty({ product_grade: 'Grade A' })).toBe(false);
  });

  it('recognises an empty block, and one that only says sampling was skipped', () => {
    expect(isSamplingEmpty(null)).toBe(true);
    expect(isSamplingEmpty({})).toBe(true);
    expect(isSamplingEmpty({ sample_size_kg: null, comments: '' })).toBe(true);
    expect(isSamplingEmpty({ not_carried_out: 1 })).toBe(false);
    expect(isSamplingEmpty({ sample_size_kg: 10 })).toBe(false);
  });
});

describe('sampling through the reports API', () => {
  let db: Database.Database;
  let app: Express;
  let cookie: string;
  let customerId: number;
  let siteId: number;

  beforeEach(async () => {
    db = createTestDb();
    app = createTestApp(db);
    cookie = await loginAsAdmin(app);
    const created = createTestCustomerAndSite(db);
    customerId = created.customerId;
    siteId = created.siteId;
  });

  const sampling = {
    sample_size_kg: 500,
    in_scope_kg: 420,
    out_of_scope_kg: 30,
    non_packaging_kg: 20,
    contamination_kg: 25,
    prohibited_kg: 5,
    prohibited_items: 'Aerosol can',
    product_description: 'Mixed paper',
    product_grade: 'Grade A',
    pern_prn_claimed_percent: 95,
    contamination_limit_percent: 4,
    comments: 'Bale broken in the yard',
  };

  function reportBody(report_type: string, overrides: any = {}) {
    return {
      report_type,
      customer_id: customerId,
      site_id: siteId,
      inspection_date: '2026-10-13',
      inspector_name: 'Test Inspector',
      sampling,
      ...overrides,
    };
  }

  it.each(['loading_inspection', 'quarterly_pern', 'pern_audit', 'loading_quarterly_pern', 'sampling'])(
    'stores and returns the sampling block for a %s report',
    async (type) => {
      const created = await request(app).post('/api/reports').set('Cookie', cookie).send(reportBody(type));
      expect(created.status).toBe(200);

      const fetched = await request(app).get(`/api/reports/${created.body.id}`).set('Cookie', cookie);
      expect(fetched.status).toBe(200);
      expect(fetched.body.sampling).toMatchObject({
        sample_size_kg: 500,
        in_scope_kg: 420,
        non_packaging_kg: 20,
        product_description: 'Mixed paper',
        product_grade: 'Grade A',
        prohibited_items: 'Aerosol can',
        pern_prn_claimed_percent: 95,
        contamination_limit_percent: 4,
        comments: 'Bale broken in the yard',
      });
    },
  );

  it('coerces the weights the form sends as strings, and stores nonsense as absent', async () => {
    const created = await request(app)
      .post('/api/reports')
      .set('Cookie', cookie)
      .send(
        reportBody('sampling', { sampling: { sample_size_kg: '250.5', in_scope_kg: '', contamination_kg: 'n/a' } }),
      );

    const fetched = await request(app).get(`/api/reports/${created.body.id}`).set('Cookie', cookie);
    expect(fetched.body.sampling.sample_size_kg).toBe(250.5);
    expect(fetched.body.sampling.in_scope_kg).toBeNull();
    expect(fetched.body.sampling.contamination_kg).toBeNull();
  });

  it('records that sampling was not carried out, and why', async () => {
    const created = await request(app)
      .post('/api/reports')
      .set('Cookie', cookie)
      .send(
        reportBody('loading_inspection', {
          sampling: { not_carried_out: true, not_carried_out_reason: 'Area unsafe' },
        }),
      );

    const fetched = await request(app).get(`/api/reports/${created.body.id}`).set('Cookie', cookie);
    expect(fetched.body.sampling.not_carried_out).toBe(1);
    expect(fetched.body.sampling.not_carried_out_reason).toBe('Area unsafe');
  });

  it('leaves no row behind when no sampling was entered', async () => {
    const created = await request(app)
      .post('/api/reports')
      .set('Cookie', cookie)
      .send(reportBody('loading_inspection', { sampling: {} }));

    const fetched = await request(app).get(`/api/reports/${created.body.id}`).set('Cookie', cookie);
    expect(fetched.body.sampling).toBeNull();
  });

  it('replaces the block on update, and clears it when it is emptied', async () => {
    const created = await request(app).post('/api/reports').set('Cookie', cookie).send(reportBody('quarterly_pern'));
    const id = created.body.id;

    const updated = await request(app)
      .put(`/api/reports/${id}`)
      .set('Cookie', cookie)
      .send({ sampling: { ...sampling, sample_size_kg: 600, comments: 'Re-weighed' } });
    expect(updated.status).toBe(200);

    let fetched = await request(app).get(`/api/reports/${id}`).set('Cookie', cookie);
    expect(fetched.body.sampling.sample_size_kg).toBe(600);
    expect(fetched.body.sampling.comments).toBe('Re-weighed');

    await request(app).put(`/api/reports/${id}`).set('Cookie', cookie).send({ sampling: {} });
    fetched = await request(app).get(`/api/reports/${id}`).set('Cookie', cookie);
    expect(fetched.body.sampling).toBeNull();
    expect(db.prepare('SELECT COUNT(*) AS n FROM report_sampling WHERE report_id = ?').get(id)).toEqual({ n: 0 });
  });

  it('keeps the inspection sections for the combined loading and quarterly type', async () => {
    const created = await request(app)
      .post('/api/reports')
      .set('Cookie', cookie)
      .send(
        reportBody('loading_quarterly_pern', {
          inspection_details: { product_grade: 'OCC', loading_reference: 'LR-1' },
          unwanted_materials: [{ material: 'Cores' }],
          contaminants: [{ contaminant: 'Metal' }],
          containers: [{ container_number: 'C1', seal_number: 'S1' }],
        }),
      );

    const fetched = await request(app).get(`/api/reports/${created.body.id}`).set('Cookie', cookie);
    expect(fetched.body.inspection_details.product_grade).toBe('OCC');
    expect(fetched.body.inspection_details.loading_reference).toBe('LR-1');
    expect(fetched.body.unwanted_materials).toHaveLength(1);
    expect(fetched.body.contaminants).toHaveLength(1);
    expect(fetched.body.containers).toHaveLength(1);
  });

  it('stores the material description and grade on a PERN audit', async () => {
    const created = await request(app)
      .post('/api/reports')
      .set('Cookie', cookie)
      .send(
        reportBody('pern_audit', {
          pern_details: { company_name_address: 'Test Co', product_description: 'Baled OCC', product_grade: 'Grade A' },
        }),
      );

    const fetched = await request(app).get(`/api/reports/${created.body.id}`).set('Cookie', cookie);
    expect(fetched.body.pern_details.product_description).toBe('Baled OCC');
    expect(fetched.body.pern_details.product_grade).toBe('Grade A');
  });
});
