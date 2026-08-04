import { describe, it, expect, beforeEach } from 'vitest';
import supertest from 'supertest';
import Database from 'better-sqlite3';
import { createTestDb, createTestApp, loginAsAdmin, loginAsRegularUser } from './helpers';

describe('settings routes', () => {
  let db: Database.Database;
  let app: ReturnType<typeof createTestApp>;

  beforeEach(() => {
    db = createTestDb();
    app = createTestApp(db);
  });

  it('requires authentication to read', async () => {
    await supertest(app).get('/api/settings').expect(401);
  });

  it('returns settings to any authenticated user', async () => {
    const cookie = await loginAsRegularUser(app, db);
    const res = await supertest(app).get('/api/settings').set('Cookie', cookie).expect(200);
    expect(res.body.collection_note_prefix).toBe('SBM');
  });

  it('lets a superuser change the next number', async () => {
    const cookie = await loginAsAdmin(app);
    await supertest(app)
      .put('/api/settings')
      .set('Cookie', cookie)
      .send({ collection_note_next_number: '1500' })
      .expect(200);
    const res = await supertest(app).get('/api/settings').set('Cookie', cookie).expect(200);
    expect(res.body.collection_note_next_number).toBe('1500');
  });

  it('refuses a non-superuser write', async () => {
    const cookie = await loginAsRegularUser(app, db);
    await supertest(app)
      .put('/api/settings')
      .set('Cookie', cookie)
      .send({ collection_note_next_number: '1500' })
      .expect(403);
  });

  it('rejects an unknown setting key', async () => {
    const cookie = await loginAsAdmin(app);
    const res = await supertest(app).put('/api/settings').set('Cookie', cookie).send({ evil_key: 'x' }).expect(400);
    expect(res.body.error).toMatch(/evil_key/);
  });

  it('rejects a non-numeric next number', async () => {
    const cookie = await loginAsAdmin(app);
    await supertest(app)
      .put('/api/settings')
      .set('Cookie', cookie)
      .send({ collection_note_next_number: 'abc' })
      .expect(400);
  });
});
