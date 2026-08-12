import Database from 'better-sqlite3';

export interface CollectionNoteItemRow {
  id: number;
  note_id: number;
  quantity: string | null;
  description: string | null;
  nett_weight: string | null;
  collection_point: string | null;
  sort_order: number;
}

export interface CollectionNoteRecord {
  id: number;
  reference: string;
  customer_id: number;
  site_id: number | null;
  collect_from_address: string | null;
  comments: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  buyer_reference: string | null;
  weight: string | null;
  minimum_weight: string | null;
  collection_date: string | null;
  transport_company: string | null;
  dispatched_signature_path: string | null;
  dispatched_signed_date: string | null;
  created_by_id: number | null;
  created_at: string;
  updated_at: string;
  customer_name: string;
  site_address: string | null;
  items: CollectionNoteItemRow[];
}

/**
 * Load a collection note with its customer name, site address, and line items.
 */
export function loadCollectionNote(db: Database.Database, id: number): CollectionNoteRecord | null {
  const note = db
    .prepare(
      `SELECT n.*, c.name AS customer_name, cs.address AS site_address
       FROM collection_notes n
       JOIN customers c ON n.customer_id = c.id
       LEFT JOIN customer_sites cs ON n.site_id = cs.id
       WHERE n.id = ?`,
    )
    .get(id) as Omit<CollectionNoteRecord, 'items'> | undefined;

  if (!note) return null;

  const items = db
    .prepare('SELECT * FROM collection_note_items WHERE note_id = ? ORDER BY sort_order')
    .all(id) as CollectionNoteItemRow[];

  return { ...note, items };
}
