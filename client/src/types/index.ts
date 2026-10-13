export interface User {
  id: number;
  username: string;
  displayName: string;
  phone: string | null;
  isSuperuser: boolean;
}

export interface UserRecord {
  id: number;
  username: string;
  display_name: string;
  is_superuser: number;
  is_active: number;
  created_at: string;
  phone: string | null;
}

export interface Customer {
  id: number;
  name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  is_active: number;
  sites?: CustomerSite[];
}

export interface CustomerSite {
  id: number;
  customer_id: number;
  address: string;
  is_active: number;
}

export type ReportType = 'loading_inspection' | 'quarterly_pern' | 'pern_audit' | 'loading_quarterly_pern' | 'sampling';

export interface Report {
  id: number;
  report_type: ReportType;
  customer_id: number;
  site_id: number;
  inspection_date: string;
  inspection_time: string | null;
  inspector_id: number;
  inspector_name: string;
  quality_score: number | null;
  inspection_passed: number | null;
  other_information: string | null;
  signature_path: string | null;
  date_completed: string | null;
  status: string;
  on_behalf_of: string | null;
  assigned_to_id: number | null;
  created_by_id: number | null;
  created_at: string;
  updated_at: string;
  customer_name?: string;
  site_address?: string;
  inspection_details?: InspectionDetails;
  unwanted_materials?: UnwantedMaterial[];
  contaminants?: Contaminant[];
  containers?: Container[];
  pern_details?: PernDetails;
  sampling?: ReportSampling | null;
  photos?: ReportPhoto[];
}

export interface InspectionDetails {
  id?: number;
  report_id?: number;
  product_description: string | null;
  product_grade: string | null;
  mode_of_storage: string | null;
  moisture_reading_low: string | null;
  moisture_reading_high: string | null;
  moisture_readings: string | null;
  radiation_reading: string | null;
  loading_reference: string | null;
  number_of_containers: number | null;
  stock_bale_count: string | null;
  mixed_paper_exceeds_34_5: string | null;
  occ_exceeds_80: string | null;
  plastic_exceeds_97_5: string | null;
  material_originates_uk: string | null;
  supplier_aware_pern: string | null;
  supplier_controls_volume: string | null;
  volume_consistency_notes: string | null;
  site_buys_prebaled: string | null;
  prebaled_uk_assurance: string | null;
  site_aware_non_uk: string | null;
  rejected_bales: string | null;
  bale_break: number | null;
  bale_break_results: string | null;
  packaging_thresholds: string[] | string | null;
}

export interface UnwantedMaterial {
  id?: number;
  material: string;
  notes: string | null;
}

export interface Contaminant {
  id?: number;
  contaminant: string;
  notes: string | null;
}

export interface Container {
  id?: number;
  report_id?: number;
  container_number: string | null;
  seal_number: string | null;
  weight_info: string | null;
  number_of_bales: string | null;
  weighbridge_ticket: string | null;
  weight: string | null;
  sort_order: number;
}

export interface PernDetails {
  id?: number;
  report_id?: number;
  company_name_address: string | null;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  grades_supplied: string | null;
  num_workers: string | null;
  site_type: string[] | string | null;
  safety_inducted: string | null;
  materials_handled: string | null;
  prn_accredited: string | null;
  prn_numbers: string | null;
  permits_licences: string | null;
  accreditations: string[] | string | null;
  site_facilities: string[] | string | null;
  area_size: string | null;
  process_flow: string | null;
  throughput: string | null;
  waste_sources: string[] | string | null;
  transfer_notes_checked: string | null;
  safety_equipment: string[] | string | null;
  safety_comments: string | null;
  worker_recording: string[] | string | null;
  worker_recording_comments: string | null;
  ppe_suitable: string | null;
  uniform_or_own: string | null;
  accident_log: string | null;
  employer_liability: string | null;
  public_liability: string | null;
  mgmt_experience: string | null;
  prn_expertise: string | null;
  packaging_differentiation: string | null;
  packaging_identification: string | null;
  non_uk_packaging: string | null;
  non_uk_comments: string | null;
  prn_claimed_once: string | null;
  training_types: string[] | string | null;
  training_scope: string | null;
  training_recording: string[] | string | null;
  training_review_frequency: string | null;
  training_records_inspected: string | null;
  workers_consistent: string | null;
  bale_split_results: string | null;
  quality_discussion: string | null;
  follow_up: string | null;
  notes: string | null;
  auditor_position: string | null;
  intro_letter: string | null;
  product_description: string | null;
  product_grade: string | null;
}

/**
 * The sampling block (the bale break reworked), on every report type. Weights
 * are in kilograms; the percentages shown beside them are worked out from the
 * sample size rather than stored.
 */
export interface ReportSampling {
  id?: number;
  report_id?: number;
  not_carried_out?: number | null;
  not_carried_out_reason?: string | null;
  sample_size_kg?: number | string | null;
  in_scope_kg?: number | string | null;
  out_of_scope_kg?: number | string | null;
  contamination_kg?: number | string | null;
  prohibited_kg?: number | string | null;
  prohibited_items?: string | null;
  pern_prn_claimed_percent?: number | string | null;
  contamination_limit_percent?: number | string | null;
  comments?: string | null;
}

