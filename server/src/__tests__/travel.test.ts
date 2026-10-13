import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type Database from 'better-sqlite3';
import type { Express } from 'express';
import { createTestDb, createTestApp, loginAsAdmin, loginAsRegularUser, createTestCustomerAndSite } from './helpers';

describe('travel sheets', () => {
  let db: Database.Database;
  let app: Express;
  let cookie: string;

  beforeEach(async () => {
    db = createTestDb();
    app = createTestApp(db);
    cookie = await loginAsAdmin(app);
  });

  const openSheet = async (body: Record<string, unknown>, as = cookie) =>
    request(app).post('/api/travel').set('Cookie', as).send(body);

  it('opens a sheet for a month, and opens the same one next time', async () => {
    const first = await openSheet({ year: 2026, month: 10 });
    expect(first.status).toBe(201);
    expect(first.body.year).toBe(2026);
    expect(first.body.month).toBe(10);

    const second = await openSheet({ year: 2026, month: 10 });
    expect(second.body.id).toBe(first.body.id);
    expect(db.prepare('SELECT COUNT(*) AS n FROM travel_sheets').get()).toEqual({ n: 1 });
  });

  it('refuses a month that is not a month', async () => {
    expect((await openSheet({ year: 2026, month: 13 })).status).toBe(400);
    expect((await openSheet({ year: 2026 })).status).toBe(400);
    expect((await openSheet({ year: 1066, month: 10 })).status).toBe(400);
  });

  it('saves a day of legs and totals the mileage and the money', async () => {
    const { customerId } = createTestCustomerAndSite(db);
    const sheet = await openSheet({ year: 2026, month: 10 });

    const saved = await request(app)
      .put(`/api/travel/${sheet.body.id}`)
      .set('Cookie', cookie)
      .send({
        notes: 'Monday to Friday',
        journeys: [
          {
            journey_date: '2026-10-12',
            customer_id: customerId,
            customer_name: 'Acme Recycling Ltd',
            job: 'Loading inspection',
            from_location: 'Wrexham',
            to_location: 'Derby',
            miles: 86,
            round_trip: true,
          },
          {
            journey_date: '2026-10-13',
            from_location: 'Wrexham',
            to_location: 'West Bromwich',
            miles: 94,
            round_trip: false,
          },
        ],
      });

    expect(saved.status).toBe(200);
    expect(saved.body.journeys).toHaveLength(2);
    expect(saved.body.journeys[0].round_trip).toBe(1);
    expect(saved.body.journeys[0].customer_name).toBe('Acme Recycling Ltd');
    // 86 doubled for the round trip, plus 94.
    expect(saved.body.totals.miles).toBe(266);
    expect(saved.body.totals.highMiles).toBe(266);
    expect(saved.body.totals.total).toBe(146.3);
  });

  it('keeps the order the legs were entered in', async () => {
    const sheet = await openSheet({ year: 2026, month: 10 });
    await request(app)
      .put(`/api/travel/${sheet.body.id}`)
      .set('Cookie', cookie)
      .send({ journeys: [{ to_location: 'Corby' }, { to_location: 'Swindon' }, { to_location: 'Cardiff' }] });

    const read = await request(app).get(`/api/travel/${sheet.body.id}`).set('Cookie', cookie);
    expect(read.body.journeys.map((j: { to_location: string }) => j.to_location)).toEqual([
      'Corby',
      'Swindon',
      'Cardiff',
    ]);
  });

  it('replaces the journey list wholesale on save', async () => {
    const sheet = await openSheet({ year: 2026, month: 10 });
    await request(app)
      .put(`/api/travel/${sheet.body.id}`)
      .set('Cookie', cookie)
      .send({ journeys: [{ miles: 10 }, { miles: 20 }] });

    const second = await request(app)
      .put(`/api/travel/${sheet.body.id}`)
      .set('Cookie', cookie)
      .send({ journeys: [{ miles: 5 }] });

    expect(second.body.journeys).toHaveLength(1);
    expect(second.body.totals.miles).toBe(5);
  });

  it('prices against the miles already claimed earlier in the tax year', async () => {
    const earlier = await openSheet({ year: 2026, month: 9 });
    await request(app)
      .put(`/api/travel/${earlier.body.id}`)
      .set('Cookie', cookie)
      .send({ journeys: [{ miles: 9800 }] });

    const current = await openSheet({ year: 2026, month: 10 });
    const saved = await request(app)
      .put(`/api/travel/${current.body.id}`)
      .set('Cookie', cookie)
      .send({ journeys: [{ miles: 500 }] });

    expect(saved.body.totals.milesBroughtForward).toBe(9800);
    expect(saved.body.totals.highMiles).toBe(200);
    expect(saved.body.totals.lowMiles).toBe(300);
    expect(saved.body.totals.total).toBe(185);
  });

  it('lists a persons sheets newest first with their totals', async () => {
    const september = await openSheet({ year: 2026, month: 9 });
    await request(app)
      .put(`/api/travel/${september.body.id}`)
      .set('Cookie', cookie)
      .send({ journeys: [{ miles: 100 }] });
    await openSheet({ year: 2026, month: 10 });

    const list = await request(app).get('/api/travel').set('Cookie', cookie);
    expect(list.body.map((s: { month: number }) => s.month)).toEqual([10, 9]);
    expect(list.body[1].journey_count).toBe(1);
    expect(list.body[1].totals.total).toBe(55);
  });

  it('deletes a sheet and its journeys', async () => {
    const sheet = await openSheet({ year: 2026, month: 10 });
    await request(app)
      .put(`/api/travel/${sheet.body.id}`)
      .set('Cookie', cookie)
      .send({ journeys: [{ miles: 10 }] });

    expect((await request(app).delete(`/api/travel/${sheet.body.id}`).set('Cookie', cookie)).status).toBe(200);
    expect(db.prepare('SELECT COUNT(*) AS n FROM travel_journeys').get()).toEqual({ n: 0 });
  });

  it('requires a login', async () => {
    expect((await request(app).get('/api/travel')).status).toBe(401);
  });
});

