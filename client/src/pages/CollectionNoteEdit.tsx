import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import SignatureCanvas from 'react-signature-canvas';
import { api } from '../api';
import { QuickAddModal } from '../components/QuickAddModal';
import { useAuth } from '../App';
import type { Customer, CustomerSite, CollectionNoteItem, LookupValue } from '../types';

const DEFAULT_COMMENTS = 'COLLECTING ON BEHALF OF SB MATERIALS UK LTD';

// Product descriptions are held per report type, and the collection note draws
// on the same list the loading inspection uses rather than keeping one of its
// own, so that a description added in either place shows up in both.
const PRODUCT_DESCRIPTION_REPORT_TYPE = 'loading_inspection';

const emptyItem = (): CollectionNoteItem => ({
  quantity: '',
  description: '',
  nett_weight: '',
  collection_point: '',
});

// Builds the address block a customer or site selection derives for "Collect
// From": the customer name followed by the relevant address lines. Returns
// null when there is nothing to derive (no customer chosen yet).
function deriveCollectFrom(
  customerId: number | '',
  siteId: number | '',
  customers: Customer[],
  sites: CustomerSite[],
): string | null {
  if (!customerId) return null;
  const customer = customers.find((c) => c.id === customerId);
  if (!customer) return null;
  const site = siteId ? sites.find((s) => s.id === siteId) : undefined;
  const addressLines = site ? site.address : customer.address;
  return addressLines ? `${customer.name}\n${addressLines}` : customer.name;
}

// The description options offered for a line item: the product description
// lookup, plus whatever the item already holds if that is not in the list.
// Notes raised before the description became a dropdown carry free text, and
// selecting nothing must not quietly wipe it.
function descriptionOptions(lookups: LookupValue[], current: string | null): string[] {
  const values = lookups.map((l) => l.value);
  return current && !values.includes(current) ? [...values, current] : values;
}

