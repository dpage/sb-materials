import { describe, it, expect, beforeEach } from 'vitest';
import supertest from 'supertest';
import Database from 'better-sqlite3';
import { createTestDb, createTestApp, loginAsAdmin, loginAsRegularUser } from './helpers';
import { getSetting, setSetting, getAllSettings } from '../utils/settings';
import { allocateNextReference, recordReferenceUsed } from '../utils/collection-note-reference';
import { allocateLineReferences, parseLineSuffix } from '../utils/collection-note-line-reference';
import { createSchema } from '../db/schema';

describe('settings store', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = createTestDb();
  });

  it('returns the seeded collection note defaults', () => {
    expect(getSetting(db, 'collection_note_prefix', 'XXX')).toBe('SBM');
    expect(getSetting(db, 'collection_note_next_number', '0')).toBe('2000');
  });

  it('returns the fallback for an unknown key', () => {
    expect(getSetting(db, 'no_such_key', 'fallback')).toBe('fallback');
  });

  it('upserts a value', () => {
    setSetting(db, 'collection_note_next_number', '1500');
    expect(getSetting(db, 'collection_note_next_number', '0')).toBe('1500');
    setSetting(db, 'collection_note_next_number', '1501');
    expect(getSetting(db, 'collection_note_next_number', '0')).toBe('1501');
  });

  it('returns every setting as a map', () => {
    expect(getAllSettings(db).collection_note_prefix).toBe('SBM');
  });
});

describe('reference allocation', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = createTestDb();
  });

  function insertNote(reference: string): void {
    const cust = db.prepare('INSERT INTO customers (name) VALUES (?)').run('Test Customer');
    db.prepare('INSERT INTO collection_notes (reference, customer_id, collection_date) VALUES (?, ?, ?)').run(
      reference,
      cust.lastInsertRowid,
      '2026-08-03',
    );
  }

  it('starts from the configured next number when there are no notes', () => {
    setSetting(db, 'collection_note_next_number', '1061');
    expect(allocateNextReference(db)).toBe('SBM1061');
  });

  it('does not reuse a reference already present', () => {
    setSetting(db, 'collection_note_next_number', '1061');
    insertNote('SBM1061');
    expect(allocateNextReference(db)).toBe('SBM1062');
  });

  it('follows a manually entered higher reference', () => {
    setSetting(db, 'collection_note_next_number', '1061');
    insertNote('SBM2000');
    expect(allocateNextReference(db)).toBe('SBM2001');
  });

  it('ignores references that do not match the prefix pattern', () => {
    setSetting(db, 'collection_note_next_number', '10');
    insertNote('LEGACY-ABC');
    expect(allocateNextReference(db)).toBe('SBM10');
  });

  it('matches the prefix case insensitively', () => {
    setSetting(db, 'collection_note_next_number', '1');
    insertNote('sbm55');
    expect(allocateNextReference(db)).toBe('SBM56');
  });

  it('advances the stored next number when a reference is recorded', () => {
    setSetting(db, 'collection_note_next_number', '1061');
    recordReferenceUsed(db, 'SBM1061');
    expect(getSetting(db, 'collection_note_next_number', '0')).toBe('1062');
  });

  it('does not wind the stored next number backwards', () => {
    setSetting(db, 'collection_note_next_number', '1061');
    recordReferenceUsed(db, 'SBM500');
    expect(getSetting(db, 'collection_note_next_number', '0')).toBe('1061');
  });

  it('tolerates a non-conforming reference when recording', () => {
    setSetting(db, 'collection_note_next_number', '1061');
    expect(() => recordReferenceUsed(db, 'ONE-OFF')).not.toThrow();
    expect(getSetting(db, 'collection_note_next_number', '0')).toBe('1061');
  });
});

