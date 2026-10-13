import { Router } from 'express';
import Database from 'better-sqlite3';
import { requireAuth } from '../middleware/auth';
import { mileagePayment, mileageRates, milesBroughtForward, toNumber, totalJourneyMiles } from '../utils/mileage';
import {
  isSuperuser,
  loadSheetForUser,
  openSheet,
  parseMonth,
  requestedUserId,
  sessionUserId,
  touchSheet,
} from '../utils/sheets';

interface JourneyInput {
  journey_date?: string | null;
  customer_id?: number | string | null;
  customer_name?: string | null;
  job?: string | null;
  from_location?: string | null;
  to_location?: string | null;
  miles?: number | string | null;
  round_trip?: boolean | number | null;
}

export function travelRoutes(db: Database.Database): Router {
  const router = Router();

  router.use(requireAuth);

  const journeysFor = (sheetId: number) =>
    db.prepare('SELECT * FROM travel_journeys WHERE sheet_id = ? ORDER BY sort_order, id').all(sheetId) as Record<
      string,
      unknown
    >[];

  /**
   * A sheet with its journeys and the figures that depend on the rest of the
   * tax year, so neither the form nor the PDF has to work the banding out for
   * itself.
   */
  const withTotals = (sheet: { id: number; user_id: number; year: number; month: number }) => {
    const journeys = journeysFor(sheet.id);
    const broughtForward = milesBroughtForward(db, sheet.user_id, sheet);
    const miles = totalJourneyMiles(journeys);
    return {
      ...sheet,
      journeys,
      totals: mileagePayment(broughtForward, miles, mileageRates(db)),
    };
  };

  // The list only needs the money and the mileage, not every leg, so it does
  // not pay the cost of loading them.
  const summaryFor = (sheet: { id: number; user_id: number; year: number; month: number }) => {
    const journeys = journeysFor(sheet.id);
    const totals = mileagePayment(
      milesBroughtForward(db, sheet.user_id, sheet),
      totalJourneyMiles(journeys),
      mileageRates(db),
    );
    return { journey_count: journeys.length, totals };
  };

  router.get('/', (req, res) => {
    const userId = requestedUserId(req);
    const rows = db
      .prepare(
        `SELECT s.*, u.display_name AS display_name
           FROM travel_sheets s
           JOIN users u ON u.id = s.user_id
          ${userId === null ? '' : 'WHERE s.user_id = ?'}
          ORDER BY s.year DESC, s.month DESC, u.display_name`,
      )
      .all(...(userId === null ? [] : [userId])) as { id: number; user_id: number; year: number; month: number }[];

    res.json(rows.map((row) => ({ ...row, ...summaryFor(row) })));
  });

  router.get('/:id', (req, res) => {
    const sheet = loadSheetForUser(db, 'travel_sheets', parseInt(req.params.id, 10), req);
    if (!sheet) {
      res.status(404).json({ error: 'Travel sheet not found' });
      return;
    }
    res.json(withTotals(sheet));
  });

  router.post('/', (req, res) => {
    const month = parseMonth(req.body ?? {});
    if (!month) {
      res.status(400).json({ error: 'A valid year and month are required' });
      return;
    }

    // Only a superuser may open a sheet on somebody else's behalf; everyone
    // else gets their own whatever they ask for.
    const askedFor = parseInt(String(req.body?.user_id ?? ''), 10);
    const userId = isSuperuser(req) && Number.isFinite(askedFor) ? askedFor : sessionUserId(req);

    const owner = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
    if (!owner) {
      res.status(400).json({ error: 'Unknown user' });
      return;
    }

    const id = openSheet(db, 'travel_sheets', userId, month.year, month.month);
    const sheet = loadSheetForUser(db, 'travel_sheets', id, req)!;
    res.status(201).json(withTotals(sheet));
  });

  router.put('/:id', (req, res) => {
    const sheet = loadSheetForUser(db, 'travel_sheets', parseInt(req.params.id, 10), req);
    if (!sheet) {
      res.status(404).json({ error: 'Travel sheet not found' });
      return;
    }

    const { notes, journeys } = req.body ?? {};

    const save = db.transaction(() => {
      if (notes !== undefined) {
        db.prepare('UPDATE travel_sheets SET notes = ? WHERE id = ?').run(notes ?? null, sheet.id);
      }

      if (journeys !== undefined) {
        // Replaced wholesale, as the report detail tables are: the form holds
        // the whole list, so reconciling row by row would only invent ways for
        // the two to disagree.
        db.prepare('DELETE FROM travel_journeys WHERE sheet_id = ?').run(sheet.id);
        const insert = db.prepare(
          `INSERT INTO travel_journeys
             (sheet_id, journey_date, customer_id, customer_name, job, from_location, to_location, miles, round_trip, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        (journeys as JourneyInput[]).forEach((journey, index) => {
          const customerId = toNumber(journey.customer_id);
          insert.run(
            sheet.id,
            journey.journey_date || null,
            customerId,
            journey.customer_name || null,
            journey.job || null,
            journey.from_location || null,
            journey.to_location || null,
            toNumber(journey.miles),
            journey.round_trip ? 1 : 0,
            index,
          );
        });
      }

      touchSheet(db, 'travel_sheets', sheet.id);
    });
    save();

    res.json(withTotals(loadSheetForUser(db, 'travel_sheets', sheet.id, req)!));
  });

  router.delete('/:id', (req, res) => {
    const sheet = loadSheetForUser(db, 'travel_sheets', parseInt(req.params.id, 10), req);
    if (!sheet) {
      res.status(404).json({ error: 'Travel sheet not found' });
      return;
    }
    // The journeys go with it through ON DELETE CASCADE.
    db.prepare('DELETE FROM travel_sheets WHERE id = ?').run(sheet.id);
    res.json({ ok: true });
  });

  return router;
}
