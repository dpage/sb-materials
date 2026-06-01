import { describe, it, expect, vi, beforeEach } from 'vitest';
import { api } from '../api';

describe('API Client', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  function mockFetch(body: any, status = 200) {
    return vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? 'OK' : 'Error',
      json: () => Promise.resolve(body),
    } as Response);
  }

  describe('auth', () => {
    it('should call login endpoint', async () => {
      const spy = mockFetch({ id: 1, username: 'admin', displayName: 'Admin', isSuperuser: true });
      const user = await api.login('admin', 'admin');
      expect(user.username).toBe('admin');
      expect(spy).toHaveBeenCalledWith(
        '/api/auth/login',
        expect.objectContaining({
          method: 'POST',
          credentials: 'include',
        }),
      );
    });

    it('should call logout endpoint', async () => {
      const spy = mockFetch({ ok: true });
      await api.logout();
      expect(spy).toHaveBeenCalledWith('/api/auth/logout', expect.objectContaining({ method: 'POST' }));
    });

    it('should call me endpoint', async () => {
      mockFetch({ id: 1, username: 'admin' });
      const user = await api.me();
      expect(user.username).toBe('admin');
    });

    it('should throw on error response', async () => {
      mockFetch({ error: 'Invalid credentials' }, 401);
      await expect(api.login('admin', 'wrong')).rejects.toThrow('Invalid credentials');
    });

    it('should throw with statusText on non-JSON error', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: () => Promise.reject(new Error('not json')),
      } as Response);
      await expect(api.me()).rejects.toThrow('Internal Server Error');
    });
  });

  describe('users', () => {
    it('should get users', async () => {
      mockFetch([{ id: 1, username: 'admin' }]);
      const users = await api.getUsers();
      expect(users).toHaveLength(1);
    });

    it('should get user by id', async () => {
      mockFetch({ id: 1, username: 'admin' });
      const user = await api.getUser(1);
      expect(user.username).toBe('admin');
    });

    it('should create user', async () => {
      const spy = mockFetch({ id: 3 });
      await api.createUser({ username: 'new', password: 'pass', display_name: 'New' });
      expect(spy).toHaveBeenCalledWith('/api/users', expect.objectContaining({ method: 'POST' }));
    });

    it('should update user', async () => {
      const spy = mockFetch({ ok: true });
      await api.updateUser(1, { display_name: 'Updated' });
      expect(spy).toHaveBeenCalledWith('/api/users/1', expect.objectContaining({ method: 'PUT' }));
    });
  });

  describe('customers', () => {
    it('should get customers', async () => {
      mockFetch([{ id: 1, name: 'Test' }]);
      const customers = await api.getCustomers();
      expect(customers).toHaveLength(1);
    });

    it('should get customers including inactive', async () => {
      const spy = mockFetch([]);
      await api.getCustomers(true);
      expect(spy).toHaveBeenCalledWith('/api/customers?includeInactive=true', expect.anything());
    });

    it('should create customer with name string', async () => {
      const spy = mockFetch({ id: 1, name: 'Test' });
      await api.createCustomer('Test');
      const body = JSON.parse((spy.mock.calls[0][1] as any).body);
      expect(body).toEqual({ name: 'Test' });
    });

    it('should create customer with object', async () => {
      const spy = mockFetch({ id: 1, name: 'Test' });
      await api.createCustomer({ name: 'Test', email: 'test@test.com' });
      const body = JSON.parse((spy.mock.calls[0][1] as any).body);
      expect(body).toEqual({ name: 'Test', email: 'test@test.com' });
    });
  });

  describe('sites', () => {
    it('should get sites', async () => {
      mockFetch([{ id: 1, address: '123 St' }]);
      const sites = await api.getSites(1);
      expect(sites).toHaveLength(1);
    });

    it('should create site', async () => {
      const spy = mockFetch({ id: 1, address: '456 St' });
      await api.createSite(1, '456 St');
      expect(spy).toHaveBeenCalledWith('/api/customers/1/sites', expect.objectContaining({ method: 'POST' }));
    });
  });

  describe('lookups', () => {
    it('should get lookups with report type', async () => {
      const spy = mockFetch([{ id: 1, value: 'OCC' }]);
      await api.getLookups('lookup_product_grades', 'loading_inspection');
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('report_type=loading_inspection'), expect.anything());
    });

    it('should get all lookups including inactive', async () => {
      const spy = mockFetch([]);
      await api.getLookupsAll('lookup_storage_modes');
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('includeInactive=true'), expect.anything());
    });

    it('should create lookup', async () => {
      const spy = mockFetch({ id: 1, value: 'New' });
      await api.createLookup('lookup_storage_modes', { value: 'New' });
      expect(spy).toHaveBeenCalledWith(
        '/api/lookups/lookup_storage_modes',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  describe('reports', () => {
    it('should get reports with params', async () => {
      const spy = mockFetch({ data: [], total: 0, page: 1, limit: 25 });
      await api.getReports({ page: '1', report_type: 'loading_inspection' });
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('report_type=loading_inspection'), expect.anything());
    });

    it('should get single report', async () => {
      mockFetch({ id: 1, report_type: 'loading_inspection' });
      const report = await api.getReport(1);
      expect(report.id).toBe(1);
    });

    it('should create report', async () => {
      const spy = mockFetch({ id: 1 });
      await api.createReport({
        report_type: 'loading_inspection',
        customer_id: 1,
        site_id: 1,
        inspection_date: '2024-01-01',
        inspector_name: 'Test',
      });
      expect(spy).toHaveBeenCalledWith('/api/reports', expect.objectContaining({ method: 'POST' }));
    });

    it('should update report', async () => {
      const spy = mockFetch({ ok: true });
      await api.updateReport(1, { status: 'completed' } as any);
      expect(spy).toHaveBeenCalledWith('/api/reports/1', expect.objectContaining({ method: 'PUT' }));
    });

    it('should delete report', async () => {
      const spy = mockFetch({ ok: true });
      await api.deleteReport(1);
      expect(spy).toHaveBeenCalledWith('/api/reports/1', expect.objectContaining({ method: 'DELETE' }));
    });

    it('submitReport posts to the submit endpoint', async () => {
      const spy = mockFetch({ ok: true });
      await api.submitReport(5);
      expect(spy).toHaveBeenCalledWith(
        '/api/reports/5/submit',
        expect.objectContaining({ method: 'POST', credentials: 'include' }),
      );
    });

    it('reopenReport posts to the reopen endpoint', async () => {
      const spy = mockFetch({ ok: true });
      await api.reopenReport(3);
      expect(spy).toHaveBeenCalledWith(
        '/api/reports/3/reopen',
        expect.objectContaining({ method: 'POST', credentials: 'include' }),
      );
    });
  });

  describe('photos', () => {
    it('should upload photos', async () => {
      const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([{ id: 1, file_path: '1/test.jpg' }]),
      } as Response);

      const file = new File(['test'], 'test.jpg', { type: 'image/jpeg' });
      await api.uploadPhotos(1, [file], ['label'], [null]);
      expect(spy).toHaveBeenCalledWith('/api/photos/upload/1', expect.objectContaining({ method: 'POST' }));
    });

    it('should upload signature', async () => {
      const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ signature_path: '1/sig.png' }),
      } as Response);

      const blob = new Blob(['test'], { type: 'image/png' });
      await api.uploadSignature(1, blob);
      expect(spy).toHaveBeenCalledWith('/api/photos/signature/1', expect.objectContaining({ method: 'POST' }));
    });

    it('should throw on upload failure', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false } as Response);
      const file = new File(['test'], 'test.jpg');
      await expect(api.uploadPhotos(1, [file])).rejects.toThrow('Upload failed');
    });

    it('should throw on signature upload failure', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false } as Response);
      await expect(api.uploadSignature(1, new Blob())).rejects.toThrow('Signature upload failed');
    });

    it('should update photo', async () => {
      const spy = mockFetch({ ok: true });
      await api.updatePhoto(1, { photo_label: 'New Label' });
      expect(spy).toHaveBeenCalledWith('/api/photos/1', expect.objectContaining({ method: 'PUT' }));
    });

    it('should delete photo', async () => {
      const spy = mockFetch({ ok: true });
      await api.deletePhoto(1);
      expect(spy).toHaveBeenCalledWith('/api/photos/1', expect.objectContaining({ method: 'DELETE' }));
    });

    it('should generate photo URL', () => {
      expect(api.getPhotoUrl('1/test.jpg')).toBe('/api/photos/file/1/test.jpg');
    });

    it('should generate PDF download URL', () => {
      expect(api.downloadPdf(1)).toBe('/api/pdf/1');
    });
  });
});
