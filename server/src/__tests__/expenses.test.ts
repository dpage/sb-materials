import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type Database from 'better-sqlite3';
import type { Express } from 'express';
import { createTestDb, createTestApp, loginAsAdmin, loginAsRegularUser } from './helpers';

describe('expense sheets', () => {
  let db: Database.Database;
  let app: Express;
  let cookie: string;

  beforeEach(async () => {
    db = createTestDb();
    app = createTestApp(db);
    cookie = await loginAsAdmin(app);
  });

  const openSheet = async (body: Record<string, unknown>, as = cookie) =>
    request(app).post('/api/expenses').set('Cookie', as).send(body);

  it('opens a sheet for a month, and opens the same one next time', async () => {
    const first = await openSheet({ year: 2026, month: 10 });
    expect(first.status).toBe(201);
    expect(first.body.month).toBe(10);
    expect(first.body.items).toEqual([]);

    const second = await openSheet({ year: 2026, month: 10 });
    expect(second.body.id).toBe(first.body.id);
    expect(db.prepare('SELECT COUNT(*) AS n FROM expense_sheets').get()).toEqual({ n: 1 });
  });

  it('refuses a month that is not a month', async () => {
    expect((await openSheet({ year: 2026, month: 0 })).status).toBe(400);
    expect((await openSheet({ month: 4 })).status).toBe(400);
  });

  it('saves items and splits the VAT out of the total', async () => {
    const sheet = await openSheet({ year: 2026, month: 10 });
    const saved = await request(app)
      .put(`/api/expenses/${sheet.body.id}`)
      .set('Cookie', cookie)
      .send({
        notes: 'October',
        items: [
          { item_date: '2026-10-02', description: 'Diesel', cost: 72, vat_applicable: true, vat_amount: 12 },
          { item_date: '2026-10-05', description: 'Parking', cost: 4.5, vat_applicable: false },
        ],
      });

    expect(saved.status).toBe(200);
    expect(saved.body.items).toHaveLength(2);
    expect(saved.body.notes).toBe('October');
    expect(saved.body.totals.gross).toBe(76.5);
    expect(saved.body.totals.vat).toBe(12);
    expect(saved.body.totals.net).toBe(64.5);
  });

  it('drops a VAT amount from an item marked as having no VAT', async () => {
    const sheet = await openSheet({ year: 2026, month: 10 });
    const saved = await request(app)
      .put(`/api/expenses/${sheet.body.id}`)
      .set('Cookie', cookie)
      .send({ items: [{ description: 'Stamps', cost: 12, vat_applicable: false, vat_amount: 2 }] });

    expect(saved.body.items[0].vat_amount).toBeNull();
    expect(saved.body.totals.vat).toBe(0);
  });

  it('keeps the order items were entered in', async () => {
    const sheet = await openSheet({ year: 2026, month: 10 });
    const saved = await request(app)
      .put(`/api/expenses/${sheet.body.id}`)
      .set('Cookie', cookie)
      .send({ items: [{ description: 'One' }, { description: 'Two' }, { description: 'Three' }] });

    expect(saved.body.items.map((i: { description: string }) => i.description)).toEqual(['One', 'Two', 'Three']);
  });

  it('updates the items it was given back and deletes the ones it was not', async () => {
    const sheet = await openSheet({ year: 2026, month: 10 });
    const first = await request(app)
      .put(`/api/expenses/${sheet.body.id}`)
      .set('Cookie', cookie)
      .send({
        items: [
          { description: 'Keep', cost: 10 },
          { description: 'Drop', cost: 20 },
        ],
      });

    const keepId = first.body.items[0].id;
    const second = await request(app)
      .put(`/api/expenses/${sheet.body.id}`)
      .set('Cookie', cookie)
      .send({
        items: [
          { id: keepId, description: 'Keep', cost: 15 },
          { description: 'New', cost: 5 },
        ],
      });

    expect(second.body.items).toHaveLength(2);
    // The kept row keeps its id, which is what the receipts hang off.
    expect(second.body.items[0].id).toBe(keepId);
    expect(second.body.items[0].cost).toBe(15);
    expect(second.body.items[1].description).toBe('New');
  });

  it('lists a persons sheets newest first with their totals', async () => {
    const september = await openSheet({ year: 2026, month: 9 });
    await request(app)
      .put(`/api/expenses/${september.body.id}`)
      .set('Cookie', cookie)
      .send({ items: [{ cost: 20, vat_applicable: true, vat_amount: 4 }] });
    await openSheet({ year: 2026, month: 10 });

    const list = await request(app).get('/api/expenses').set('Cookie', cookie);
    expect(list.body.map((s: { month: number }) => s.month)).toEqual([10, 9]);
    expect(list.body[1].item_count).toBe(1);
    expect(list.body[1].totals.vat).toBe(4);
  });

  it('deletes a sheet and its items', async () => {
    const sheet = await openSheet({ year: 2026, month: 10 });
    await request(app)
      .put(`/api/expenses/${sheet.body.id}`)
      .set('Cookie', cookie)
      .send({ items: [{ cost: 10 }] });

    expect((await request(app).delete(`/api/expenses/${sheet.body.id}`).set('Cookie', cookie)).status).toBe(200);
    expect(db.prepare('SELECT COUNT(*) AS n FROM expense_items').get()).toEqual({ n: 0 });
  });

  it('requires a login', async () => {
    expect((await request(app).get('/api/expenses')).status).toBe(401);
  });
});

