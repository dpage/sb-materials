import type {
  User,
  Customer,
  CustomerSite,
  Report,
  ReportType,
  LookupValue,
  UserRecord,
  InspectionDetails,
  UnwantedMaterial,
  Contaminant,
  Container,
  PernDetails,
} from '../types';

const BASE = '/api';

interface CreateUserData {
  username: string;
  password: string;
  display_name: string;
  is_superuser?: boolean;
}

interface UpdateUserData {
  username?: string;
  password?: string;
  display_name?: string;
  is_superuser?: boolean;
  is_active?: number;
}

interface UpdateCustomerData {
  name?: string;
  contact_name?: string;
  email?: string;
  phone?: string;
  address?: string;
  is_active?: number;
}

interface UpdateSiteData {
  address?: string;
  is_active?: number;
}

interface CreateLookupData {
  value: string;
  report_type?: string;
}

interface UpdateLookupData {
  value?: string;
  is_active?: number;
}

interface ReportData {
  report_type: ReportType;
  customer_id: number;
  site_id: number;
  inspection_date: string;
  inspection_time?: string;
  inspector_name: string;
  quality_score?: number | null;
  inspection_passed?: boolean | null;
  other_information?: string;
  date_completed?: string;
  status?: string;
  inspection_details?: Partial<InspectionDetails>;
  unwanted_materials?: UnwantedMaterial[];
  contaminants?: Contaminant[];
  containers?: Partial<Container>[];
  pern_details?: Partial<PernDetails>;
}

interface UpdatePhotoData {
  photo_label?: string;
  sort_order?: number;
  container_id?: number | null;
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${url}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || res.statusText);
  }
  return res.json();
}

// Auth
export const api = {
  login: (username: string, password: string) =>
    request<User>('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),

  logout: () => request('/auth/logout', { method: 'POST' }),

  me: () => request<User>('/auth/me'),

  // Users
  getUsers: () => request<UserRecord[]>('/users'),
  getUser: (id: number) => request<UserRecord>(`/users/${id}`),
  createUser: (data: CreateUserData) =>
    request<{ id: number }>('/users', { method: 'POST', body: JSON.stringify(data) }),
  updateUser: (id: number, data: UpdateUserData) =>
    request('/users/' + id, { method: 'PUT', body: JSON.stringify(data) }),

  // Customers
  getCustomers: (includeInactive = false) => request<Customer[]>(`/customers?includeInactive=${includeInactive}`),
  getCustomer: (id: number) => request<Customer & { sites: CustomerSite[] }>(`/customers/${id}`),
  createCustomer: (
    data: { name: string; contact_name?: string; email?: string; phone?: string; address?: string } | string,
  ) => {
    const body = typeof data === 'string' ? { name: data } : data;
    return request<Customer>('/customers', { method: 'POST', body: JSON.stringify(body) });
  },
  updateCustomer: (id: number, data: UpdateCustomerData) =>
    request('/customers/' + id, { method: 'PUT', body: JSON.stringify(data) }),

  // Sites
  getSites: (customerId: number) => request<CustomerSite[]>(`/customers/${customerId}/sites`),
  createSite: (customerId: number, address: string) =>
    request<CustomerSite>(`/customers/${customerId}/sites`, { method: 'POST', body: JSON.stringify({ address }) }),
  updateSite: (customerId: number, siteId: number, data: UpdateSiteData) =>
    request(`/customers/${customerId}/sites/${siteId}`, { method: 'PUT', body: JSON.stringify(data) }),

  // Lookups
  getLookups: (table: string, reportType?: string) => {
    const params = new URLSearchParams();
    if (reportType) params.set('report_type', reportType);
    return request<LookupValue[]>(`/lookups/${table}?${params}`);
  },
  getLookupsAll: (table: string) => request<LookupValue[]>(`/lookups/${table}?includeInactive=true`),
  createLookup: (table: string, data: CreateLookupData) =>
    request<LookupValue>(`/lookups/${table}`, { method: 'POST', body: JSON.stringify(data) }),
  updateLookup: (table: string, id: number, data: UpdateLookupData) =>
    request(`/lookups/${table}/${id}`, { method: 'PUT', body: JSON.stringify(data) }),

  // Reports
  getReports: (params: Record<string, string>) => {
    const qs = new URLSearchParams(params);
    return request<{ data: Report[]; total: number; page: number; limit: number }>(`/reports?${qs}`);
  },
  getReport: (id: number) => request<Report>(`/reports/${id}`),
  createReport: (data: ReportData) =>
    request<{ id: number; containerIds?: number[] }>('/reports', { method: 'POST', body: JSON.stringify(data) }),
  updateReport: (id: number, data: Partial<ReportData>) =>
    request<{ ok: boolean; containerIds?: number[] }>(`/reports/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteReport: (id: number) => request(`/reports/${id}`, { method: 'DELETE' }),
  submitReport: (id: number) => request<{ ok: boolean }>(`/reports/${id}/submit`, { method: 'POST', body: '{}' }),
  reopenReport: (id: number) => request<{ ok: boolean }>(`/reports/${id}/reopen`, { method: 'POST', body: '{}' }),

  // Photos
  uploadPhotos: async (reportId: number, files: File[], labels?: string[], containerIds?: (number | null)[]) => {
    const formData = new FormData();
    files.forEach((f) => formData.append('photos', f));
    labels?.forEach((l) => formData.append('labels', l || ''));
    containerIds?.forEach((c) => formData.append('container_ids', c?.toString() || ''));
    const res = await fetch(`${BASE}/photos/upload/${reportId}`, {
      method: 'POST',
      credentials: 'include',
      body: formData,
    });
    if (!res.ok) throw new Error('Upload failed');
    return res.json();
  },

  updatePhoto: (id: number, data: UpdatePhotoData) =>
    request(`/photos/${id}`, { method: 'PUT', body: JSON.stringify(data) }),

  deletePhoto: (id: number) => request(`/photos/${id}`, { method: 'DELETE' }),

  uploadSignature: async (reportId: number, blob: Blob) => {
    const formData = new FormData();
    formData.append('signature', blob, 'signature.png');
    const res = await fetch(`${BASE}/photos/signature/${reportId}`, {
      method: 'POST',
      credentials: 'include',
      body: formData,
    });
    if (!res.ok) throw new Error('Signature upload failed');
    return res.json();
  },

  getPhotoUrl: (filename: string) => `${BASE}/photos/file/${filename}`,

  downloadPdf: (reportId: number) => `${BASE}/pdf/${reportId}`,
};