describe('collection note schema', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = createTestDb();
  });

  it('rejects a duplicate reference', () => {
    const cust = db.prepare('INSERT INTO customers (name) VALUES (?)').run('Test Customer');
    const insert = db.prepare('INSERT INTO collection_notes (reference, customer_id) VALUES (?, ?)');
    insert.run('SBM1', cust.lastInsertRowid);
    expect(() => insert.run('SBM1', cust.lastInsertRowid)).toThrow(/UNIQUE/i);
  });

  it('rejects a duplicate reference that differs only in case', () => {
    // parseReferenceNumber treats "SBM1061" and "sbm1061" as the same
    // reference, so the uniqueness constraint must agree, or a customer
    // reading the two ends up with what looks like one duplicated note.
    const cust = db.prepare('INSERT INTO customers (name) VALUES (?)').run('Test Customer');
    const insert = db.prepare('INSERT INTO collection_notes (reference, customer_id) VALUES (?, ?)');
    insert.run('SBM1061', cust.lastInsertRowid);
    expect(() => insert.run('sbm1061', cust.lastInsertRowid)).toThrow(/UNIQUE/i);
  });

  it('cascades item deletion when the note is deleted', () => {
    const cust = db.prepare('INSERT INTO customers (name) VALUES (?)').run('Test Customer');
    const note = db
      .prepare('INSERT INTO collection_notes (reference, customer_id) VALUES (?, ?)')
      .run('SBM1', cust.lastInsertRowid);
    db.prepare(
      'INSERT INTO collection_note_items (note_id, quantity, description, reference, sort_order) VALUES (?, ?, ?, ?, ?)',
    ).run(note.lastInsertRowid, '1x', 'Poly cup reels', 'REF-1', 0);

    db.prepare('DELETE FROM collection_notes WHERE id = ?').run(note.lastInsertRowid);

    const remaining = db.prepare('SELECT COUNT(*) AS n FROM collection_note_items').get() as { n: number };
    expect(remaining.n).toBe(0);
  });
});

