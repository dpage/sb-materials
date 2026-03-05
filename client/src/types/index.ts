export interface User {
  id: number;
  username: string;
  displayName: string;
  isSuperuser: boolean;
}

export interface UserRecord {
  id: number;
  username: string;
  display_name: string;
  is_superuser: number;
  is_active: number;
  created_at: string;
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

export type ReportType = 'inspection_fibre' | 'inspection_plastics' | 'inspection_metals' | 'pern_audit';

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
  created_at: string;
  updated_at: string;
  customer_name?: string;
  site_address?: string;
  inspection_details?: InspectionDetails;
  unwanted_materials?: UnwantedMaterial[];
  contaminants?: Contaminant[];
  containers?: Container[];
  pern_details?: PernDetails;
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
  inspection_fibre: 'Quality & Inspection - Fibre',
  inspection_plastics: 'Quality & Inspection - Plastics',
  inspection_metals: 'Quality & Inspection - Metals',
  pern_audit: 'PERN Audit',
};

export const TYPE_COLORS: Record<string, string> = {
  inspection_fibre: '#2e86de',
  inspection_plastics: '#e67e22',
  inspection_metals: '#636e72',
  pern_audit: '#8e44ad',
};

export const TYPE_SHORT: Record<string, string> = {
  inspection_fibre: 'Fibre',
  inspection_plastics: 'Plastics',
  inspection_metals: 'Metals',
  pern_audit: 'PERN',
};
