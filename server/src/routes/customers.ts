import { Router } from 'express';
import Database from 'better-sqlite3';
import { requireAuth } from '../middleware/auth';

export function customerRoutes(db: Database.Database): Router {
  const router = Router();

  router.use(requireAuth);

  // List customers
  router.get('/', (req, res) => {
    const includeInactive = req.query.includeInactive === 'true';
    const query = includeInactive
      ? 'SELECT * FROM customers ORDER BY name'
      : 'SELECT * FROM customers WHERE is_active = 1 ORDER BY name';
    const customers = db.prepare(query).all();
    res.json(customers);
  });

  // Get customer with sites
  router.get('/:id', (req, res) => {
    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
    if (!customer) {
      res.status(404).json({ error: 'Customer not found' });
      return;
    }
    const sites = db.prepare('SELECT * FROM customer_sites WHERE customer_id = ? ORDER BY address').all(req.params.id);
    res.json({ ...(customer as any), sites });
  });

  // Create customer
  router.post('/', (req, res) => {
    const { name, contact_name, email, phone, address } = req.body;
    if (!name) {
      res.status(400).json({ error: 'Name required' });
      return;
    }
    const result = db
      .prepare('INSERT INTO customers (name, contact_name, email, phone, address) VALUES (?, ?, ?, ?, ?)')
      .run(name, contact_name || null, email || null, phone || null, address || null);
    res.json({ id: result.lastInsertRowid, name, contact_name, email, phone, address });
  });

  // Update customer
  router.put('/:id', (req, res) => {
    const { name, contact_name, email, phone, address, is_active } = req.body;
    // Build dynamic update to only touch fields that were sent
    const sets: string[] = [];
    const params: any[] = [];

    if (name !== undefined) {
      sets.push('name = ?');
      params.push(name);
    }
    if (contact_name !== undefined) {
      sets.push('contact_name = ?');
      params.push(contact_name || null);
    }
    if (email !== undefined) {
      sets.push('email = ?');
      params.push(email || null);
    }
    if (phone !== undefined) {
      sets.push('phone = ?');
      params.push(phone || null);
    }
    if (address !== undefined) {
      sets.push('address = ?');
      params.push(address || null);
    }
    if (is_active !== undefined) {
      sets.push('is_active = ?');
      params.push(is_active ? 1 : 0);
    }

    if (sets.length === 0) {
      res.json({ ok: true });
      return;
    }

    params.push(req.params.id);
    db.prepare(`UPDATE customers SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    res.json({ ok: true });
  });

  // List sites for a customer
  router.get('/:id/sites', (req, res) => {
    const includeInactive = req.query.includeInactive === 'true';
    const query = includeInactive
      ? 'SELECT * FROM customer_sites WHERE customer_id = ? ORDER BY address'
      : 'SELECT * FROM customer_sites WHERE customer_id = ? AND is_active = 1 ORDER BY address';
    const sites = db.prepare(query).all(req.params.id);
    res.json(sites);
  });

  // Create site
  router.post('/:id/sites', (req, res) => {
    const { address } = req.body;
    if (!address) {
      res.status(400).json({ error: 'Address required' });
      return;
    }
    const result = db
      .prepare('INSERT INTO customer_sites (customer_id, address) VALUES (?, ?)')
      .run(req.params.id, address);
    res.json({ id: result.lastInsertRowid, customer_id: parseInt(req.params.id), address });
  });

  // Update site
  router.put('/:customerId/sites/:siteId', (req, res) => {
    const { address, is_active } = req.body;
    db.prepare(
      'UPDATE customer_sites SET address = COALESCE(?, address), is_active = COALESCE(?, is_active) WHERE id = ? AND customer_id = ?',
    ).run(address, is_active !== undefined ? (is_active ? 1 : 0) : null, req.params.siteId, req.params.customerId);
    res.json({ ok: true });
  });

  return router;
}