describe('collection note routes', () => {
  let db: Database.Database;
  let app: ReturnType<typeof createTestApp>;
  let cookie: string;
  let customerId: number;

  beforeEach(async () => {
    db = createTestDb();
    app = createTestApp(db);
    cookie = await loginAsAdmin(app);
    const cust = db
      .prepare('INSERT INTO customers (name, address) VALUES (?, ?)')
      .run('Acme Recycling Ltd', '1 Test Way');
    customerId = cust.lastInsertRowid as number;
  });

  const validNote = () => ({
    reference: 'SBM1061',
    customer_id: customerId,
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
      { quantity: '2x', description: 'Mixed paper bales', nett_weight: '980', reference: 'REF-2' },
    ],
  });

  it('requires authentication', async () => {
    await supertest(app).get('/api/collection-notes').expect(401);
  });

  it('creates and reads back a note with its items', async () => {
    const created = await supertest(app)
      .post('/api/collection-notes')
      .set('Cookie', cookie)
      .send(validNote())
      .expect(200);
    expect(created.body.id).toBeGreaterThan(0);
    expect(created.body.reference).toBe('SBM1061');

    const fetched = await supertest(app)
      .get(`/api/collection-notes/${created.body.id}`)
      .set('Cookie', cookie)
      .expect(200);
    expect(fetched.body.customer_name).toBe('Acme Recycling Ltd');
    expect(fetched.body.buyer_reference).toBe('BR-1');
    expect(fetched.body.minimum_weight).toBe('22t');
    expect(fetched.body.items).toHaveLength(2);
    expect(fetched.body.items[0].description).toBe('Poly cup reels');
    expect(fetched.body.items[0].nett_weight).toBe('1250');
    expect(fetched.body.items[0].reference).toBe('REF-1');
    expect(fetched.body.items[0].vehicle_registration).toBe('AB12 CDE');
    expect(fetched.body.items[1].sort_order).toBe(1);
  });

  it('stores the container details on a containerised line', async () => {
    const created = await supertest(app)
      .post('/api/collection-notes')
      .set('Cookie', cookie)
      .send({
        ...validNote(),
        items: [
          {
            quantity: '1x',
            description: 'Poly cup reels',
            reference: 'REF-1',
            is_container: 1,
            container_number: 'ABCU1234567',
            seal_number: 'SEAL-9',
          },
        ],
      })
      .expect(200);

    const fetched = await supertest(app)
      .get(`/api/collection-notes/${created.body.id}`)
      .set('Cookie', cookie)
      .expect(200);
    expect(fetched.body.items[0]).toMatchObject({
      is_container: 1,
      container_number: 'ABCU1234567',
      seal_number: 'SEAL-9',
    });
  });

  it('forgets the container number and seal once a line is no longer a container', async () => {
    const created = await supertest(app)
      .post('/api/collection-notes')
      .set('Cookie', cookie)
      .send({
        ...validNote(),
        items: [
          {
            quantity: '1x',
            description: 'Poly cup reels',
            is_container: 1,
            container_number: 'ABCU1234567',
            seal_number: 'SEAL-9',
          },
        ],
      })
      .expect(200);

    await supertest(app)
      .put(`/api/collection-notes/${created.body.id}`)
      .set('Cookie', cookie)
      .send({
        ...validNote(),
        items: [
          {
            quantity: '1x',
            description: 'Poly cup reels',
            is_container: 0,
            container_number: 'ABCU1234567',
            seal_number: 'SEAL-9',
          },
        ],
      })
      .expect(200);

    const fetched = await supertest(app)
      .get(`/api/collection-notes/${created.body.id}`)
      .set('Cookie', cookie)
      .expect(200);
    expect(fetched.body.items[0]).toMatchObject({
      is_container: 0,
      container_number: null,
      seal_number: null,
    });
  });

  it('keeps a line that says nothing but its vehicle registration or container details', async () => {
    const created = await supertest(app)
      .post('/api/collection-notes')
      .set('Cookie', cookie)
      .send({
        ...validNote(),
        items: [
          { quantity: '', description: '', vehicle_registration: 'AB12 CDE' },
          { quantity: '', description: '', is_container: 1, container_number: 'ABCU1234567' },
        ],
      })
      .expect(200);

    const fetched = await supertest(app)
      .get(`/api/collection-notes/${created.body.id}`)
      .set('Cookie', cookie)
      .expect(200);
    expect(fetched.body.items).toHaveLength(2);
  });

  it('records the creating user', async () => {
    const created = await supertest(app)
      .post('/api/collection-notes')
      .set('Cookie', cookie)
      .send(validNote())
      .expect(200);
    const row = db.prepare('SELECT created_by_id FROM collection_notes WHERE id = ?').get(created.body.id) as {
      created_by_id: number | null;
    };
    expect(row.created_by_id).not.toBeNull();
  });

  it('rejects a note with no reference', async () => {
    const res = await supertest(app)
      .post('/api/collection-notes')
      .set('Cookie', cookie)
      .send({ ...validNote(), reference: '' })
      .expect(400);
    expect(res.body.error).toMatch(/reference/i);
  });

  it('rejects a note with no customer', async () => {
    const res = await supertest(app)
      .post('/api/collection-notes')
      .set('Cookie', cookie)
      .send({ ...validNote(), customer_id: undefined })
      .expect(400);
    expect(res.body.error).toMatch(/customer/i);
  });

  it('returns 409 on a duplicate reference', async () => {
    await supertest(app).post('/api/collection-notes').set('Cookie', cookie).send(validNote()).expect(200);
    const res = await supertest(app).post('/api/collection-notes').set('Cookie', cookie).send(validNote()).expect(409);
    expect(res.body.error).toMatch(/SBM1061/);
  });

  it('advances the stored next number after a create', async () => {
    setSetting(db, 'collection_note_next_number', '1061');
    await supertest(app).post('/api/collection-notes').set('Cookie', cookie).send(validNote()).expect(200);
    const res = await supertest(app).get('/api/collection-notes/next-reference').set('Cookie', cookie).expect(200);
    expect(res.body.reference).toBe('SBM1062');
  });

  it('replaces items wholesale on update', async () => {
    const created = await supertest(app)
      .post('/api/collection-notes')
      .set('Cookie', cookie)
      .send(validNote())
      .expect(200);

    await supertest(app)
      .put(`/api/collection-notes/${created.body.id}`)
      .set('Cookie', cookie)
      .send({
        ...validNote(),
        minimum_weight: '26t',
        items: [{ quantity: '5x', description: 'Shrink wrap', reference: 'REF-5' }],
      })
      .expect(200);

    const fetched = await supertest(app)
      .get(`/api/collection-notes/${created.body.id}`)
      .set('Cookie', cookie)
      .expect(200);
    expect(fetched.body.minimum_weight).toBe('26t');
    expect(fetched.body.items).toHaveLength(1);
    expect(fetched.body.items[0].description).toBe('Shrink wrap');
  });

  it('drops all-blank line items rather than storing an empty row', async () => {
    // The form always starts with (and can be left with) one blank line
    // item, and always sends the items array, so the server must be the one
    // to filter it out - otherwise an all-NULL row is stored and rendered
    // as an empty row in the PDF table.
    const created = await supertest(app)
      .post('/api/collection-notes')
      .set('Cookie', cookie)
      .send({
        ...validNote(),
        items: [
          { quantity: '1x', description: 'Poly cup reels', reference: 'REF-1' },
          { quantity: '', description: '', reference: '' },
          { quantity: null, description: null, reference: null },
        ],
      })
      .expect(200);

    const fetched = await supertest(app)
      .get(`/api/collection-notes/${created.body.id}`)
      .set('Cookie', cookie)
      .expect(200);
    expect(fetched.body.items).toHaveLength(1);
    expect(fetched.body.items[0].description).toBe('Poly cup reels');
  });

  it('stores nothing at all for a note whose only item is blank', async () => {
    const created = await supertest(app)
      .post('/api/collection-notes')
      .set('Cookie', cookie)
      .send({ ...validNote(), items: [{ quantity: '', description: '', reference: '' }] })
      .expect(200);

    const fetched = await supertest(app)
      .get(`/api/collection-notes/${created.body.id}`)
      .set('Cookie', cookie)
      .expect(200);
    expect(fetched.body.items).toHaveLength(0);
  });

  it('returns 409 when an update collides with another reference', async () => {
    const first = await supertest(app)
      .post('/api/collection-notes')
      .set('Cookie', cookie)
      .send(validNote())
      .expect(200);
    await supertest(app)
      .post('/api/collection-notes')
      .set('Cookie', cookie)
      .send({ ...validNote(), reference: 'SBM1062' })
      .expect(200);

    await supertest(app)
      .put(`/api/collection-notes/${first.body.id}`)
      .set('Cookie', cookie)
      .send({ ...validNote(), reference: 'SBM1062' })
      .expect(409);
  });

  it("duplicates a note with a fresh reference, today's date, and no signature", async () => {
    setSetting(db, 'collection_note_next_number', '1061');
    const created = await supertest(app)
      .post('/api/collection-notes')
      .set('Cookie', cookie)
      .send({ ...validNote(), dispatched_signed_date: '2026-08-03' })
      .expect(200);
    db.prepare('UPDATE collection_notes SET dispatched_signature_path = ? WHERE id = ?').run(
      'collection-notes/1/sig.png',
      created.body.id,
    );

    const copied = await supertest(app)
      .post(`/api/collection-notes/${created.body.id}/duplicate`)
      .set('Cookie', cookie)
      .expect(200);
    expect(copied.body.reference).toBe('SBM1062');
    expect(copied.body.id).not.toBe(created.body.id);

    const fetched = await supertest(app)
      .get(`/api/collection-notes/${copied.body.id}`)
      .set('Cookie', cookie)
      .expect(200);
    expect(fetched.body.customer_id).toBe(customerId);
    expect(fetched.body.transport_company).toBe('Test Haulage');
    expect(fetched.body.buyer_reference).toBe('BR-1');
    expect(fetched.body.items).toHaveLength(2);
    expect(fetched.body.items[0].description).toBe('Poly cup reels');
    expect(fetched.body.items[0].nett_weight).toBe('1250');
    // A signature belongs to the load it was given for, so it must not travel
    // with the copy.
    expect(fetched.body.dispatched_signature_path).toBeNull();
    expect(fetched.body.dispatched_signed_date).toBeNull();
    expect(fetched.body.collection_date).toBe(new Date().toISOString().slice(0, 10));

    // The original is untouched, and the sequence has moved on.
    const original = await supertest(app)
      .get(`/api/collection-notes/${created.body.id}`)
      .set('Cookie', cookie)
      .expect(200);
    expect(original.body.reference).toBe('SBM1061');
    const next = await supertest(app).get('/api/collection-notes/next-reference').set('Cookie', cookie).expect(200);
    expect(next.body.reference).toBe('SBM1063');
  });

  it('returns 404 when duplicating an unknown note', async () => {
    await supertest(app).post('/api/collection-notes/9999/duplicate').set('Cookie', cookie).expect(404);
  });

  it('rejects a received signature upload, since there is no longer such a thing', async () => {
    const created = await supertest(app)
      .post('/api/collection-notes')
      .set('Cookie', cookie)
      .send(validNote())
      .expect(200);
    await supertest(app)
      .post(`/api/collection-notes/${created.body.id}/signature/received`)
      .set('Cookie', cookie)
      .attach('signature', Buffer.from('fake'), 'sig.png')
      .expect(400);
  });

  it('returns 404 for an unknown note on get, put, and delete', async () => {
    await supertest(app).get('/api/collection-notes/9999').set('Cookie', cookie).expect(404);
    await supertest(app).put('/api/collection-notes/9999').set('Cookie', cookie).send(validNote()).expect(404);
    await supertest(app).delete('/api/collection-notes/9999').set('Cookie', cookie).expect(404);
  });

  it('deletes a note and its items', async () => {
    const created = await supertest(app)
      .post('/api/collection-notes')
      .set('Cookie', cookie)
      .send(validNote())
      .expect(200);
    await supertest(app).delete(`/api/collection-notes/${created.body.id}`).set('Cookie', cookie).expect(200);
    const items = db.prepare('SELECT COUNT(*) AS n FROM collection_note_items').get() as { n: number };
    expect(items.n).toBe(0);
  });

  it('lists notes newest collection date first', async () => {
    await supertest(app)
      .post('/api/collection-notes')
      .set('Cookie', cookie)
      .send({ ...validNote(), reference: 'SBM1', collection_date: '2026-01-01' })
      .expect(200);
    await supertest(app)
      .post('/api/collection-notes')
      .set('Cookie', cookie)
      .send({ ...validNote(), reference: 'SBM2', collection_date: '2026-06-01' })
      .expect(200);

    const res = await supertest(app).get('/api/collection-notes').set('Cookie', cookie).expect(200);
    expect(res.body.data.map((n: { reference: string }) => n.reference)).toEqual(['SBM2', 'SBM1']);
    expect(res.body.total).toBe(2);
    expect(res.body.data[0].customer_name).toBe('Acme Recycling Ltd');
  });

  it('searches by reference, customer, and item description', async () => {
    await supertest(app)
      .post('/api/collection-notes')
      .set('Cookie', cookie)
      .send({
        ...validNote(),
        reference: 'SBM77',
        items: [{ quantity: '1x', description: 'Widget offcuts', reference: 'REF-9' }],
      })
      .expect(200);

    for (const term of ['SBM77', 'Acme', 'Widget']) {
      const res = await supertest(app).get(`/api/collection-notes?search=${term}`).set('Cookie', cookie).expect(200);
      expect(res.body.data).toHaveLength(1);
    }

    const noMatch = await supertest(app).get('/api/collection-notes?search=zzzznope').set('Cookie', cookie).expect(200);
    expect(noMatch.body.data).toHaveLength(0);
  });

  it('sorts by reference when asked', async () => {
    await supertest(app)
      .post('/api/collection-notes')
      .set('Cookie', cookie)
      .send({ ...validNote(), reference: 'SBM1' })
      .expect(200);
    await supertest(app)
      .post('/api/collection-notes')
      .set('Cookie', cookie)
      .send({ ...validNote(), reference: 'SBM2' })
      .expect(200);
    const res = await supertest(app)
      .get('/api/collection-notes?sort=reference&order=ASC')
      .set('Cookie', cookie)
      .expect(200);
    expect(res.body.data.map((n: { reference: string }) => n.reference)).toEqual(['SBM1', 'SBM2']);
  });

  it('ignores an unrecognised sort column', async () => {
    await supertest(app).post('/api/collection-notes').set('Cookie', cookie).send(validNote()).expect(200);
    await supertest(app).get('/api/collection-notes?sort=DROP+TABLE').set('Cookie', cookie).expect(200);
  });

  it('lets a regular user create and read notes', async () => {
    const userCookie = await loginAsRegularUser(app, db);
    const created = await supertest(app)
      .post('/api/collection-notes')
      .set('Cookie', userCookie)
      .send(validNote())
      .expect(200);
    await supertest(app).get(`/api/collection-notes/${created.body.id}`).set('Cookie', userCookie).expect(200);
  });

  it('returns a next reference for a fresh database', async () => {
    const res = await supertest(app).get('/api/collection-notes/next-reference').set('Cookie', cookie).expect(200);
    expect(res.body.reference).toBe('SBM2000');
    expect(res.body.prefix).toBe('SBM');
  });
});

