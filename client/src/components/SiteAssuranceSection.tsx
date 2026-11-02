import React from 'react';

const YES_NO_NA = ['YES', 'NO', 'N/A'];

export type SiteAssuranceField =
  | 'staff_training_packaging'
  | 'training_records_held'
  | 'waste_transfer_notes_sampled'
  | 'volume_increase_significant'
  | 'personnel_change_significant'
  | 'undercover_processing'
  | 'undercover_storage'
  | 'grades_segregated'
  | 'good_housekeeping'
  | 'hs_policy_provided'
  | 'felt_safe_on_site'
  | 'environmental_policy_provided';

export const SITE_ASSURANCE_QUESTIONS: { field: SiteAssuranceField; label: string }[] = [
  {
    field: 'staff_training_packaging',
    label: 'Training to staff on identifying packaging and non-packaging materials?',
  },
  { field: 'training_records_held', label: 'Records of training of staff?' },
  { field: 'waste_transfer_notes_sampled', label: 'Sample waste transfer notes seen?' },
  { field: 'volume_increase_significant', label: 'Any significant increase in volume processed by site?' },
  { field: 'personnel_change_significant', label: 'Any significant change in personnel?' },
  { field: 'undercover_processing', label: 'Undercover processing?' },
  { field: 'undercover_storage', label: 'Undercover storage?' },
  { field: 'grades_segregated', label: 'Grades clearly segregated?' },
  { field: 'good_housekeeping', label: 'Good general housekeeping?' },
  { field: 'hs_policy_provided', label: 'H&S policy provided?' },
  { field: 'felt_safe_on_site', label: 'Did you feel safe on site?' },
  { field: 'environmental_policy_provided', label: 'Environmental policy provided?' },
];

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

function RadioGroup({ options, value, onChange }: { options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt)}
          style={{
            padding: '6px 16px',
            borderRadius: 6,
            border: '2px solid',
            borderColor: value === opt ? '#2980b9' : '#dde',
            background: value === opt ? '#ebf5fb' : '#fff',
            color: value === opt ? '#2980b9' : '#666',
            fontWeight: value === opt ? 600 : 400,
            cursor: 'pointer',
            fontSize: 13,
          }}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

const formGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
  gap: 16,
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  marginBottom: 6,
  fontWeight: 500,
  fontSize: 13,
  color: '#2c3e50',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '9px 12px',
  border: '1px solid #dde',
  borderRadius: 6,
  fontSize: 14,
  boxSizing: 'border-box',
};

export function SiteAssuranceSection(props: {
  details: Record<string, any>;
  setDetails: (fn: (d: any) => any) => void;
  hidden: boolean;
  onHiddenChange: (hidden: boolean) => void;
}) {
  const { details, setDetails, hidden, onHiddenChange } = props;

  return (
    <Section title="Site Assurance">
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <input
          type="checkbox"
          aria-label="Site assurance not required for this customer"
          checked={hidden}
          onChange={(e) => onHiddenChange(e.target.checked)}
        />
        Site assurance not required for this customer
      </label>

      {!hidden && (
        <>
          <div style={formGrid}>
            {SITE_ASSURANCE_QUESTIONS.map(({ field, label }) => (
              <div key={field}>
                <label style={labelStyle}>{label}</label>
                <RadioGroup
                  options={YES_NO_NA}
                  value={details[field] || ''}
                  onChange={(v) => setDetails((d) => ({ ...d, [field]: v }))}
                />
              </div>
            ))}
          </div>
          <div style={{ maxWidth: 300, marginTop: 16 }}>
            <label style={labelStyle}>Last inspection date</label>
            <input
              type="date"
              aria-label="Last inspection date"
              value={details.last_inspection_date || ''}
              onChange={(e) => setDetails((d) => ({ ...d, last_inspection_date: e.target.value || null }))}
              style={inputStyle}
            />
          </div>
        </>
      )}
    </Section>
  );
}
