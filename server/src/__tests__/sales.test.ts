import { describe, it, expect, beforeEach } from 'vitest';
import supertest from 'supertest';
import express from 'express';
import Database from 'better-sqlite3';
import { createTestDb, createTestApp, loginAsAdmin, loginAsRegularUser } from './helpers';
import { stripSaleFields, toPrice } from '../utils/collection-note-sales';

describe('the sale fields on a collection note', () => {
  it('leaves a note alone for somebody allowed to see the sale', () => {
    const row = { id: 1, reference: 'SBM1061', buyer: 'Test Buyer', buy_price: 100, sale_price: 150 };
    expect(stripSaleFields(row, true)).toEqual(row);
  });

  it('removes the buyer, the prices and the paid flag for everybody else', () => {
    const stripped = stripSaleFields(
      { id: 1, reference: 'SBM1061', buyer: 'Test Buyer', buy_price: 100, sale_price: 150, is_paid: 1, paid_date: 'x' },
      false,
    );
    expect(stripped).toEqual({ id: 1, reference: 'SBM1061' });
  });

  it('reads a price from whatever the form sends, including a pound sign', () => {
    expect(toPrice('150.50')).toBe(150.5);
    expect(toPrice('£150.50')).toBe(150.5);
    expect(toPrice(150)).toBe(150);
    expect(toPrice('')).toBeNull();
    expect(toPrice(null)).toBeNull();
    expect(toPrice('not a price')).toBeNull();
  });
});