describe('per-line references', () => {
  let db: Database.Database;
  let app: ReturnType<typeof createTestApp>;
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
    items: [{ description: 'Poly cup reels' }, { description: 'Mixed paper bales' }],
    ...overrides,
  });

  async function create(overrides: Record<string, unknown> = {}): Promise<number> {
    const res = await supertest(app).post('/api/collection-notes').set('Cookie', cookie).send(note(overrides));
    expect(res.status).toBe(200);
    return res.body.id;
  }

  async function lineReferences(id: number): Promise<string[]> {
    const res = await supertest(app).get(`/api/collection-notes/${id}`).set('Cookie', cookie).expect(200);
    return res.body.items.map((i: { line_reference: string }) => i.line_reference);
  }

  it('numbers the lines of a new note from the note reference', async () => {
    const id = await create();
    expect(await lineReferences(id)).toEqual(['SBM1061-1', 'SBM1061-2']);
  });

  it('allocates nothing for a blank line that was dropped', async () => {
    const id = await create({ items: [{ description: 'Poly cup reels' }, {}] });
    expect(await lineReferences(id)).toEqual(['SBM1061-1']);
  });

  it('leaves the existing lines their references and carries on numbering', async () => {
    const id = await create();
    const existing = await supertest(app).get(`/api/collection-notes/${id}`).set('Cookie', cookie).expect(200);

    await supertest(app)
      .put(`/api/collection-notes/${id}`)
      .set('Cookie', cookie)
      .send({ ...note(), items: [...existing.body.items, { description: 'Shrink wrap' }] })
      .expect(200);

    expect(await lineReferences(id)).toEqual(['SBM1061-1', 'SBM1061-2', 'SBM1061-3']);
  });

  it('never renumbers the lines around one that was deleted, nor reissues its reference', async () => {
    const id = await create();
    const existing = await supertest(app).get(`/api/collection-notes/${id}`).set('Cookie', cookie).expect(200);

    // Drop the first line and add a new one in its place.
    await supertest(app)
      .put(`/api/collection-notes/${id}`)
      .set('Cookie', cookie)
      .send({ ...note(), items: [existing.body.items[1], { description: 'Shrink wrap' }] })
      .expect(200);

    expect(await lineReferences(id)).toEqual(['SBM1061-2', 'SBM1061-3']);
  });

  it('gives a copy of a note fresh references under its own reference', async () => {
    const id = await create();
    const copy = await supertest(app).post(`/api/collection-notes/${id}/duplicate`).set('Cookie', cookie).expect(200);
    expect(await lineReferences(copy.body.id)).toEqual(['SBM2000-1', 'SBM2000-2']);
    expect(await lineReferences(id)).toEqual(['SBM1061-1', 'SBM1061-2']);
  });

  it('keeps the lines of two notes apart', async () => {
    const first = await create();
    const second = await create({ reference: 'SBM1062' });
    expect(await lineReferences(first)).toEqual(['SBM1061-1', 'SBM1061-2']);
    expect(await lineReferences(second)).toEqual(['SBM1062-1', 'SBM1062-2']);
  });

  it('skips a reference another line already holds, so renaming a note cannot collide', async () => {
    const first = await create();
    // The note is renamed to the reference a second note will take, leaving
    // its lines holding SBM1062-1 and SBM1062-2 under their original numbers.
    await supertest(app)
      .put(`/api/collection-notes/${first}`)
      .set('Cookie', cookie)
      .send({
        ...note({ reference: 'SBM1062' }),
        items: [{ description: 'Poly cup reels' }, { description: 'Mixed paper bales' }],
      })
      .expect(200);
    expect(await lineReferences(first)).toEqual(['SBM1062-1', 'SBM1062-2']);

    const second = await create({ reference: 'SBM1062-ALT' });
    await supertest(app)
      .put(`/api/collection-notes/${second}`)
      .set('Cookie', cookie)
      .send({ ...note({ reference: 'SBM1062-ALT' }), items: [{ description: 'Shrink wrap' }] })
      .expect(200);

    const refs = await lineReferences(second);
    expect(refs).toHaveLength(1);
    expect(refs[0]).not.toBe('SBM1062-1');
  });

  it('gives the lines of an older note references on the next startup', () => {
    // A database from before the column existed: the rows are inserted with
    // no line reference at all, as the old code did.
    const insert = db.prepare(
      'INSERT INTO collection_notes (reference, customer_id, collection_date) VALUES (?, ?, ?)',
    );
    const noteId = insert.run('SBM1050', customerId, '2026-08-01').lastInsertRowid as number;
    const item = db.prepare('INSERT INTO collection_note_items (note_id, description, sort_order) VALUES (?, ?, ?)');
    item.run(noteId, 'Poly cup reels', 0);
    item.run(noteId, 'Mixed paper bales', 1);

    createSchema(db);

    const rows = db
      .prepare('SELECT line_reference FROM collection_note_items WHERE note_id = ? ORDER BY sort_order')
      .all(noteId) as { line_reference: string }[];
    expect(rows.map((r) => r.line_reference)).toEqual(['SBM1050-1', 'SBM1050-2']);
  });
});

describe('line reference allocation', () => {
  it('reads the suffix off a reference, and nothing off one that has none', () => {
    expect(parseLineSuffix('SBM1061-3')).toBe(3);
    expect(parseLineSuffix('  SBM1061-12  ')).toBe(12);
    expect(parseLineSuffix('SBM1061')).toBeNull();
    expect(parseLineSuffix('')).toBeNull();
    expect(parseLineSuffix(null)).toBeNull();
  });

  it('carries on from the highest suffix on the note', () => {
    const lines = [{ line_reference: 'SBM1061-2' }, { line_reference: null }, { line_reference: 'SBM1061-7' }, {}];
    expect(allocateLineReferences(new Set(), 'SBM1061', lines)).toEqual([
      'SBM1061-2',
      'SBM1061-8',
      'SBM1061-7',
      'SBM1061-9',
    ]);
  });

  it('steps over a reference already in use, whatever its case', () => {
    const taken = new Set(['sbm1061-1', 'sbm1061-2']);
    expect(allocateLineReferences(taken, 'SBM1061', [{}])).toEqual(['SBM1061-3']);
  });
});