export interface ReportPhoto {
  id: number;
  report_id: number;
  container_id: number | null;
  photo_label: string | null;
  file_path: string;
  sort_order: number;
  created_at: string;
}

export interface LookupValue {
  id: number;
  value: string;
  report_type?: string;
  is_active: number;
}

export const REPORT_TYPE_LABELS: Record<ReportType, string> = {
  loading_inspection: 'Loading & Inspection',
  quarterly_pern: 'Quarterly PERN Inspection',
  pern_audit: 'PERN Audit',
  loading_quarterly_pern: 'Loading & Qtr PERN',
  sampling: 'Sampling',
};

export const TYPE_COLORS: Record<string, string> = {
  loading_inspection: '#2e86de',
  quarterly_pern: '#16a085',
  pern_audit: '#8e44ad',
  loading_quarterly_pern: '#d35400',
  sampling: '#c0392b',
};

export const TYPE_SHORT: Record<string, string> = {
  loading_inspection: 'Loading',
  quarterly_pern: 'Quarterly',
  pern_audit: 'PERN',
  loading_quarterly_pern: 'Loading+Qtr',
  sampling: 'Sampling',
};

export interface CollectionNoteItem {
  id?: number;
  note_id?: number;
  quantity: string | null;
  description: string | null;
  nett_weight: string | null;
  collection_point: string | null;
  sort_order?: number;
}

export interface CollectionNote {
  id: number;
  reference: string;
  customer_id: number;
  site_id: number | null;
  collect_from_address: string | null;
  comments: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  buyer_reference: string | null;
  minimum_weight: string | null;
  collection_date: string | null;
  transport_company: string | null;
  dispatched_signature_path: string | null;
  dispatched_signed_date: string | null;
  created_by_id: number | null;
  created_at: string;
  updated_at: string;
  customer_name?: string;
  site_address?: string | null;
  items_summary?: string | null;
  items?: CollectionNoteItem[];
}

export interface CollectionNoteData {
  reference: string;
  customer_id: number;
  site_id?: number | null;
  collect_from_address?: string | null;
  comments?: string | null;
  contact_name?: string | null;
  contact_phone?: string | null;
  buyer_reference?: string | null;
  minimum_weight?: string | null;
  collection_date?: string | null;
  transport_company?: string | null;
  dispatched_signed_date?: string | null;
  items?: CollectionNoteItem[];
}

/**
 * Facts about the installation itself, as opposed to anything stored in it.
 * Served unauthenticated so the login page can carry the test-deployment
 * warning as well.
 */
export interface AppInfo {
  testDeployment: boolean;
  deploymentLabel: string;
  appVersion: string;
}

export interface AppSettings {
  collection_note_prefix?: string;
  collection_note_next_number?: string;
  'backup.enabled'?: string;
  'backup.hour'?: string;
  'backup.keep'?: string;
}

export interface Backup {
  filename: string;
  kind: 'scheduled' | 'manual' | 'pre-restore';
  createdAt: string;
  sizeBytes: number;
  reportCount: number | null;
  photoCount: number | null;
  collectionNoteCount: number | null;
}

// Monthly travel and expenses sheets. One sheet per person per month, with the
// figures worked out server side and sent alongside so a list can show a total
// without the client re-deriving it.

export interface MileageRates {
  high: number;
  low: number;
  bandMiles: number;
}

export interface MileageTotals {
  milesBroughtForward: number;
  miles: number;
  highMiles: number;
  lowMiles: number;
  highPay: number;
  lowPay: number;
  total: number;
}

export interface TravelJourney {
  id?: number;
  sheet_id?: number;
  journey_date: string | null;
  customer_id: number | null;
  customer_name: string | null;
  job: string | null;
  from_location: string | null;
  to_location: string | null;
  miles: number | null;
  round_trip: number | boolean | null;
  sort_order?: number;
}

export interface TravelSheet {
  id: number;
  user_id: number;
  year: number;
  month: number;
  notes: string | null;
  created_at: string;
  updated_at: string | null;
  display_name?: string;
  journeys?: TravelJourney[];
  journey_count?: number;
  rates?: MileageRates;
  totals: MileageTotals;
}

export interface ExpenseItem {
  id?: number;
  sheet_id?: number;
  item_date: string | null;
  description: string | null;
  cost: number | null;
  vat_applicable: number | boolean | null;
  vat_amount: number | null;
  sort_order?: number;
}

export interface ExpensePhoto {
  id: number;
  sheet_id: number;
  item_id: number | null;
  file_path: string;
  sort_order: number;
  created_at: string;
}

export interface ExpenseTotals {
  gross: number;
  vat: number;
  net: number;
}

export interface ExpenseSheet {
  id: number;
  user_id: number;
  year: number;
  month: number;
  notes: string | null;
  created_at: string;
  updated_at: string | null;
  display_name?: string;
  items?: ExpenseItem[];
  photos?: ExpensePhoto[];
  item_count?: number;
  totals: ExpenseTotals;
}
