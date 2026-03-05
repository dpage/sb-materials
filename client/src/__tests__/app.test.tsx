import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

// Mock all page components to avoid deep rendering
vi.mock('../pages/Login', () => ({ Login: () => <div>Login Page</div> }));
vi.mock('../pages/Reports', () => ({ Reports: () => <div>Reports Page</div> }));
vi.mock('../pages/ReportEdit', () => ({ ReportEdit: () => <div>Report Edit Page</div> }));
vi.mock('../pages/Customers', () => ({ Customers: () => <div>Customers Page</div> }));
vi.mock('../pages/Users', () => ({ Users: () => <div>Users Page</div> }));
vi.mock('../pages/Lookups', () => ({ Lookups: () => <div>Lookups Page</div> }));
vi.mock('../components/HelpPanel', () => ({ HelpPanel: () => <div>Help</div> }));

vi.mock('../api', () => ({
  api: {
    me: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
  },
}));

import { api } from '../api';

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should show loading while checking auth', async () => {
    // Never resolve me() so it stays loading
    (api.me as any).mockReturnValue(new Promise(() => {}));
    const { App } = await import('../App');
    render(<App />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('should redirect to login when not authenticated', async () => {
    (api.me as any).mockRejectedValue(new Error('Not authenticated'));
    // Need fresh import to reset auth state
    vi.resetModules();
    vi.mock('../pages/Login', () => ({ Login: () => <div>Login Page</div> }));
    vi.mock('../pages/Reports', () => ({ Reports: () => <div>Reports Page</div> }));
    vi.mock('../pages/ReportEdit', () => ({ ReportEdit: () => <div>Report Edit Page</div> }));
    vi.mock('../pages/Customers', () => ({ Customers: () => <div>Customers Page</div> }));
    vi.mock('../pages/Users', () => ({ Users: () => <div>Users Page</div> }));
    vi.mock('../pages/Lookups', () => ({ Lookups: () => <div>Lookups Page</div> }));
    vi.mock('../components/HelpPanel', () => ({ HelpPanel: () => <div>Help</div> }));
    vi.mock('../api', () => ({
      api: { me: vi.fn().mockRejectedValue(new Error('no')), login: vi.fn(), logout: vi.fn() },
    }));
    const { App } = await import('../App');
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText('Login Page')).toBeInTheDocument();
    });
  });
});