describe('travel sheet ownership', () => {
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

    const sheet = await request(app).post('/api/travel').set('Cookie', adminCookie).send({ year: 2026, month: 10 });
    adminSheetId = sheet.body.id;
  });

  it('hides another persons sheet behind a 404 rather than a 403', async () => {
    // 404 deliberately: a 403 would confirm that the admin has an October
    // sheet to somebody with no business knowing it.
    expect((await request(app).get(`/api/travel/${adminSheetId}`).set('Cookie', userCookie)).status).toBe(404);
    expect(
      (await request(app).put(`/api/travel/${adminSheetId}`).set('Cookie', userCookie).send({ notes: 'mine now' }))
        .status,
    ).toBe(404);
    expect((await request(app).delete(`/api/travel/${adminSheetId}`).set('Cookie', userCookie)).status).toBe(404);
  });

  it('lists only the callers own sheets', async () => {
    await request(app).post('/api/travel').set('Cookie', userCookie).send({ year: 2026, month: 10 });

    const mine = await request(app).get('/api/travel').set('Cookie', userCookie);
    expect(mine.body).toHaveLength(1);
    expect(mine.body[0].id).not.toBe(adminSheetId);
  });

  it('ignores a user_id a regular user asks for, on both create and list', async () => {
    const created = await request(app)
      .post('/api/travel')
      .set('Cookie', userCookie)
      .send({ year: 2026, month: 11, user_id: 1 });
    expect(created.body.user_id).not.toBe(1);

    const list = await request(app).get('/api/travel?user_id=1').set('Cookie', userCookie);
    expect(list.body.every((s: { user_id: number }) => s.user_id !== 1)).toBe(true);
  });

  it('lets a superuser read another persons sheet, and everyones at once', async () => {
    const theirs = await request(app).post('/api/travel').set('Cookie', userCookie).send({ year: 2026, month: 10 });

    const asAdmin = await request(app).get(`/api/travel/${theirs.body.id}`).set('Cookie', adminCookie);
    expect(asAdmin.status).toBe(200);
    expect(asAdmin.body.display_name).toBe('Regular User');

    const filtered = await request(app).get(`/api/travel?user_id=${theirs.body.user_id}`).set('Cookie', adminCookie);
    expect(filtered.body).toHaveLength(1);

    const everyone = await request(app).get('/api/travel?all=1').set('Cookie', adminCookie);
    expect(everyone.body).toHaveLength(2);
  });

  it('lets a superuser open a sheet on somebody elses behalf', async () => {
    const theirUserId = (db.prepare("SELECT id FROM users WHERE username = 'regularuser'").get() as { id: number }).id;
    const created = await request(app)
      .post('/api/travel')
      .set('Cookie', adminCookie)
      .send({ year: 2026, month: 12, user_id: theirUserId });

    expect(created.body.user_id).toBe(theirUserId);
  });

  it('refuses a sheet for a user who does not exist', async () => {
    const created = await request(app)
      .post('/api/travel')
      .set('Cookie', adminCookie)
      .send({ year: 2026, month: 12, user_id: 9999 });
    expect(created.status).toBe(400);
  });
});
