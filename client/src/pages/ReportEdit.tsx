import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import SignatureCanvas from 'react-signature-canvas';
import { api } from '../api';
import { QuickAddModal } from '../components/QuickAddModal';
import { useAuth } from '../App';
import type {
  Customer,
  CustomerSite,
  LookupValue,
  ReportType,
  InspectionDetails,
  Container,
  PernDetails,
  ReportPhoto,
  UnwantedMaterial,
  Contaminant,
} from '../types';
import { REPORT_TYPE_LABELS } from '../types';

const YES_NO = ['YES', 'NO'];
const YES_NO_NA = ['YES', 'NO', 'N/A'];
const PACKAGING_THRESHOLDS = [
  'OCC exceeds 97.5%',
  'OCC exceeds 80%',
  'Fruitbox exceeds 97.5%',
  'Mixed Paper exceeds 34.5%',
  'HDPE exceeds 97.5%',
  'PET exceeds 97.5%',
  'Aluminium exceeds 97.5%',
];

export function ReportEdit() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isEdit = !!id;

  // Core fields
  const [reportType, setReportType] = useState<ReportType>('loading_inspection');
  const [customerId, setCustomerId] = useState<number | ''>('');
  const [siteId, setSiteId] = useState<number | ''>('');
  const [inspectionDate, setInspectionDate] = useState(new Date().toISOString().slice(0, 10));
  const [inspectionTime, setInspectionTime] = useState('');
  const [inspectorName, setInspectorName] = useState(user?.displayName || '');
  const [qualityScore, setQualityScore] = useState<number | ''>('');
  const [inspectionPassed, setInspectionPassed] = useState<string>('');
  const [otherInfo, setOtherInfo] = useState('');
  const [dateCompleted, setDateCompleted] = useState('');
  const [status, setStatus] = useState('draft');

  // Assignment
  const [assignedToId, setAssignedToId] = useState<number | ''>('');
  const [users, setUsers] = useState<{ id: number; display_name: string; is_active: number }[]>([]);

  // Inspection details
  const [details, setDetails] = useState<Partial<InspectionDetails>>({});
  const nextTempId = useRef(-1);

  // Unwanted materials & contaminants
  const [unwantedMaterials, setUnwantedMaterials] = useState<UnwantedMaterial[]>([]);
  const [contaminants, setContaminants] = useState<Contaminant[]>([]);
  const [unwantedOther, setUnwantedOther] = useState('');
  const [contaminantOther, setContaminantOther] = useState('');

  // Containers
  const [containers, setContainers] = useState<Container[]>([]);

  // PERN
  const [pern, setPern] = useState<Partial<PernDetails>>({});

  // Photos
  const [photos, setPhotos] = useState<ReportPhoto[]>([]);
  const [newPhotos, setNewPhotos] = useState<
    { file: File; label: string; containerId: number | null; previewUrl: string }[]
  >([]);

  // Signature
  const sigRef = useRef<SignatureCanvas>(null);
  const [existingSignature, setExistingSignature] = useState<string | null>(null);

  // Form errors
  const [formError, setFormError] = useState('');

  // On behalf of
  const [onBehalfOf, setOnBehalfOf] = useState('');
  const [clientOptions, setClientOptions] = useState<LookupValue[]>([]);

  // Lookups & references
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [sites, setSites] = useState<CustomerSite[]>([]);
  const [productDescs, setProductDescs] = useState<LookupValue[]>([]);
  const [productGrades, setProductGrades] = useState<LookupValue[]>([]);
  const [storageModes, setStorageModes] = useState<LookupValue[]>([]);
  const [unwantedOptions, setUnwantedOptions] = useState<LookupValue[]>([]);
  const [contaminantOptions, setContaminantOptions] = useState<LookupValue[]>([]);

  // Quick-add modals
  const [quickAdd, setQuickAdd] = useState<{ type: string; customerId?: number } | null>(null);

  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(isEdit);

  // Cleanup object URLs on unmount
  const newPhotosRef = useRef(newPhotos);
  newPhotosRef.current = newPhotos;
  useEffect(() => {
    return () => {
      newPhotosRef.current.forEach((p) => URL.revokeObjectURL(p.previewUrl));
    };
  }, []);

  // Load customers
  useEffect(() => {
    api.getCustomers().then(setCustomers);
  }, []);

  // Load assignable users (superuser only)
  useEffect(() => {
    if (user?.isSuperuser) {
      api.getUsers().then(setUsers).catch(() => setUsers([]));
    }
  }, [user]);

  // Load sites when customer changes, and auto-populate PERN contact info
  useEffect(() => {
    if (customerId) {
      api.getSites(customerId as number).then(setSites);

      // Auto-populate PERN company details from customer record (only on new reports or when changing customer)
      const cust = customers.find((c) => c.id === customerId);
      if (cust && !isEdit) {
        setPern((p) => ({
          ...p,
          company_name_address: p.company_name_address || cust.address || null,
          contact_name: p.contact_name || cust.contact_name || null,
          email: p.email || cust.email || null,
          phone: p.phone || cust.phone || null,
        }));
      }
    } else {
      setSites([]);
    }
  }, [customerId, customers]);

  // Load global lookups once on mount
  useEffect(() => {
    api.getLookups('lookup_clients').then(setClientOptions);
  }, []);

  // Load lookups when report type changes
  useEffect(() => {
    if (reportType === 'loading_inspection' || reportType === 'quarterly_pern') {
      api.getLookups('lookup_product_grades', reportType).then(setProductGrades);
      api.getLookups('lookup_unwanted_materials', reportType).then(setUnwantedOptions);
      api.getLookups('lookup_contaminants', reportType).then(setContaminantOptions);
      api.getLookups('lookup_storage_modes').then(setStorageModes);

      if (reportType === 'loading_inspection') {
        api.getLookups('lookup_product_descriptions', reportType).then(setProductDescs);
      }
    }
  }, [reportType]);

  // Load existing report
  useEffect(() => {
    if (!id) return;
    setLoading(true);
    api
      .getReport(parseInt(id))
      .then((report) => {
        setReportType(report.report_type);
        setCustomerId(report.customer_id);
        setSiteId(report.site_id);
        setInspectionDate(report.inspection_date);
        setInspectionTime(report.inspection_time || '');
        setInspectorName(report.inspector_name);
        setQualityScore(report.quality_score ?? '');
        setInspectionPassed(report.inspection_passed === 1 ? 'YES' : report.inspection_passed === 0 ? 'NO' : '');
        setOtherInfo(report.other_information || '');
        setDateCompleted(report.date_completed || '');
        setStatus(report.status);
        setAssignedToId(report.assigned_to_id ?? '');
        setOnBehalfOf(report.on_behalf_of || '');
        if (report.inspection_details) {
          const det = { ...report.inspection_details };
          if (typeof det.packaging_thresholds === 'string') {
            try {
              det.packaging_thresholds = JSON.parse(det.packaging_thresholds);
            } catch {
              det.packaging_thresholds = [];
            }
          }
          setDetails(det);
        }
        if (report.unwanted_materials) {
          const otherEntry = report.unwanted_materials.find((m) => m.material === 'Other');
          if (otherEntry?.notes) setUnwantedOther(otherEntry.notes);
          setUnwantedMaterials(report.unwanted_materials.filter((m) => m.material !== 'Other'));
        }
        if (report.contaminants) {
          const otherEntry = report.contaminants.find((c) => c.contaminant === 'Other');
          if (otherEntry?.notes) setContaminantOther(otherEntry.notes);
          setContaminants(report.contaminants.filter((c) => c.contaminant !== 'Other'));
        }
        if (report.containers) setContainers(report.containers);
        if (report.pern_details) {
          const pd = { ...report.pern_details };
          // Parse JSON arrays
          for (const key of [
            'site_type',
            'accreditations',
            'site_facilities',
            'waste_sources',
            'safety_equipment',
            'worker_recording',
            'training_types',
            'training_recording',
          ] as const) {
            if (typeof pd[key] === 'string') {
              try {
                (pd as any)[key] = JSON.parse(pd[key] as string);
              } catch {
                /* ignore parse errors */
              }
            }
          }
          setPern(pd);
        }
        if (report.photos) setPhotos(report.photos);
        if (report.signature_path) setExistingSignature(report.signature_path);
      })
      .finally(() => setLoading(false));
  }, [id]);

  const handleSave = async (overrideStatus?: string) => {
    if (!customerId || !siteId || !inspectionDate || !inspectorName) {
      setFormError('Please fill in all required fields (Customer, Site, Date, Inspector)');
      return;
    }
    setFormError('');

    setSaving(true);
    try {
      const data: any = {
        report_type: reportType,
        customer_id: customerId,
        site_id: siteId,
        inspection_date: inspectionDate,
        inspection_time: inspectionTime || null,
        inspector_name: inspectorName,
        quality_score: qualityScore || null,
        inspection_passed: inspectionPassed === 'YES' ? true : inspectionPassed === 'NO' ? false : null,
        other_information: otherInfo || null,
        date_completed: dateCompleted || null,
        status: overrideStatus || status,
        on_behalf_of: onBehalfOf || null,
        assigned_to_id: assignedToId === '' ? null : assignedToId,
      };

      if (reportType === 'loading_inspection' || reportType === 'quarterly_pern') {
        data.inspection_details = details;
        data.unwanted_materials = unwantedMaterials.map((m) => ({
          material: m.material,
          notes: m.notes,
        }));
        if (unwantedOther.trim()) {
          data.unwanted_materials.push({ material: 'Other', notes: unwantedOther.trim() });
        }
        data.contaminants = contaminants.map((c) => ({
          contaminant: c.contaminant,
          notes: c.notes,
        }));
        if (contaminantOther.trim()) {
          data.contaminants.push({ contaminant: 'Other', notes: contaminantOther.trim() });
        }
        if (reportType === 'loading_inspection') {
          data.containers = containers;
        }
      } else if (reportType === 'pern_audit') {
        data.pern_details = pern;
      }

      let reportId: number;
      let newContainerIds: number[] | undefined;
      if (isEdit) {
        const result = await api.updateReport(parseInt(id!), data);
        reportId = parseInt(id!);
        newContainerIds = result.containerIds;
      } else {
        const result = await api.createReport(data);
        reportId = result.id;
        newContainerIds = result.containerIds;
      }

      // Upload new photos - map temporary container IDs to real DB IDs
      if (newPhotos.length > 0) {
        const files = newPhotos.map((p) => p.file);
        const labels = newPhotos.map((p) => p.label);

        // Build mapping from old container IDs (including temp negatives) to new DB IDs
        const idMap = new Map<number, number>();
        if (newContainerIds?.length && data.containers?.length) {
          for (let ci = 0; ci < data.containers.length; ci++) {
            const oldId = containers[ci]?.id;
            if (oldId !== undefined && newContainerIds[ci]) {
              idMap.set(oldId, newContainerIds[ci]);
            }
          }
        }

        const containerIds = newPhotos.map((p) => {
          if (p.containerId === null) return null;
          // Map to new DB ID if available, otherwise use the existing ID (already a real DB ID)
          return idMap.get(p.containerId) ?? p.containerId;
        });
        await api.uploadPhotos(reportId, files, labels, containerIds);
      }

      // Upload signature
      if (sigRef.current && !sigRef.current.isEmpty()) {
        const dataUrl = sigRef.current.toDataURL('image/png');
        const blob = await fetch(dataUrl).then((r) => r.blob());
        await api.uploadSignature(reportId, blob);
      }

      navigate('/');
    } catch (err: any) {
      setFormError('Save failed: ' + (err.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async () => {
    await handleSave('assigned'); // persist current field values first
    if (id) {
      await api.submitReport(parseInt(id));
      navigate('/');
    }
  };

  const toggleUnwanted = (material: string) => {
    setUnwantedMaterials((prev) => {
      const exists = prev.find((m) => m.material === material);
      if (exists) return prev.filter((m) => m.material !== material);
      return [...prev, { material, notes: null }];
    });
  };

  const toggleContaminant = (contaminant: string) => {
    setContaminants((prev) => {
      const exists = prev.find((c) => c.contaminant === contaminant);
      if (exists) return prev.filter((c) => c.contaminant !== contaminant);
      return [...prev, { contaminant, notes: null }];
    });
  };

  const togglePackaging = (value: string) => {
    setDetails((d) => {
      const current = Array.isArray(d.packaging_thresholds) ? d.packaging_thresholds : [];
      const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
      return { ...d, packaging_thresholds: next };
    });
  };

  const addContainer = () => {
    const tempId = nextTempId.current--;
    setContainers((prev) => [
      ...prev,
      {
        id: tempId,
        container_number: '',
        seal_number: '',
        weight_info: '',
        number_of_bales: '',
        weighbridge_ticket: '',
        weight: '',
        sort_order: prev.length,
      },
    ]);
  };

  const updateContainer = (index: number, field: keyof Container, value: any) => {
    setContainers((prev) => prev.map((c, i) => (i === index ? { ...c, [field]: value } : c)));
  };

  const removeContainer = (index: number) => {
    setContainers((prev) => prev.filter((_, i) => i !== index));
  };

  const handlePhotoAdd = (e: React.ChangeEvent<HTMLInputElement>, containerId: number | null = null) => {
    const files = e.target.files;
    if (!files) return;
    const newFiles = Array.from(files).map((f) => ({
      file: f,
      label: '',
      containerId,
      previewUrl: URL.createObjectURL(f),
    }));
    setNewPhotos((prev) => [...prev, ...newFiles]);
    e.target.value = '';
  };

  const removeNewPhoto = (index: number) => {
    setNewPhotos((prev) => {
      URL.revokeObjectURL(prev[index].previewUrl);
      return prev.filter((_, i) => i !== index);
    });
  };

  const deleteExistingPhoto = async (photoId: number) => {
    await api.deletePhoto(photoId);
    setPhotos((prev) => prev.filter((p) => p.id !== photoId));
  };

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}>Loading...</div>;

  const packagingCheckboxes = (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {PACKAGING_THRESHOLDS.map((t) => {
        const checked = Array.isArray(details.packaging_thresholds) && details.packaging_thresholds.includes(t);
        return (
          <label
            key={t}
            style={{ ...checkboxLabel, background: checked ? '#ebf5fb' : '#f8f9fa', borderColor: checked ? '#2980b9' : '#dde' }}
          >
            <input type="checkbox" checked={!!checked} onChange={() => togglePackaging(t)} style={{ marginRight: 6 }} />
            {t}
          </label>
        );
      })}
    </div>
  );

  const isLoading = reportType === 'loading_inspection';
  const isQuarterly = reportType === 'quarterly_pern';
  const isInspection = isLoading || isQuarterly;
  const isPern = reportType === 'pern_audit';

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h2>{isEdit ? 'Edit Report' : 'New Report'}</h2>
        <button onClick={() => navigate('/')} style={linkBtnStyle}>
          Back to Reports
        </button>
      </div>

      {formError && (
        <div
          style={{
            background: '#fdf0ef',
            border: '1px solid #e74c3c',
            color: '#c0392b',
            padding: '10px 14px',
            borderRadius: 8,
            marginBottom: 16,
            fontSize: 14,
          }}
        >
          {formError}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Report Type */}
        <Section title="Report Type">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {(Object.entries(REPORT_TYPE_LABELS) as [ReportType, string][]).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setReportType(key)}
                style={{
                  padding: '10px 20px',
                  borderRadius: 8,
                  border: '2px solid',
                  borderColor: reportType === key ? '#2980b9' : '#dde',
                  background: reportType === key ? '#ebf5fb' : '#fff',
                  color: reportType === key ? '#2980b9' : '#666',
                  fontWeight: reportType === key ? 700 : 400,
                  cursor: 'pointer',
                  fontSize: 14,
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </Section>

        {/* Common Header */}
        <Section title="Inspection Details">
          <div style={formGrid}>
            <div>
              <label style={labelStyle}>Customer *</label>
              <div style={inputWithBtnRow}>
                <select
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
            </div>
            <div>
              <label style={labelStyle}>Site Address *</label>
              <div style={inputWithBtnRow}>
                <select
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
                  onClick={() => customerId && setQuickAdd({ type: 'site', customerId: customerId as number })}
                  disabled={!customerId}
                  style={addBtnStyle}
                >
                  +
                </button>
              </div>
            </div>
            <div>
              <label style={labelStyle}>Date of Inspection *</label>
              <input
                type="date"
                value={inspectionDate}
                onChange={(e) => setInspectionDate(e.target.value)}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Time of Inspection</label>
              <input
                type="time"
                value={inspectionTime}
                onChange={(e) => setInspectionTime(e.target.value)}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Inspector Name *</label>
              <input value={inspectorName} onChange={(e) => setInspectorName(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Status</label>
              <select value={status} onChange={(e) => setStatus(e.target.value)} style={inputStyle}>
                <option value="draft">Draft</option>
                <option value="completed">Completed</option>
              </select>
            </div>
            {user?.isSuperuser && (
              <div>
                <label style={labelStyle}>Assign To</label>
                <select
                  value={assignedToId}
                  onChange={(e) => setAssignedToId(parseInt(e.target.value) || '')}
                  style={inputStyle}
                >
                  <option value="">Unassigned (I'll complete it)</option>
                  {users
                    .filter((u) => u.is_active)
                    .map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.display_name}
                      </option>
                    ))}
                </select>
              </div>
            )}
            {isInspection && (
              <div>
                <label style={labelStyle}>On Behalf Of</label>
                <div style={inputWithBtnRow}>
                  <select
                    value={onBehalfOf}
                    onChange={(e) => setOnBehalfOf(e.target.value)}
                    style={{ ...inputStyle, flex: 1, minWidth: 0 }}
                  >
                    <option value="">Select client...</option>
                    {clientOptions.map((c) => (
                      <option key={c.id} value={c.value}>
                        {c.value}
                      </option>
                    ))}
                  </select>
                  <button type="button" onClick={() => setQuickAdd({ type: 'on_behalf_of' })} style={addBtnStyle}>
                    +
                  </button>
                </div>
              </div>
            )}
          </div>
        </Section>

        {/* Inspection-specific fields */}
        {isInspection && (
          <>
            <Section title="Product Details">
              <div style={formGrid}>
                {isLoading && (
                  <div>
                    <label style={labelStyle}>Product Description</label>
                    <select
                      value={details.product_description || ''}
                      onChange={(e) => setDetails((d) => ({ ...d, product_description: e.target.value || null }))}
                      style={inputStyle}
                    >
                      <option value="">Select...</option>
                      {productDescs.map((p) => (
                        <option key={p.id} value={p.value}>
                          {p.value}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div>
                  <label style={labelStyle}>Product Grade</label>
                  <select
                    value={details.product_grade || ''}
                    onChange={(e) => setDetails((d) => ({ ...d, product_grade: e.target.value || null }))}
                    style={inputStyle}
                  >
                    <option value="">Select...</option>
                    {productGrades.map((p) => (
                      <option key={p.id} value={p.value}>
                        {p.value}
                      </option>
                    ))}
                  </select>
                </div>
                {isInspection && (
                  <div>
                    <label style={labelStyle}>Mode of Storage</label>
                    <select
                      value={details.mode_of_storage || ''}
                      onChange={(e) => setDetails((d) => ({ ...d, mode_of_storage: e.target.value || null }))}
                      style={inputStyle}
                    >
                      <option value="">Select...</option>
                      {storageModes.map((s) => (
                        <option key={s.id} value={s.value}>
                          {s.value}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {isInspection && (
                  <>
                    <div>
                      <label style={labelStyle}>Moisture Reading Low</label>
                      <input
                        value={details.moisture_reading_low || ''}
                        onChange={(e) => setDetails((d) => ({ ...d, moisture_reading_low: e.target.value || null }))}
                        style={inputStyle}
                        placeholder="e.g. 9.3%"
                      />
                    </div>
                    <div>
                      <label style={labelStyle}>Moisture Reading High</label>
                      <input
                        value={details.moisture_reading_high || ''}
                        onChange={(e) => setDetails((d) => ({ ...d, moisture_reading_high: e.target.value || null }))}
                        style={inputStyle}
                        placeholder="e.g. 14.2%"
                      />
                    </div>
                  </>
                )}
                {isLoading && (
                  <div>
                    <label style={labelStyle}>Stock & Bale Count</label>
                    <input
                      value={details.stock_bale_count || ''}
                      onChange={(e) => setDetails((d) => ({ ...d, stock_bale_count: e.target.value || null }))}
                      style={inputStyle}
                    />
                  </div>
                )}
                {isLoading && (
                  <div>
                    <label style={labelStyle}>Rejected Bales</label>
                    <input
                      value={details.rejected_bales || ''}
                      onChange={(e) => setDetails((d) => ({ ...d, rejected_bales: e.target.value || null }))}
                      style={inputStyle}
                    />
                  </div>
                )}
                {isLoading && (
                  <>
                    <div>
                      <label style={labelStyle}>Loading Reference</label>
                      <input
                        value={details.loading_reference || ''}
                        onChange={(e) => setDetails((d) => ({ ...d, loading_reference: e.target.value || null }))}
                        style={inputStyle}
                      />
                    </div>
                    <div>
                      <label style={labelStyle}>Number of Containers</label>
                      <input
                        type="number"
                        value={details.number_of_containers || ''}
                        onChange={(e) =>
                          setDetails((d) => ({ ...d, number_of_containers: parseInt(e.target.value) || null }))
                        }
                        style={inputStyle}
                      />
                    </div>
                    <div>
                      <label style={labelStyle}>Moisture Readings</label>
                      <input
                        value={details.moisture_readings || ''}
                        onChange={(e) => setDetails((d) => ({ ...d, moisture_readings: e.target.value || null }))}
                        style={inputStyle}
                        placeholder="N/A"
                      />
                    </div>
                    <div>
                      <label style={labelStyle}>Radiation Reading</label>
                      <input
                        value={details.radiation_reading || ''}
                        onChange={(e) => setDetails((d) => ({ ...d, radiation_reading: e.target.value || null }))}
                        style={inputStyle}
                        placeholder="N/A"
                      />
                    </div>
                  </>
                )}
              </div>
            </Section>

            {/* Unwanted Materials */}
            <Section title="Unwanted Materials">
              <p style={{ fontSize: 13, color: '#7f8c8d', marginBottom: 10 }}>
                Items not included in the grade being inspected - select all that apply
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {unwantedOptions.map((opt) => {
                  const checked = unwantedMaterials.some((m) => m.material === opt.value);
                  return (
                    <label
                      key={opt.id}
                      style={{
                        ...checkboxLabel,
                        background: checked ? '#ebf5fb' : '#f8f9fa',
                        borderColor: checked ? '#2980b9' : '#dde',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleUnwanted(opt.value)}
                        style={{ marginRight: 6 }}
                      />
                      {opt.value}
                    </label>
                  );
                })}
              </div>
              <div style={{ marginTop: 10 }}>
                <label style={labelStyle}>Other / Notes</label>
                <input
                  value={unwantedOther}
                  onChange={(e) => setUnwantedOther(e.target.value)}
                  style={inputStyle}
                  placeholder="Additional details..."
                />
              </div>
            </Section>

            {/* Contaminants */}
            <Section title="Contaminants">
              <p style={{ fontSize: 13, color: '#e74c3c', marginBottom: 10, fontWeight: 500 }}>
                If any medical or hazardous waste is found, STOP inspection and call buyer
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {contaminantOptions.map((opt) => {
                  const checked = contaminants.some((c) => c.contaminant === opt.value);
                  return (
                    <label
                      key={opt.id}
                      style={{
                        ...checkboxLabel,
                        background: checked ? '#fdf2e9' : '#f8f9fa',
                        borderColor: checked ? '#e67e22' : '#dde',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleContaminant(opt.value)}
                        style={{ marginRight: 6 }}
                      />
                      {opt.value}
                    </label>
                  );
                })}
              </div>
              <div style={{ marginTop: 10 }}>
                <label style={labelStyle}>Other / Notes</label>
                <input
                  value={contaminantOther}
                  onChange={(e) => setContaminantOther(e.target.value)}
                  style={inputStyle}
                  placeholder="Additional details..."
                />
              </div>
            </Section>

            {/* Compliance Questions */}
            <Section title="Compliance">
              <div style={formGrid}>
                <div>
                  <label style={labelStyle}>Does material originate in UK?</label>
                  <RadioGroup
                    options={YES_NO}
                    value={details.material_originates_uk || ''}
                    onChange={(v) => setDetails((d) => ({ ...d, material_originates_uk: v }))}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Supplier aware of PERN?</label>
                  <RadioGroup
                    options={YES_NO}
                    value={details.supplier_aware_pern || ''}
                    onChange={(v) => setDetails((d) => ({ ...d, supplier_aware_pern: v }))}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Supplier controls volume?</label>
                  <RadioGroup
                    options={YES_NO}
                    value={details.supplier_controls_volume || ''}
                    onChange={(v) => setDetails((d) => ({ ...d, supplier_controls_volume: v }))}
                  />
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={labelStyle}>Volume consistency notes</label>
                  <input
                    value={details.volume_consistency_notes || ''}
                    onChange={(e) => setDetails((d) => ({ ...d, volume_consistency_notes: e.target.value || null }))}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Site buys pre-baled material?</label>
                  <RadioGroup
                    options={YES_NO_NA}
                    value={details.site_buys_prebaled || ''}
                    onChange={(v) => setDetails((d) => ({ ...d, site_buys_prebaled: v }))}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Pre-baled UK assurance</label>
                  <input
                    value={details.prebaled_uk_assurance || ''}
                    onChange={(e) => setDetails((d) => ({ ...d, prebaled_uk_assurance: e.target.value || null }))}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Site aware of non-UK material?</label>
                  <RadioGroup
                    options={YES_NO}
                    value={details.site_aware_non_uk || ''}
                    onChange={(v) => setDetails((d) => ({ ...d, site_aware_non_uk: v }))}
                  />
                </div>
              </div>
            </Section>

            {isLoading && (
              <Section title="Packaging Content">
                {packagingCheckboxes}
              </Section>
            )}

            {isQuarterly && (
              <Section title="Bale Break">
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <input
                    type="checkbox"
                    aria-label="Bale break performed?"
                    checked={details.bale_break === 1}
                    onChange={(e) => setDetails((d) => ({ ...d, bale_break: e.target.checked ? 1 : 0 }))}
                  />
                  Bale break performed?
                </label>
                {details.bale_break === 1 && (
                  <>
                    <div style={{ marginBottom: 12 }}>
                      <label style={labelStyle}>Bale Break Results</label>
                      <textarea
                        value={details.bale_break_results || ''}
                        onChange={(e) =>
                          setDetails((d) => ({ ...d, bale_break_results: e.target.value || null }))
                        }
                        style={{ ...inputStyle, minHeight: 60 }}
                      />
                    </div>
                    <label style={labelStyle}>Packaging Content</label>
                    {packagingCheckboxes}
                  </>
                )}
              </Section>
            )}

            {/* Quality Score */}
            <Section title="Quality & Result">
              <div style={formGrid}>
                <div>
                  <label style={labelStyle}>Quality Score (1 = poor, 5 = excellent)</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button
                        key={n}
                        onClick={() => setQualityScore(n)}
                        style={{
                          width: 44,
                          height: 44,
                          borderRadius: 8,
                          border: '2px solid',
                          borderColor: qualityScore === n ? '#2980b9' : '#dde',
                          background: qualityScore === n ? '#2980b9' : '#fff',
                          color: qualityScore === n ? '#fff' : '#666',
                          fontWeight: 700,
                          fontSize: 16,
                          cursor: 'pointer',
                        }}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label style={labelStyle}>Inspection Passed?</label>
                  <RadioGroup options={YES_NO} value={inspectionPassed} onChange={setInspectionPassed} />
                </div>
              </div>
            </Section>

            {/* Containers (loading inspection only) */}
            {isLoading && (
              <Section title="Containers">
                {containers.map((c, i) => (
                  <div
                    key={i}
                    style={{
                      border: '1px solid #dde',
                      borderRadius: 10,
                      padding: 16,
                      marginBottom: 12,
                      background: '#f8f9fa',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: 12,
                      }}
                    >
                      <h4 style={{ margin: 0 }}>Container {i + 1}</h4>
                      <button onClick={() => removeContainer(i)} style={{ ...linkBtnStyle, color: '#e74c3c' }}>
                        Remove
                      </button>
                    </div>
                    <div style={formGrid}>
                      <div>
                        <label style={labelStyle}>Container Number</label>
                        <input
                          value={c.container_number || ''}
                          onChange={(e) => updateContainer(i, 'container_number', e.target.value)}
                          style={inputStyle}
                          placeholder="e.g. MSBU8742190"
                        />
                      </div>
                      <div>
                        <label style={labelStyle}>Seal Number</label>
                        <input
                          value={c.seal_number || ''}
                          onChange={(e) => updateContainer(i, 'seal_number', e.target.value)}
                          style={inputStyle}
                        />
                      </div>
                      <div>
                        <label style={labelStyle}>No. of Bales</label>
                        <input
                          value={c.number_of_bales || ''}
                          onChange={(e) => updateContainer(i, 'number_of_bales', e.target.value)}
                          style={inputStyle}
                          placeholder="e.g. 32 Bales"
                        />
                      </div>
                      <div>
                        <label style={labelStyle}>Weighbridge Ticket</label>
                        <input
                          value={c.weighbridge_ticket || ''}
                          onChange={(e) => updateContainer(i, 'weighbridge_ticket', e.target.value)}
                          style={inputStyle}
                          placeholder="e.g. 786371"
                        />
                      </div>
                      <div>
                        <label style={labelStyle}>Weight</label>
                        <input
                          value={c.weight || ''}
                          onChange={(e) => updateContainer(i, 'weight', e.target.value)}
                          style={inputStyle}
                          placeholder="e.g. 19.04 Tonnes"
                        />
                      </div>
                    </div>
                    {/* Container photos */}
                    <div style={{ marginTop: 12 }}>
                      <label style={labelStyle}>Container Photos</label>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                        {photos
                          .filter((p) => p.container_id === c.id)
                          .map((p) => (
                            <div key={p.id} style={photoThumbStyle}>
                              <img
                                src={api.getPhotoUrl(p.file_path)}
                                alt={p.photo_label || ''}
                                style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 6 }}
                              />
                              <span style={{ fontSize: 11 }}>{p.photo_label || ''}</span>
                              <button onClick={() => deleteExistingPhoto(p.id)} style={photoRemoveBtn}>
                                ×
                              </button>
                            </div>
                          ))}
                        {newPhotos.map((p, idx) =>
                          p.containerId === c.id ? (
                            <div key={`new-${idx}`} style={photoThumbStyle}>
                              <img
                                src={p.previewUrl}
                                alt=""
                                style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 6 }}
                              />
                              <input
                                value={p.label}
                                onChange={(e) => {
                                  const updated = [...newPhotos];
                                  updated[idx] = { ...p, label: e.target.value };
                                  setNewPhotos(updated);
                                }}
                                placeholder="Label"
                                style={{ ...inputStyle, padding: '4px 6px', fontSize: 11, width: 80 }}
                              />
                              <button onClick={() => removeNewPhoto(idx)} style={photoRemoveBtn}>
                                ×
                              </button>
                            </div>
                          ) : null,
                        )}
                      </div>
                      <label style={{ ...addBtnStyle, display: 'inline-block', cursor: 'pointer' }}>
                        + Add Photos
                        <input
                          type="file"
                          accept="image/*"
                          multiple
                          onChange={(e) => handlePhotoAdd(e, c.id!)}
                          style={{ display: 'none' }}
                        />
                      </label>
                      <label style={{ ...addBtnStyle, display: 'inline-block', cursor: 'pointer', marginLeft: 8 }}>
                        Camera
                        <input
                          type="file"
                          accept="image/*"
                          capture="environment"
                          onChange={(e) => handlePhotoAdd(e, c.id!)}
                          style={{ display: 'none' }}
                        />
                      </label>
                    </div>
                  </div>
                ))}
                <button onClick={addContainer} style={primaryBtnStyle}>
                  + Add Container
                </button>
              </Section>
            )}
          </>
        )}

        {/* PERN Audit Form */}
        {isPern && <PernAuditSection pern={pern} setPern={setPern} />}

        {/* General Photos */}
        <Section title="Photos">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
            {photos
              .filter((p) => !p.container_id)
              .map((p) => (
                <div key={p.id} style={photoThumbStyle}>
                  <img
                    src={api.getPhotoUrl(p.file_path)}
                    alt={p.photo_label || ''}
                    style={{ width: 100, height: 100, objectFit: 'cover', borderRadius: 6 }}
                  />
                  <span style={{ fontSize: 11 }}>{p.photo_label || ''}</span>
                  <button onClick={() => deleteExistingPhoto(p.id)} style={photoRemoveBtn}>
                    ×
                  </button>
                </div>
              ))}
            {newPhotos.map((p, idx) =>
              p.containerId === null ? (
                <div key={`new-${idx}`} style={photoThumbStyle}>
                  <img
                    src={p.previewUrl}
                    alt=""
                    style={{ width: 100, height: 100, objectFit: 'cover', borderRadius: 6 }}
                  />
                  <input
                    value={p.label}
                    onChange={(e) => {
                      const updated = [...newPhotos];
                      updated[idx] = { ...p, label: e.target.value };
                      setNewPhotos(updated);
                    }}
                    placeholder="Label (e.g. Stock, Row 1)"
                    style={{ ...inputStyle, padding: '4px 6px', fontSize: 12, width: 100 }}
                  />
                  <button onClick={() => removeNewPhoto(idx)} style={photoRemoveBtn}>
                    ×
                  </button>
                </div>
              ) : null,
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <label style={{ ...primaryBtnStyle, display: 'inline-block', cursor: 'pointer', background: '#3498db' }}>
              + Upload Photos
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={(e) => handlePhotoAdd(e)}
                style={{ display: 'none' }}
              />
            </label>
            <label style={{ ...primaryBtnStyle, display: 'inline-block', cursor: 'pointer', background: '#3498db' }}>
              Camera
              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(e) => handlePhotoAdd(e)}
                style={{ display: 'none' }}
              />
            </label>
          </div>
        </Section>

        {/* Other Information */}
        <Section title="Other Information">
          <textarea
            value={otherInfo}
            onChange={(e) => setOtherInfo(e.target.value)}
            rows={4}
            style={{ ...inputStyle, resize: 'vertical' }}
            placeholder="Additional notes or observations..."
          />
        </Section>

        {/* Signature */}
        <Section title="Signature">
          {existingSignature && (
            <div style={{ marginBottom: 12 }}>
              <p style={{ fontSize: 13, color: '#666', marginBottom: 6 }}>Current signature:</p>
              <img
                src={api.getPhotoUrl(existingSignature)}
                alt="Signature"
                style={{ maxWidth: 300, border: '1px solid #dde', borderRadius: 8 }}
              />
            </div>
          )}
          <p style={{ fontSize: 13, color: '#666', marginBottom: 8 }}>Draw new signature below:</p>
          <div
            style={{
              border: '2px solid #dde',
              borderRadius: 10,
              overflow: 'hidden',
              display: 'inline-block',
              background: '#fff',
            }}
          >
            <SignatureCanvas
              ref={sigRef}
              canvasProps={{ width: 500, height: 150, style: { maxWidth: '100%' } }}
              onEnd={() => {}}
            />
          </div>
          <div style={{ marginTop: 8 }}>
            <button
              onClick={() => {
                sigRef.current?.clear();
              }}
              style={linkBtnStyle}
            >
              Clear Signature
            </button>
          </div>
        </Section>

        {/* Date Completed */}
        <Section title="Completion">
          <div style={{ maxWidth: 300 }}>
            <label style={labelStyle}>Date Completed</label>
            <input
              type="date"
              value={dateCompleted}
              onChange={(e) => setDateCompleted(e.target.value)}
              style={inputStyle}
            />
          </div>
        </Section>

        {/* Save buttons */}
        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', padding: '20px 0' }}>
          <button onClick={() => navigate('/')} style={linkBtnStyle}>
            Cancel
          </button>
          <button
            onClick={() => {
              setStatus('draft');
              handleSave('draft');
            }}
            disabled={saving}
            style={{ ...primaryBtnStyle, background: '#95a5a6' }}
          >
            Save as Draft
          </button>
          {assignedToId !== '' && (
            <button
              onClick={() => {
                setStatus('assigned');
                handleSave('assigned');
              }}
              disabled={saving}
              style={{ ...primaryBtnStyle, background: '#8e44ad' }}
            >
              Save &amp; Assign
            </button>
          )}
          {isEdit && status === 'assigned' && (
            <button onClick={handleSubmit} disabled={saving} style={{ ...primaryBtnStyle, background: '#27ae60' }}>
              {saving ? 'Submitting...' : 'Submit'}
            </button>
          )}
          <button
            onClick={() => {
              setStatus('completed');
              handleSave('completed');
            }}
            disabled={saving}
            style={primaryBtnStyle}
          >
            {saving ? 'Saving...' : 'Save & Complete'}
          </button>
        </div>
      </div>

      {/* Quick-add modals */}
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
          const result = await api.createSite(quickAdd!.customerId!, address);
          setSites((prev) => [...prev, result]);
          setSiteId(result.id);
        }}
        onClose={() => setQuickAdd(null)}
      />
      <QuickAddModal
        open={quickAdd?.type === 'on_behalf_of'}
        title="Add Client"
        label="Company Name"
        onSave={async (value) => {
          const result = await api.createLookup('lookup_clients', { value });
          setClientOptions((prev) => [...prev, result]);
          setOnBehalfOf(result.value);
        }}
        onClose={() => setQuickAdd(null)}
      />
    </div>
  );
}

// PERN Audit Section
function PernAuditSection({
  pern,
  setPern,
}: {
  pern: Partial<PernDetails>;
  setPern: React.Dispatch<React.SetStateAction<Partial<PernDetails>>>;
}) {
  const updateField = (field: keyof PernDetails, value: any) => {
    setPern((p) => ({ ...p, [field]: value }));
  };

  const toggleArrayField = (field: keyof PernDetails, value: string) => {
    setPern((p) => {
      const current = (p[field] as string[] | undefined) || [];
      const exists = current.includes(value);
      return { ...p, [field]: exists ? current.filter((v) => v !== value) : [...current, value] };
    });
  };

  const siteTypes = ['MRF', 'RECYCLING CENTER', 'TRANSFER STATION', 'WASTE PROCESSOR', 'OTHER'];
  const accreditations = ['ISO14001', 'ISO9001', 'ISO45001', 'EMAS', 'Other'];
  const siteFacilities = [
    'UNDERCOVER STORAGE',
    'OUTSIDE STORAGE',
    'CONCRETE SURFACE',
    'WEIGHBRIDGE',
    'PALLET SCALES',
    'LOADING BUCKET',
    'GRAB',
    'FORKLIFT TRUCK',
    'CLAMP TRUCK',
    'BALER(S)',
    'SHREDDERS',
    'LOADING RAMP OR DOCK',
    'CONVEYORS',
    'PICKING LINES',
    'OPTICAL SORTING',
    'EDDY CURRENT SEPARATOR',
    'OVERBAND MAGNETS',
    'BAG SPLITERS',
    'TELEHANDLERS',
    'BOBCATS',
  ];
  const wasteSources = ['LOCAL AUTHORITY', 'COMMERCIAL & INDUSTRIAL', 'RETAIL'];
  const safetyEquipment = [
    'SMOKE DETECTION',
    'CLEAR FIRE EXITS',
    'HEAT SENSOR',
    'SPRINKLERS SYSTEM/DOUSING SYSTEM',
    'CLEAR PEDESTRIAN WALKWAYS',
    'CLEAR SIGNAGE',
    'WASTE PILE SEPARATION',
    'IN DATE FIRE EXTINGUISHERS',
    'FIRST AID KITS',
  ];
  const workerRecording = ['MANUAL BOOKING IN SHEET', 'CLOCKING ON MACHINE', 'BIOMETRICS', 'NO SYSTEM IN PLACE'];
  const trainingTypes = [
    'TOOL BOX TALKS',
    'SUPERVISION',
    'ON THE JOB TRAINING',
    'CONTINUATION TRAINING',
    'THIRD PARTY COURSES AND QUALIFICATIONS',
    'INTERNAL COURSES',
  ];
  const trainingRecording = ['HARD COPIES', 'ONLINE', '3RD PARTY COMPANY'];

  return (
    <>
      <Section title="Introductory Letter">
        <label style={labelStyle}>Introductory Letter</label>
        <textarea
          value={pern.intro_letter || ''}
          onChange={(e) => updateField('intro_letter', e.target.value || null)}
          rows={5}
          style={{ ...inputStyle, resize: 'vertical' }}
          placeholder="Enter the introductory letter text for the PERN audit PDF..."
        />
      </Section>
      <Section title="Company Details">
        <div style={formGrid}>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={labelStyle}>Company Name & Address</label>
            <input
              value={pern.company_name_address || ''}
              onChange={(e) => updateField('company_name_address', e.target.value || null)}
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Contact Name</label>
            <input
              value={pern.contact_name || ''}
              onChange={(e) => updateField('contact_name', e.target.value || null)}
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Email</label>
            <input
              type="email"
              value={pern.email || ''}
              onChange={(e) => updateField('email', e.target.value || null)}
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Phone</label>
            <input
              value={pern.phone || ''}
              onChange={(e) => updateField('phone', e.target.value || null)}
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Grades Supplied</label>
            <input
              value={pern.grades_supplied || ''}
              onChange={(e) => updateField('grades_supplied', e.target.value || null)}
              style={inputStyle}
            />
          </div>
        </div>
      </Section>

      <Section title="Site Information">
        <div style={formGrid}>
          <div>
            <label style={labelStyle}>Number of Workers</label>
            <input
              value={pern.num_workers || ''}
              onChange={(e) => updateField('num_workers', e.target.value || null)}
              style={inputStyle}
            />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={labelStyle}>Type of Site</label>
            <CheckboxGroup
              options={siteTypes}
              selected={(pern.site_type as string[]) || []}
              onChange={(v) => toggleArrayField('site_type', v)}
            />
          </div>
          <div>
            <label style={labelStyle}>Safety inducted on arrival?</label>
            <RadioGroup
              options={['YES', 'NO']}
              value={pern.safety_inducted || ''}
              onChange={(v) => updateField('safety_inducted', v)}
            />
          </div>
          <div>
            <label style={labelStyle}>Materials handled on site</label>
            <input
              value={pern.materials_handled || ''}
              onChange={(e) => updateField('materials_handled', e.target.value || null)}
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>PRN/PERN accredited?</label>
            <RadioGroup
              options={['YES', 'NO']}
              value={pern.prn_accredited || ''}
              onChange={(v) => updateField('prn_accredited', v)}
            />
          </div>
          <div>
            <label style={labelStyle}>PRN Numbers</label>
            <input
              value={pern.prn_numbers || ''}
              onChange={(e) => updateField('prn_numbers', e.target.value || null)}
              style={inputStyle}
            />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={labelStyle}>Permits / Licences</label>
            <textarea
              value={pern.permits_licences || ''}
              onChange={(e) => updateField('permits_licences', e.target.value || null)}
              rows={2}
              style={{ ...inputStyle, resize: 'vertical' }}
            />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={labelStyle}>Third Party Accreditations</label>
            <CheckboxGroup
              options={accreditations}
              selected={(pern.accreditations as string[]) || []}
              onChange={(v) => toggleArrayField('accreditations', v)}
            />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={labelStyle}>Site Facilities</label>
            <CheckboxGroup
              options={siteFacilities}
              selected={(pern.site_facilities as string[]) || []}
              onChange={(v) => toggleArrayField('site_facilities', v)}
            />
          </div>
          <div>
            <label style={labelStyle}>Size of Area</label>
            <input
              value={pern.area_size || ''}
              onChange={(e) => updateField('area_size', e.target.value || null)}
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Average Throughput</label>
            <input
              value={pern.throughput || ''}
              onChange={(e) => updateField('throughput', e.target.value || null)}
              style={inputStyle}
            />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={labelStyle}>Process Flow Description</label>
            <textarea
              value={pern.process_flow || ''}
              onChange={(e) => updateField('process_flow', e.target.value || null)}
              rows={2}
              style={{ ...inputStyle, resize: 'vertical' }}
            />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={labelStyle}>Waste Sources</label>
            <CheckboxGroup
              options={wasteSources}
              selected={(pern.waste_sources as string[]) || []}
              onChange={(v) => toggleArrayField('waste_sources', v)}
            />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={labelStyle}>Transfer Notes Checked</label>
            <input
              value={pern.transfer_notes_checked || ''}
              onChange={(e) => updateField('transfer_notes_checked', e.target.value || null)}
              style={inputStyle}
            />
          </div>
        </div>
      </Section>

      <Section title="Safety & Workers">
        <div style={formGrid}>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={labelStyle}>Safety Equipment on Site</label>
            <CheckboxGroup
              options={safetyEquipment}
              selected={(pern.safety_equipment as string[]) || []}
              onChange={(v) => toggleArrayField('safety_equipment', v)}
            />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={labelStyle}>Safety Comments</label>
            <input
              value={pern.safety_comments || ''}
              onChange={(e) => updateField('safety_comments', e.target.value || null)}
              style={inputStyle}
            />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={labelStyle}>Worker Recording Method</label>
            <CheckboxGroup
              options={workerRecording}
              selected={(pern.worker_recording as string[]) || []}
              onChange={(v) => toggleArrayField('worker_recording', v)}
            />
          </div>
          <div>
            <label style={labelStyle}>Worker Recording Comments</label>
            <input
              value={pern.worker_recording_comments || ''}
              onChange={(e) => updateField('worker_recording_comments', e.target.value || null)}
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>PPE Suitable?</label>
            <RadioGroup
              options={['YES', 'NO']}
              value={pern.ppe_suitable || ''}
              onChange={(v) => updateField('ppe_suitable', v)}
            />
          </div>
          <div>
            <label style={labelStyle}>Uniform or Own Clothing?</label>
            <RadioGroup
              options={['UNIFORM', 'OWN CLOTHING']}
              value={pern.uniform_or_own || ''}
              onChange={(v) => updateField('uniform_or_own', v)}
            />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={labelStyle}>Accident Log</label>
            <input
              value={pern.accident_log || ''}
              onChange={(e) => updateField('accident_log', e.target.value || null)}
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Employer Liability Insurance</label>
            <input
              value={pern.employer_liability || ''}
              onChange={(e) => updateField('employer_liability', e.target.value || null)}
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Public Liability Insurance</label>
            <input
              value={pern.public_liability || ''}
              onChange={(e) => updateField('public_liability', e.target.value || null)}
              style={inputStyle}
            />
          </div>
        </div>
      </Section>

      <Section title="Packaging & Compliance">
        <div style={formGrid}>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={labelStyle}>Management Experience</label>
            <textarea
              value={pern.mgmt_experience || ''}
              onChange={(e) => updateField('mgmt_experience', e.target.value || null)}
              rows={2}
              style={{ ...inputStyle, resize: 'vertical' }}
            />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={labelStyle}>PRN Expertise</label>
            <input
              value={pern.prn_expertise || ''}
              onChange={(e) => updateField('prn_expertise', e.target.value || null)}
              style={inputStyle}
            />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={labelStyle}>Can differentiate packaging vs non-packaging?</label>
            <input
              value={pern.packaging_differentiation || ''}
              onChange={(e) => updateField('packaging_differentiation', e.target.value || null)}
              style={inputStyle}
            />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={labelStyle}>How is packaging identified on arrival?</label>
            <input
              value={pern.packaging_identification || ''}
              onChange={(e) => updateField('packaging_identification', e.target.value || null)}
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Non-UK packaging on site?</label>
            <RadioGroup
              options={['YES', 'NO']}
              value={pern.non_uk_packaging || ''}
              onChange={(v) => updateField('non_uk_packaging', v)}
            />
          </div>
          <div>
            <label style={labelStyle}>Non-UK Comments</label>
            <input
              value={pern.non_uk_comments || ''}
              onChange={(e) => updateField('non_uk_comments', e.target.value || null)}
              style={inputStyle}
            />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={labelStyle}>PRN Claimed Once</label>
            <input
              value={pern.prn_claimed_once || ''}
              onChange={(e) => updateField('prn_claimed_once', e.target.value || null)}
              style={inputStyle}
            />
          </div>
        </div>
      </Section>

      <Section title="Training">
        <div style={formGrid}>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={labelStyle}>Training Types</label>
            <CheckboxGroup
              options={trainingTypes}
              selected={(pern.training_types as string[]) || []}
              onChange={(v) => toggleArrayField('training_types', v)}
            />
          </div>
          <div>
            <label style={labelStyle}>Training Scope</label>
            <RadioGroup
              options={['ALL EMPLOYEES INC AGENCY', 'EMPLOYEES ONLY']}
              value={pern.training_scope || ''}
              onChange={(v) => updateField('training_scope', v)}
            />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={labelStyle}>Training Recording</label>
            <CheckboxGroup
              options={trainingRecording}
              selected={(pern.training_recording as string[]) || []}
              onChange={(v) => toggleArrayField('training_recording', v)}
            />
          </div>
          <div>
            <label style={labelStyle}>Training Review Frequency</label>
            <RadioGroup
              options={['YEARLY', '6 MONTHLY', '3 MONTHLY', 'MONTHLY']}
              value={pern.training_review_frequency || ''}
              onChange={(v) => updateField('training_review_frequency', v)}
            />
          </div>
          <div>
            <label style={labelStyle}>Training Records Inspected</label>
            <RadioGroup
              options={['COMPLETE', 'NOT AVAILABLE']}
              value={pern.training_records_inspected || ''}
              onChange={(v) => updateField('training_records_inspected', v)}
            />
          </div>
          <div>
            <label style={labelStyle}>Workers consistent with training?</label>
            <RadioGroup
              options={['YES', 'NO']}
              value={pern.workers_consistent || ''}
              onChange={(v) => updateField('workers_consistent', v)}
            />
          </div>
        </div>
      </Section>

      <Section title="Results & Follow-up">
        <div style={formGrid}>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={labelStyle}>Bale Split Results</label>
            <textarea
              value={pern.bale_split_results || ''}
              onChange={(e) => updateField('bale_split_results', e.target.value || null)}
              rows={2}
              style={{ ...inputStyle, resize: 'vertical' }}
            />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={labelStyle}>Quality Discussion</label>
            <textarea
              value={pern.quality_discussion || ''}
              onChange={(e) => updateField('quality_discussion', e.target.value || null)}
              rows={2}
              style={{ ...inputStyle, resize: 'vertical' }}
            />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={labelStyle}>Follow Up</label>
            <textarea
              value={pern.follow_up || ''}
              onChange={(e) => updateField('follow_up', e.target.value || null)}
              rows={2}
              style={{ ...inputStyle, resize: 'vertical' }}
            />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={labelStyle}>Notes</label>
            <textarea
              value={pern.notes || ''}
              onChange={(e) => updateField('notes', e.target.value || null)}
              rows={3}
              style={{ ...inputStyle, resize: 'vertical' }}
            />
          </div>
          <div>
            <label style={labelStyle}>Auditor Position</label>
            <input
              value={pern.auditor_position || ''}
              onChange={(e) => updateField('auditor_position', e.target.value || null)}
              style={inputStyle}
            />
          </div>
        </div>
      </Section>
    </>
  );
}

// Helper components
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

function CheckboxGroup({
  options,
  selected,
  onChange,
}: {
  options: string[];
  selected: string[];
  onChange: (v: string) => void;
}) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {options.map((opt) => {
        const checked = selected.includes(opt);
        return (
          <label
            key={opt}
            style={{
              ...checkboxLabel,
              background: checked ? '#ebf5fb' : '#f8f9fa',
              borderColor: checked ? '#2980b9' : '#dde',
            }}
          >
            <input type="checkbox" checked={checked} onChange={() => onChange(opt)} style={{ marginRight: 6 }} />
            {opt}
          </label>
        );
      })}
    </div>
  );
}

// Styles
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

const checkboxLabel: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  padding: '6px 14px',
  borderRadius: 6,
  border: '1px solid #dde',
  fontSize: 13,
  cursor: 'pointer',
  userSelect: 'none',
};

const photoThumbStyle: React.CSSProperties = {
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 4,
};

const photoRemoveBtn: React.CSSProperties = {
  position: 'absolute',
  top: -6,
  right: -6,
  width: 22,
  height: 22,
  borderRadius: '50%',
  background: '#e74c3c',
  color: '#fff',
  border: 'none',
  cursor: 'pointer',
  fontSize: 14,
  lineHeight: '22px',
  textAlign: 'center',
  padding: 0,
};
