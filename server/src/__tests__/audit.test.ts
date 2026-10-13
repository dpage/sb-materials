import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type Database from 'better-sqlite3';
import type { Express } from 'express';
import { recordAudit } from '../utils/audit';
import { createTestDb, createTestApp, loginAsAdmin, loginAsRegularUser, createTestCustomerAndSite } from './helpers';

interface AuditRow {
  id: number;
  created_at: string;
  user_id: number | null;
  username: string | null;
  display_name: string | null;
  action: string;
  entity_type: string;
  entity_id: number | null;
  summary: string | null;
}

describe('the audit recorder', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  const rows = () => db.prepare('SELECT * FROM audit_log ORDER BY id').all() as AuditRow[];

  it('snapshots the actor from the session', () => {
    const req = { session: { userId: 1, username: 'admin', displayName: 'Administrator' } } as never;
    recordAudit(db, req, { action: 'delete', entityType: 'report', entityId: 42, summary: 'PERN Audit, Acme' });

    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({
      user_id: 1,
      username: 'admin',
      display_name: 'Administrator',
      action: 'delete',
      entity_type: 'report',
      entity_id: 42,
      summary: 'PERN Audit, Acme',
    });
    expect(rows()[0].created_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it('takes an actor for an event with no session behind it', () => {
    recordAudit(db, null, {
      action: 'login-failed',
      entityType: 'session',
      summary: 'nobody: no such user',
      actor: { username: 'nobody' },
    });
    expect(rows()[0]).toMatchObject({ user_id: null, username: 'nobody', action: 'login-failed' });
  });

  // The user's work has already happened by the time the entry is written, so
  // a failure here must not turn a successful delete into a 500.
  it('swallows a write that cannot happen rather than failing the request', () => {
    db.prepare('DROP TABLE audit_log').run();
    expect(() => recordAudit(db, null, { action: 'delete', entityType: 'report', entityId: 1 })).not.toThrow();
  });

  it('keeps the entry readable after the user is removed', () => {
    const userId = (
      db
        .prepare(
          "INSERT INTO users (username, password_hash, display_name, is_superuser) VALUES ('temp', 'x', 'Temporary Person', 0)",
        )
        .run() as { lastInsertRowid: number }
    ).lastInsertRowid;

    recordAudit(db, { session: { userId, username: 'temp', displayName: 'Temporary Person' } } as never, {
      action: 'delete',
      entityType: 'report',
      entityId: 7,
      summary: 'PERN Audit, Acme',
    });
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);

    const row = rows()[0];
    expect(row.user_id).toBeNull();
    expect(row.display_name).toBe('Temporary Person');
    expect(row.summary).toBe('PERN Audit, Acme');
  });
});

describe('what gets recorded', () => {
  let db: Database.Database;
  let app: Express;
  let cookie: string;

  beforeEach(async () => {
    db = createTestDb();
    app = createTestApp(db);
    cookie = await loginAsAdmin(app);
  });

  const entries = (action?: string, entityType?: string) =>
    (db.prepare('SELECT * FROM audit_log ORDER BY id').all() as AuditRow[]).filter(
      (row) => (!action || row.action === action) && (!entityType || row.entity_type === entityType),
    );

  it('records a login, naming who it was', async () => {
    const login = entries('login', 'session');
    expect(login).toHaveLength(1);
    expect(login[0].summary).toBe('Administrator');
  });

  it('records a failed login, and whether the account exists', async () => {
    await request(app).post('/api/auth/login').send({ username: 'admin', password: 'wrong' });
    await request(app).post('/api/auth/login').send({ username: 'nobody', password: 'wrong' });

    const failures = entries('login-failed');
    expect(failures.map((row) => row.summary)).toEqual(['admin: wrong password', 'nobody: no such user']);
    // The attempt against a real account is attributable; the other is not.
    expect(failures[0].user_id).toBe(1);
    expect(failures[1].user_id).toBeNull();
  });

  it('records a logout before the session goes', async () => {
    await request(app).post('/api/auth/logout').set('Cookie', cookie);
    expect(entries('logout')[0].summary).toBe('Administrator');
  });

  it('records a report being created, updated and deleted', async () => {
    const { customerId, siteId } = createTestCustomerAndSite(db);
    const created = await request(app).post('/api/reports').set('Cookie', cookie).send({
      report_type: 'loading_inspection',
      customer_id: customerId,
      site_id: siteId,
      inspection_date: '2026-10-12',
      inspector_name: 'Test User',
    });

    await request(app)
      .put(`/api/reports/${created.body.id}`)
      .set('Cookie', cookie)
      .send({ report_type: 'loading_inspection', customer_id: customerId, site_id: siteId });
    await request(app).delete(`/api/reports/${created.body.id}`).set('Cookie', cookie);

    const reportEntries = entries(undefined, 'report');
    expect(reportEntries.map((row) => row.action)).toEqual(['create', 'update', 'delete']);
    // The summary is written at the time of the event, so the delete still
    // says what went even though the report has gone.
    expect(reportEntries[2].summary).toContain('Test Customer');
    expect(reportEntries[2].entity_id).toBe(created.body.id);
  });

  it('records a customer being created and deactivated', async () => {
    const created = await request(app)
      .post('/api/customers')
      .set('Cookie', cookie)
      .send({ name: 'Acme Recycling Ltd' });
    await request(app).put(`/api/customers/${created.body.id}`).set('Cookie', cookie).send({ is_active: false });

    const customerEntries = entries(undefined, 'customer');
    expect(customerEntries[0]).toMatchObject({ action: 'create', summary: 'Acme Recycling Ltd' });
    expect(customerEntries[1]).toMatchObject({ action: 'update', summary: 'Acme Recycling Ltd (deactivated)' });
  });

  it('records a password change without recording the password', async () => {
    const created = await request(app)
      .post('/api/users')
      .set('Cookie', cookie)
      .send({ username: 'newuser', password: 'secret123', display_name: 'New User' });
    await request(app).put(`/api/users/${created.body.id}`).set('Cookie', cookie).send({ password: 'another-secret' });

    const userEntries = entries(undefined, 'user');
    expect(userEntries[0].summary).toBe('New User (newuser)');
    expect(userEntries[1].summary).toContain('password changed');
    expect(entries().every((row) => !row.summary?.includes('secret'))).toBe(true);
  });

  it('records a sheet being opened once, not on every visit', async () => {
    const first = await request(app).post('/api/travel').set('Cookie', cookie).send({ year: 2026, month: 10 });
    await request(app).post('/api/travel').set('Cookie', cookie).send({ year: 2026, month: 10 });

    expect(entries('create', 'travel-sheet')).toHaveLength(1);

    await request(app).delete(`/api/travel/${first.body.id}`).set('Cookie', cookie);
    expect(entries('delete', 'travel-sheet')[0].summary).toBe('October 2026, Administrator');
  });

  it('records an expenses sheet being saved and deleted', async () => {
    const sheet = await request(app).post('/api/expenses').set('Cookie', cookie).send({ year: 2026, month: 10 });
    await request(app)
      .put(`/api/expenses/${sheet.body.id}`)
      .set('Cookie', cookie)
      .send({ items: [{ description: 'Diesel', cost: 72 }] });
    await request(app).delete(`/api/expenses/${sheet.body.id}`).set('Cookie', cookie);

    expect(entries(undefined, 'expense-sheet').map((row) => row.action)).toEqual(['create', 'update', 'delete']);
  });

  it('records a settings change with the value it was given', async () => {
    await request(app).put('/api/settings').set('Cookie', cookie).send({ mileage_rate_high: '0.6' });
    expect(entries('update', 'settings')[0].summary).toBe('mileage_rate_high = 0.6');
  });

  it('records a lookup value being added', async () => {
    await request(app)
      .post('/api/lookups/lookup_storage_modes')
      .set('Cookie', cookie)
      .send({ value: 'Shipping container' });
    expect(entries('create', 'lookup_storage_modes')[0].summary).toBe('Shipping container');
  });
});

describe('reading the audit log', () => {
  let db: Database.Database;
  let app: Express;
  let cookie: string;

  beforeEach(async () => {
    db = createTestDb();
    app = createTestApp(db);
    cookie = await loginAsAdmin(app);

    const insert = db.prepare(
      `INSERT INTO audit_log (created_at, user_id, username, display_name, action, entity_type, entity_id, summary)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    insert.run('2026-10-01 09:00:00', 1, 'admin', 'Administrator', 'delete', 'report', 1, 'PERN Audit, Acme');
    insert.run('2026-10-02 09:00:00', 1, 'admin', 'Administrator', 'create', 'customer', 2, 'Acme Recycling Ltd');
    insert.run('2026-10-03 09:00:00', null, 'nobody', null, 'login-failed', 'session', null, 'nobody: no such user');
  });

  const list = (query = '') => request(app).get(`/api/audit${query}`).set('Cookie', cookie);

  it('lists the log newest first, with the total', async () => {
    const res = await list();
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(4); // the three seeded entries plus the login
    expect(res.body.data[0].action).toBe('login');
    expect(res.body.data.map((row: AuditRow) => row.summary)).toContain('PERN Audit, Acme');
  });

  it('pages through the log', async () => {
    const page = await list('?limit=2&page=2');
    expect(page.body.data).toHaveLength(2);
    expect(page.body.page).toBe(2);
    expect(page.body.total).toBe(4);
  });

  it('filters by action, entity type, user and date', async () => {
    expect((await list('?action=delete')).body.data).toHaveLength(1);
    expect((await list('?entity_type=customer')).body.data).toHaveLength(1);
    expect((await list('?user_id=1')).body.total).toBe(3);
    // The bounds are days rather than instants, so an entry at 09:00 on the
    // closing day is included.
    expect((await list('?date_from=2026-10-02&date_to=2026-10-03')).body.data).toHaveLength(2);
  });

  it('searches the summary and the person', async () => {
    expect((await list('?search=Acme')).body.data).toHaveLength(2);
    expect((await list('?search=nobody')).body.data).toHaveLength(1);
  });

  it('offers the values actually present as filters', async () => {
    const res = await request(app).get('/api/audit/filters').set('Cookie', cookie);
    expect(res.body.actions).toEqual(['create', 'delete', 'login', 'login-failed']);
    expect(res.body.entityTypes).toEqual(['customer', 'report', 'session']);
    expect(res.body.users).toEqual([{ id: 1, display_name: 'Administrator' }]);
  });

  it('is superuser only', async () => {
    const userCookie = await loginAsRegularUser(app, db);
    expect((await request(app).get('/api/audit').set('Cookie', userCookie)).status).toBe(403);
    expect((await request(app).get('/api/audit/filters').set('Cookie', userCookie)).status).toBe(403);
    expect((await request(app).get('/api/audit')).status).toBe(401);
  });
});