describe('expense sheet ownership', () => {
  let db: Database.Database;
  let app: Express;
  let adminCookie: string;
  let userCookie: string;
  let adminSheetId: number;

  beforeEach(async () => {
    db = createTestDb();
    app = createTestApp(db);
    adminCookie = await loginAsAdmin(app);
    userCookie = await loginAsRegularUser(app, db);

    const sheet = await request(app).post('/api/expenses').set('Cookie', adminCookie).send({ year: 2026, month: 10 });
    adminSheetId = sheet.body.id;
  });

  it('hides another persons sheet behind a 404 rather than a 403', async () => {
    expect((await request(app).get(`/api/expenses/${adminSheetId}`).set('Cookie', userCookie)).status).toBe(404);
    expect(
      (await request(app).put(`/api/expenses/${adminSheetId}`).set('Cookie', userCookie).send({ notes: 'mine now' }))
        .status,
    ).toBe(404);
    expect((await request(app).delete(`/api/expenses/${adminSheetId}`).set('Cookie', userCookie)).status).toBe(404);
  });

  it('lists only the callers own sheets', async () => {
    await request(app).post('/api/expenses').set('Cookie', userCookie).send({ year: 2026, month: 10 });
    const mine = await request(app).get('/api/expenses').set('Cookie', userCookie);
    expect(mine.body).toHaveLength(1);
    expect(mine.body[0].id).not.toBe(adminSheetId);
  });

  it('lets a superuser read another persons sheet, and everyones at once', async () => {
    const theirs = await request(app).post('/api/expenses').set('Cookie', userCookie).send({ year: 2026, month: 10 });

    const asAdmin = await request(app).get(`/api/expenses/${theirs.body.id}`).set('Cookie', adminCookie);
    expect(asAdmin.status).toBe(200);
    expect(asAdmin.body.display_name).toBe('Regular User');

    const everyone = await request(app).get('/api/expenses?all=1').set('Cookie', adminCookie);
    expect(everyone.body).toHaveLength(2);
  });

  it('refuses a sheet for a user who does not exist', async () => {
    const created = await request(app)
      .post('/api/expenses')
      .set('Cookie', adminCookie)
      .send({ year: 2026, month: 12, user_id: 9999 });
    expect(created.status).toBe(400);
  });
});