describe('sales', () => {
  let db: Database.Database;
  let app: express.Express;
  let cookie: string;
  let customerId: number;

  beforeEach(async () => {
    db = createTestDb();
    app = createTestApp(db);
    cookie = await loginAsAdmin(app);
    const cust = db.prepare('INSERT INTO customers (name) VALUES (?)').run('Acme Recycling Ltd');
    customerId = cust.lastInsertRowid as number;
  });

  const note = (overrides: Record<string, unknown> = {}) => ({
    reference: 'SBM1061',
    customer_id: customerId,
    collection_date: '2026-08-03',
    buyer: 'Test Buyer',
    buy_price: 100,
    sale_price: 150,
    items: [{ quantity: '1x', description: 'Poly cup reels' }],
    ...overrides,
  });

  async function createNote(overrides: Record<string, unknown> = {}, as = cookie): Promise<number> {
    const res = await supertest(app).post('/api/collection-notes').set('Cookie', as).send(note(overrides)).expect(200);
    return res.body.id;
  }

  it('requires a superuser', async () => {
    const regular = await loginAsRegularUser(app, db);
    await supertest(app).get('/api/sales').set('Cookie', regular).expect(403);
    await supertest(app).get('/api/sales').expect(401);
  });

  it('lists one line per consignment, fed by the collection note', async () => {
    await createNote();
    const res = await supertest(app).get('/api/sales').set('Cookie', cookie).expect(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({
      reference: 'SBM1061',
      customer_name: 'Acme Recycling Ltd',
      buyer: 'Test Buyer',
      buy_price: 100,
      sale_price: 150,
      is_paid: 0,
    });
  });

  it('keeps a sale on the list until it is ticked as paid', async () => {
    const id = await createNote();

    const paid = await supertest(app).put(`/api/sales/${id}/paid`).set('Cookie', cookie).send({ is_paid: true });
    expect(paid.body.is_paid).toBe(1);
    expect(paid.body.paid_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const unpaidList = await supertest(app).get('/api/sales').set('Cookie', cookie).expect(200);
    expect(unpaidList.body.data).toHaveLength(0);

    const paidList = await supertest(app).get('/api/sales?status=paid').set('Cookie', cookie).expect(200);
    expect(paidList.body.data).toHaveLength(1);
    expect(await supertest(app).get('/api/sales?status=all').set('Cookie', cookie)).toMatchObject({
      body: { data: [{ reference: 'SBM1061' }] },
    });
  });

  it('puts the tick back and forgets the date when a sale was marked paid by mistake', async () => {
    const id = await createNote();
    await supertest(app).put(`/api/sales/${id}/paid`).set('Cookie', cookie).send({ is_paid: true }).expect(200);
    const res = await supertest(app)
      .put(`/api/sales/${id}/paid`)
      .set('Cookie', cookie)
      .send({ is_paid: false })
      .expect(200);
    expect(res.body).toMatchObject({ is_paid: 0, paid_date: null });
    expect((await supertest(app).get('/api/sales').set('Cookie', cookie)).body.data).toHaveLength(1);
  });

  it('totals what is still owed, counting only the unpaid lines', async () => {
    await createNote();
    const second = await createNote({ reference: 'SBM1062', sale_price: 250 });
    expect((await supertest(app).get('/api/sales').set('Cookie', cookie)).body.outstanding).toBe(400);

    await supertest(app).put(`/api/sales/${second}/paid`).set('Cookie', cookie).send({ is_paid: true }).expect(200);
    expect((await supertest(app).get('/api/sales').set('Cookie', cookie)).body.outstanding).toBe(150);
  });

  it('searches by reference, customer, and buyer', async () => {
    await createNote();
    await createNote({ reference: 'SBM1062', buyer: 'Other Buyer' });

    const byBuyer = await supertest(app).get('/api/sales?search=Other').set('Cookie', cookie).expect(200);
    expect(byBuyer.body.data.map((s: { reference: string }) => s.reference)).toEqual(['SBM1062']);

    const byReference = await supertest(app).get('/api/sales?search=SBM1061').set('Cookie', cookie).expect(200);
    expect(byReference.body.data).toHaveLength(1);

    const byCustomer = await supertest(app).get('/api/sales?search=Acme').set('Cookie', cookie).expect(200);
    expect(byCustomer.body.data).toHaveLength(2);
  });

  it('records a sale being marked paid, and unpaid again, in the audit log', async () => {
    const id = await createNote();
    await supertest(app).put(`/api/sales/${id}/paid`).set('Cookie', cookie).send({ is_paid: true }).expect(200);
    await supertest(app).put(`/api/sales/${id}/paid`).set('Cookie', cookie).send({ is_paid: false }).expect(200);

    const entries = db
      .prepare("SELECT action, summary FROM audit_log WHERE entity_type = 'collection-note' ORDER BY id")
      .all() as { action: string; summary: string }[];
    expect(entries.map((e) => e.action)).toEqual(['create', 'mark-paid', 'mark-unpaid']);
    expect(entries[1].summary).toContain('SBM1061');
  });

  it('returns 404 for a note that does not exist', async () => {
    await supertest(app).put('/api/sales/999/paid').set('Cookie', cookie).send({ is_paid: true }).expect(404);
  });

  it('shows the sale on the note itself to a superuser, and hides it from everybody else', async () => {
    const id = await createNote();
    const regular = await loginAsRegularUser(app, db);

    const mine = await supertest(app).get(`/api/collection-notes/${id}`).set('Cookie', cookie).expect(200);
    expect(mine.body).toMatchObject({ buyer: 'Test Buyer', buy_price: 100, sale_price: 150 });

    const theirs = await supertest(app).get(`/api/collection-notes/${id}`).set('Cookie', regular).expect(200);
    expect(theirs.body).not.toHaveProperty('buyer');
    expect(theirs.body).not.toHaveProperty('buy_price');
    expect(theirs.body).not.toHaveProperty('sale_price');
    expect(theirs.body).not.toHaveProperty('is_paid');
    expect(theirs.body.reference).toBe('SBM1061');

    const list = await supertest(app).get('/api/collection-notes').set('Cookie', regular).expect(200);
    expect(list.body.data[0]).not.toHaveProperty('sale_price');
  });

  it('stores nothing of a sale a non-superuser tries to put on a new note', async () => {
    const regular = await loginAsRegularUser(app, db);
    const id = await createNote({}, regular);
    const row = db.prepare('SELECT buyer, buy_price, sale_price FROM collection_notes WHERE id = ?').get(id);
    expect(row).toEqual({ buyer: null, buy_price: null, sale_price: null });
  });

  it('leaves the sale untouched when a non-superuser saves the note', async () => {
    const id = await createNote();
    const regular = await loginAsRegularUser(app, db);

    await supertest(app)
      .put(`/api/collection-notes/${id}`)
      .set('Cookie', regular)
      .send({ ...note({ buyer: 'Hijacked', buy_price: 1, sale_price: 2 }), transport_company: 'Test Haulage' })
      .expect(200);

    const row = db.prepare('SELECT buyer, buy_price, sale_price FROM collection_notes WHERE id = ?').get(id);
    expect(row).toEqual({ buyer: 'Test Buyer', buy_price: 100, sale_price: 150 });
  });

  it('does not carry the sale over to a copy of the note', async () => {
    const id = await createNote();
    await supertest(app).put(`/api/sales/${id}/paid`).set('Cookie', cookie).send({ is_paid: true }).expect(200);

    const copy = await supertest(app).post(`/api/collection-notes/${id}/duplicate`).set('Cookie', cookie).expect(200);
    const row = db
      .prepare('SELECT buyer, buy_price, sale_price, is_paid, paid_date FROM collection_notes WHERE id = ?')
      .get(copy.body.id);
    expect(row).toEqual({ buyer: null, buy_price: null, sale_price: null, is_paid: 0, paid_date: null });
  });
});
