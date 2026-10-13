import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type Database from 'better-sqlite3';
import type { Express } from 'express';
import { createTestDb, createTestApp, loginAsAdmin, loginAsRegularUser, extractPdfText } from './helpers';
import { expenseRows, sheetPdfFilename, travelRows } from '../utils/sheet-pdf';

describe('sheet PDF rows', () => {
  it('shows the miles actually claimed, doubling a round trip', () => {
    expect(
      travelRows([
        {
          journey_date: '2026-10-12',
          job: 'Loading inspection',
          from_location: 'Wrexham',
          to_location: 'Derby',
          customer_name: 'Acme Recycling Ltd',
          miles: 86,
          round_trip: 1,
        },
        { journey_date: '2026-10-13', to_location: 'Corby', miles: 94, round_trip: 0 },
      ]),
    ).toEqual([
      ['12/10/2026', 'Loading inspection', 'Wrexham', 'Derby', 'Acme Recycling Ltd', '172', 'Yes'],
      ['13/10/2026', '', '', 'Corby', '', '94', ''],
    ]);
  });

  it('leaves the VAT column empty on an item that has none', () => {
    expect(
      expenseRows([
        { item_date: '2026-10-02', description: 'Diesel', cost: 72, vat_applicable: 1, vat_amount: 12 },
        { item_date: '2026-10-05', description: 'Parking', cost: 4.5, vat_applicable: 0, vat_amount: 1 },
      ]),
    ).toEqual([
      ['02/10/2026', 'Diesel', '£72.00', 'Yes', '£12.00'],
      ['05/10/2026', 'Parking', '£4.50', 'No', ''],
    ]);
  });

  it('names the file after the month and the person', () => {
    expect(sheetPdfFilename('travel', { id: 1, year: 2026, month: 10, display_name: 'Test User' })).toBe(
      '2026-10-Test-User-travel.pdf',
    );
    expect(sheetPdfFilename('expenses', { id: 1, year: 2026, month: 3 })).toBe('2026-03-sheet-expenses.pdf');
  });
});

describe('sheet PDF routes', () => {
  let db: Database.Database;
  let app: Express;
  let cookie: string;

  beforeEach(async () => {
    db = createTestDb();
    app = createTestApp(db);
    cookie = await loginAsAdmin(app);
  });

  it('prints a travel sheet with the mileage split spelt out', async () => {
    const earlier = await request(app).post('/api/travel').set('Cookie', cookie).send({ year: 2026, month: 9 });
    await request(app)
      .put(`/api/travel/${earlier.body.id}`)
      .set('Cookie', cookie)
      .send({ journeys: [{ miles: 9800 }] });

    const sheet = await request(app).post('/api/travel').set('Cookie', cookie).send({ year: 2026, month: 10 });
    await request(app)
      .put(`/api/travel/${sheet.body.id}`)
      .set('Cookie', cookie)
      .send({
        notes: 'Busy month',
        journeys: [{ journey_date: '2026-10-12', to_location: 'Derby', miles: 250, round_trip: true }],
      });

    const res = await request(app).get(`/api/pdf/travel/${sheet.body.id}`).set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toContain('2026-10-Administrator-travel.pdf');

    const text = extractPdfText(res.body);
    expect(text).toContain('TRAVEL & MILEAGE');
    expect(text).toContain('October 2026');
    expect(text).toContain('Derby');
    // 250 doubled, 200 of it at the higher rate and 300 at the lower.
    expect(text).toContain('Miles this month');
    expect(text).toContain('500');
    expect(text).toContain('9800');
    expect(text).toContain('£110.00');
    expect(text).toContain('£75.00');
    expect(text).toContain('£185.00');
    expect(text).toContain('Busy month');
  });

  it('prints an expense sheet with the VAT split out of the total', async () => {
    const sheet = await request(app).post('/api/expenses').set('Cookie', cookie).send({ year: 2026, month: 10 });
    await request(app)
      .put(`/api/expenses/${sheet.body.id}`)
      .set('Cookie', cookie)
      .send({
        items: [
          { item_date: '2026-10-02', description: 'Diesel', cost: 72, vat_applicable: true, vat_amount: 12 },
          { item_date: '2026-10-05', description: 'Parking', cost: 4.5, vat_applicable: false },
        ],
      });

    const res = await request(app).get(`/api/pdf/expenses/${sheet.body.id}`).set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('2026-10-Administrator-expenses.pdf');

    const text = extractPdfText(res.body);
    expect(text).toContain('EXPENSES');
    expect(text).toContain('Diesel');
    expect(text).toContain('£76.50');
    expect(text).toContain('£12.00');
    expect(text).toContain('Net of VAT');
    expect(text).toContain('£64.50');
  });

  it('prints an empty sheet rather than failing on it', async () => {
    const travel = await request(app).post('/api/travel').set('Cookie', cookie).send({ year: 2026, month: 10 });
    const expenses = await request(app).post('/api/expenses').set('Cookie', cookie).send({ year: 2026, month: 10 });

    expect((await request(app).get(`/api/pdf/travel/${travel.body.id}`).set('Cookie', cookie)).status).toBe(200);
    expect((await request(app).get(`/api/pdf/expenses/${expenses.body.id}`).set('Cookie', cookie)).status).toBe(200);
  });

  it('404s on a sheet that does not exist, and on one belonging to somebody else', async () => {
    const userCookie = await loginAsRegularUser(app, db);
    const mine = await request(app).post('/api/travel').set('Cookie', cookie).send({ year: 2026, month: 10 });
    const myExpenses = await request(app).post('/api/expenses').set('Cookie', cookie).send({ year: 2026, month: 10 });

    expect((await request(app).get('/api/pdf/travel/9999').set('Cookie', cookie)).status).toBe(404);
    expect((await request(app).get(`/api/pdf/travel/${mine.body.id}`).set('Cookie', userCookie)).status).toBe(404);
    expect((await request(app).get(`/api/pdf/expenses/${myExpenses.body.id}`).set('Cookie', userCookie)).status).toBe(
      404,
    );
  });

  it('requires a login', async () => {
    expect((await request(app).get('/api/pdf/travel/1')).status).toBe(401);
  });
});