export function CollectionNoteEdit() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isEdit = !!id;

  // Once a save has created the note, its id is remembered here so that a
  // retry (e.g. after a failed signature upload) updates the note that now
  // exists rather than attempting to create it again, which would trip the
  // server's unique-reference check and strand the user on the form.
  const [createdNoteId, setCreatedNoteId] = useState<number | null>(null);
  const effectiveId = id ? parseInt(id) : createdNoteId;
  const noteExists = isEdit || createdNoteId !== null;

  const [reference, setReference] = useState('');
  const [customerId, setCustomerId] = useState<number | ''>('');
  const [siteId, setSiteId] = useState<number | ''>('');
  const [collectFrom, setCollectFrom] = useState('');
  const [derivedCollectFrom, setDerivedCollectFrom] = useState('');
  const [comments, setComments] = useState(isEdit ? '' : DEFAULT_COMMENTS);
  const [contactName, setContactName] = useState(isEdit ? '' : user?.displayName || '');
  const [contactPhone, setContactPhone] = useState(isEdit ? '' : user?.phone || '');
  const [buyerReference, setBuyerReference] = useState('');
  const [minimumWeight, setMinimumWeight] = useState('');
  const [collectionDate, setCollectionDate] = useState(isEdit ? '' : new Date().toISOString().slice(0, 10));
  const [transportCompany, setTransportCompany] = useState('');
  const [items, setItems] = useState<CollectionNoteItem[]>([emptyItem()]);

  const [dispatchedSignedDate, setDispatchedSignedDate] = useState('');
  const [existingDispatchedSignature, setExistingDispatchedSignature] = useState<string | null>(null);
  const dispatchedSigRef = useRef<SignatureCanvas>(null);

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [sites, setSites] = useState<CustomerSite[]>([]);
  const [productDescriptions, setProductDescriptions] = useState<LookupValue[]>([]);
  // A product quick-add remembers which line item asked for it, so the new
  // description can be selected straight into that row.
  const [quickAdd, setQuickAdd] = useState<
    { type: 'customer' | 'site' } | { type: 'product'; itemIndex: number } | null
  >(null);

  const [referenceError, setReferenceError] = useState('');
  const [customerError, setCustomerError] = useState('');
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(isEdit);

  // Prefill the reference on a new note. Contact name/phone are prefilled
  // from useAuth() directly (see initial state above) rather than a
  // separate lookup, since the users API is superuser-only and a plain
  // inspector would otherwise never see their own phone number prefilled.
  useEffect(() => {
    if (isEdit) return;
    api.getNextCollectionNoteReference().then((r) => setReference(r.reference));
  }, [isEdit]);

  // Load customers and the product description list once.
  useEffect(() => {
    api.getCustomers().then(setCustomers);
    api.getLookups('lookup_product_descriptions', PRODUCT_DESCRIPTION_REPORT_TYPE).then(setProductDescriptions);
  }, []);

  // Load sites whenever the chosen customer changes.
  useEffect(() => {
    if (customerId) {
      api.getSites(customerId as number).then(setSites);
    } else {
      setSites([]);
    }
  }, [customerId]);

  // Snapshot the customer/site address into Collect From, but only when the
  // field is empty or still exactly equals the last value we derived - a
  // hand-edited address must never be silently overwritten.
  useEffect(() => {
    const derived = deriveCollectFrom(customerId, siteId, customers, sites);
    if (derived === null) return;
    setCollectFrom((current) => (current === '' || current === derivedCollectFrom ? derived : current));
    setDerivedCollectFrom(derived);
  }, [customerId, siteId, customers, sites]);

  // Load an existing note.
  useEffect(() => {
    if (!id) return;
    setLoading(true);
    api
      .getCollectionNote(parseInt(id))
      .then((note) => {
        setReference(note.reference);
        setCustomerId(note.customer_id);
        setSiteId(note.site_id ?? '');
        setCollectFrom(note.collect_from_address || '');
        setComments(note.comments || '');
        setContactName(note.contact_name || '');
        setContactPhone(note.contact_phone || '');
        setBuyerReference(note.buyer_reference || '');
        setMinimumWeight(note.minimum_weight || '');
        setCollectionDate(note.collection_date || '');
        setTransportCompany(note.transport_company || '');
        setDispatchedSignedDate(note.dispatched_signed_date || '');
        setExistingDispatchedSignature(note.dispatched_signature_path || null);
        setItems(note.items && note.items.length > 0 ? note.items : [emptyItem()]);
      })
      .finally(() => setLoading(false));
  }, [id]);

  const addItem = () => setItems((prev) => [...prev, emptyItem()]);
  const removeItem = (index: number) => setItems((prev) => prev.filter((_, i) => i !== index));
  const updateItem = (index: number, field: keyof CollectionNoteItem, value: string) => {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, [field]: value } : it)));
  };

  const handleSave = async () => {
    let hasError = false;
    setReferenceError('');
    setCustomerError('');
    setFormError('');
    if (!reference.trim()) {
      setReferenceError('A reference is required');
      hasError = true;
    }
    if (!customerId) {
      setCustomerError('A customer is required');
      hasError = true;
    }
    if (hasError) return;

    if (saving) return;
    setSaving(true);
    try {
      const data = {
        reference: reference.trim(),
        customer_id: customerId as number,
        site_id: siteId === '' ? null : siteId,
        collect_from_address: collectFrom || null,
        comments: comments || null,
        contact_name: contactName || null,
        contact_phone: contactPhone || null,
        buyer_reference: buyerReference || null,
        minimum_weight: minimumWeight || null,
        collection_date: collectionDate || null,
        transport_company: transportCompany || null,
        dispatched_signed_date: dispatchedSignedDate || null,
        items: items.map((it) => ({
          quantity: it.quantity || null,
          description: it.description || null,
          nett_weight: it.nett_weight || null,
          collection_point: it.collection_point || null,
        })),
      };

      let noteId: number;
      if (noteExists) {
        noteId = effectiveId!;
        await api.updateCollectionNote(noteId, data);
      } else {
        const result = await api.createCollectionNote(data);
        noteId = result.id;
        setCreatedNoteId(noteId);
      }

      if (dispatchedSigRef.current && !dispatchedSigRef.current.isEmpty()) {
        const blob = await fetch(dispatchedSigRef.current.toDataURL('image/png')).then((r) => r.blob());
        await api.uploadCollectionNoteSignature(noteId, 'dispatched', blob);
      }

      navigate('/collection-notes');
    } catch (err: any) {
      const message = err?.message || 'Save failed';
      if (/already in use/i.test(message) || /reference is required/i.test(message)) {
        setReferenceError(message);
      } else if (/customer is required/i.test(message)) {
        setCustomerError(message);
      } else {
        setFormError(message);
      }
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}>Loading...</div>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h2>{isEdit ? 'Edit Collection Note' : 'New Collection Note'}</h2>
        <button onClick={() => navigate('/collection-notes')} style={linkBtnStyle}>
          Back to Collection Notes
        </button>
      </div>

      {formError && <div style={errorBannerStyle}>{formError}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Section title="Note Details">
          <div style={formGrid}>
            <div>
              <label style={labelStyle} htmlFor="cn-reference">
                Reference
              </label>
              <input
                id="cn-reference"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                style={inputStyle}
              />
              {referenceError && <div style={fieldErrorStyle}>{referenceError}</div>}
            </div>
            <div>
              <label style={labelStyle} htmlFor="cn-customer">
                Customer
              </label>
              <div style={inputWithBtnRow}>
                <select
                  id="cn-customer"
                  value={customerId}
                  onChange={(e) => {
                    setCustomerId(parseInt(e.target.value) || '');
                    setSiteId('');
                  }}
                  style={{ ...inputStyle, flex: 1, minWidth: 0 }}
                >
                  <option value="">Select customer...</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <button type="button" onClick={() => setQuickAdd({ type: 'customer' })} style={addBtnStyle}>
                  +
                </button>
              </div>
              {customerError && <div style={fieldErrorStyle}>{customerError}</div>}
            </div>
            <div>
              <label style={labelStyle} htmlFor="cn-site">
                Site
              </label>
              <div style={inputWithBtnRow}>
                <select
                  id="cn-site"
                  value={siteId}
                  onChange={(e) => setSiteId(parseInt(e.target.value) || '')}
                  style={{ ...inputStyle, flex: 1, minWidth: 0 }}
                  disabled={!customerId}
                >
                  <option value="">Select site...</option>
                  {sites.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.address}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => customerId && setQuickAdd({ type: 'site' })}
                  disabled={!customerId}
                  style={addBtnStyle}
                >
                  +
                </button>
              </div>
            </div>
            <div>
              <label style={labelStyle} htmlFor="cn-collection-date">
                Date of Collection
              </label>
              <input
                id="cn-collection-date"
                type="date"
                value={collectionDate}
                onChange={(e) => setCollectionDate(e.target.value)}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle} htmlFor="cn-transport-company">
                Transport Company
              </label>
              <input
                id="cn-transport-company"
                value={transportCompany}
                onChange={(e) => setTransportCompany(e.target.value)}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle} htmlFor="cn-buyer-reference">
                Buyer Reference
              </label>
              <input
                id="cn-buyer-reference"
                value={buyerReference}
                onChange={(e) => setBuyerReference(e.target.value)}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle} htmlFor="cn-minimum-weight">
                Minimum Weight to be Loaded
              </label>
              <input
                id="cn-minimum-weight"
                value={minimumWeight}
                onChange={(e) => setMinimumWeight(e.target.value)}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle} htmlFor="cn-contact-name">
                Contact Name
              </label>
              <input
                id="cn-contact-name"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle} htmlFor="cn-contact-phone">
                Contact Phone
              </label>
              <input
                id="cn-contact-phone"
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                style={inputStyle}
              />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle} htmlFor="cn-collect-from">
                Collect From
              </label>
              <textarea
                id="cn-collect-from"
                value={collectFrom}
                onChange={(e) => setCollectFrom(e.target.value)}
                rows={3}
                style={{ ...inputStyle, resize: 'vertical' }}
              />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle} htmlFor="cn-comments">
                Comments
              </label>
              <textarea
                id="cn-comments"
                value={comments}
                onChange={(e) => setComments(e.target.value)}
                rows={3}
                style={{ ...inputStyle, resize: 'vertical' }}
              />
            </div>
          </div>
        </Section>

        <Section title="Items">
          {items.map((item, i) => (
            <div key={i} style={itemRowStyle}>
              <div style={{ flex: '0 0 100px' }}>
                <label style={labelStyle} htmlFor={`cn-item-qty-${i}`}>
                  Quantity
                </label>
                <input
                  id={`cn-item-qty-${i}`}
                  value={item.quantity || ''}
                  onChange={(e) => updateItem(i, 'quantity', e.target.value)}
                  style={inputStyle}
                />
              </div>
              <div style={{ flex: 2, minWidth: 200 }}>
                <label style={labelStyle} htmlFor={`cn-item-desc-${i}`}>
                  Description
                </label>
                <div style={inputWithBtnRow}>
                  <select
                    id={`cn-item-desc-${i}`}
                    value={item.description || ''}
                    onChange={(e) => updateItem(i, 'description', e.target.value)}
                    style={{ ...inputStyle, flex: 1, minWidth: 0 }}
                  >
                    <option value="">Select description...</option>
                    {descriptionOptions(productDescriptions, item.description).map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    aria-label="Add product description"
                    onClick={() => setQuickAdd({ type: 'product', itemIndex: i })}
                    style={addBtnStyle}
                  >
                    +
                  </button>
                </div>
              </div>
              <div style={{ flex: '0 0 130px' }}>
                <label style={labelStyle} htmlFor={`cn-item-nett-weight-${i}`}>
                  Nett Weight (kg)
                </label>
                <input
                  id={`cn-item-nett-weight-${i}`}
                  value={item.nett_weight || ''}
                  onChange={(e) => updateItem(i, 'nett_weight', e.target.value)}
                  style={inputStyle}
                />
              </div>
              <div style={{ flex: 1, minWidth: 140 }}>
                <label style={labelStyle} htmlFor={`cn-item-point-${i}`}>
                  Collection Point
                </label>
                <input
                  id={`cn-item-point-${i}`}
                  value={item.collection_point || ''}
                  onChange={(e) => updateItem(i, 'collection_point', e.target.value)}
                  style={inputStyle}
                />
              </div>
              <button
                type="button"
                aria-label="Remove item"
                onClick={() => removeItem(i)}
                style={{ ...linkBtnStyle, color: '#e74c3c', alignSelf: 'end' }}
              >
                Remove Item
              </button>
            </div>
          ))}
          <button type="button" onClick={addItem} style={primaryBtnStyle}>
            + Add Item
          </button>
        </Section>

        <Section title="Goods Dispatched">
          {existingDispatchedSignature && (
            <div style={{ marginBottom: 12 }}>
              <p style={{ fontSize: 13, color: '#666', marginBottom: 6 }}>Current signature:</p>
              <img
                src={api.getPhotoUrl(existingDispatchedSignature)}
                alt="Dispatched signature"
                style={{ maxWidth: 300, border: '1px solid #dde', borderRadius: 8 }}
              />
            </div>
          )}
          <div style={sigCanvasWrapStyle}>
            <SignatureCanvas
              ref={dispatchedSigRef}
              canvasProps={{ width: 500, height: 150, style: { maxWidth: '100%' } }}
            />
          </div>
          <div style={{ marginTop: 8, display: 'flex', gap: 16, alignItems: 'end', flexWrap: 'wrap' }}>
            <button type="button" onClick={() => dispatchedSigRef.current?.clear()} style={linkBtnStyle}>
              Clear
            </button>
            <div>
              <label style={labelStyle} htmlFor="cn-dispatched-date">
                Goods Dispatched Date
              </label>
              <input
                id="cn-dispatched-date"
                type="date"
                value={dispatchedSignedDate}
                onChange={(e) => setDispatchedSignedDate(e.target.value)}
                style={inputStyle}
              />
            </div>
          </div>
        </Section>

        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', padding: '20px 0' }}>
          <button onClick={() => navigate('/collection-notes')} style={linkBtnStyle}>
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving} style={primaryBtnStyle}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      <QuickAddModal
        open={quickAdd?.type === 'customer'}
        title="Add New Customer"
        label="Customer Name"
        onSave={async (name) => {
          const result = await api.createCustomer(name);
          setCustomers((prev) => [
            ...prev,
            { ...result, is_active: 1, contact_name: null, email: null, phone: null, address: null },
          ]);
          setCustomerId(result.id);
        }}
        onClose={() => setQuickAdd(null)}
      />
      <QuickAddModal
        open={quickAdd?.type === 'site'}
        title="Add New Site"
        label="Site Address"
        onSave={async (address) => {
          const result = await api.createSite(customerId as number, address);
          setSites((prev) => [...prev, result]);
          setSiteId(result.id);
        }}
        onClose={() => setQuickAdd(null)}
      />
      <QuickAddModal
        open={quickAdd?.type === 'product'}
        title="Add New Product Description"
        label="Product Description"
        onSave={async (value) => {
          const result = await api.createLookup('lookup_product_descriptions', {
            value,
            report_type: PRODUCT_DESCRIPTION_REPORT_TYPE,
          });
          setProductDescriptions((prev) => [...prev, result]);
          if (quickAdd?.type === 'product') updateItem(quickAdd.itemIndex, 'description', result.value);
        }}
        onClose={() => setQuickAdd(null)}
      />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        background: '#fff',
        borderRadius: 10,
        padding: '20px 24px',
        boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
      }}
    >
      <h3 style={{ marginBottom: 16, color: '#1a5276', fontSize: 16 }}>{title}</h3>
      {children}
    </div>
  );
}

const formGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
  gap: 16,
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  marginBottom: 6,
  fontWeight: 500,
  fontSize: 13,
  color: '#2c3e50',
};

const inputWithBtnRow: React.CSSProperties = {
  display: 'flex',
  gap: 6,
  alignItems: 'stretch',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '9px 12px',
  border: '1px solid #dde',
  borderRadius: 6,
  fontSize: 14,
  boxSizing: 'border-box',
};

const primaryBtnStyle: React.CSSProperties = {
  padding: '10px 24px',
  background: '#27ae60',
  color: '#fff',
  border: 'none',
  borderRadius: 8,
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
};

const linkBtnStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#2980b9',
  cursor: 'pointer',
  fontSize: 14,
  padding: '8px 16px',
};

const addBtnStyle: React.CSSProperties = {
  background: '#ebf5fb',
  border: '1px solid #2980b9',
  color: '#2980b9',
  borderRadius: 6,
  padding: '0 10px',
  cursor: 'pointer',
  fontSize: 15,
  fontWeight: 700,
  flexShrink: 0,
};

const errorBannerStyle: React.CSSProperties = {
  background: '#fdf0ef',
  border: '1px solid #e74c3c',
  color: '#c0392b',
  padding: '10px 14px',
  borderRadius: 8,
  marginBottom: 16,
  fontSize: 14,
};

const fieldErrorStyle: React.CSSProperties = {
  color: '#c0392b',
  fontSize: 12,
  marginTop: 4,
};

const itemRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 12,
  alignItems: 'end',
  flexWrap: 'wrap',
  marginBottom: 12,
  paddingBottom: 12,
  borderBottom: '1px solid #f0f0f0',
};

const sigCanvasWrapStyle: React.CSSProperties = {
  border: '2px solid #dde',
  borderRadius: 10,
  overflow: 'hidden',
  display: 'inline-block',
  background: '#fff',
};
