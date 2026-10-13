import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

vi.mock('../api', () => ({
  api: { getAppInfo: vi.fn() },
}));

vi.mock('../App', () => ({
  useAuth: () => ({ user: { id: 1, username: 'test', displayName: 'Test User', phone: null, isSuperuser: false } }),
}));

import { api } from '../api';
import { DeploymentProvider } from '../components/DeploymentContext';
import { TestDeploymentBanner } from '../components/TestDeploymentBanner';
import { HelpProvider } from '../components/HelpContext';
import { Layout } from '../components/Layout';

function renderLayout() {
  return render(
    <MemoryRouter>
      <DeploymentProvider>
        <HelpProvider>
          <Routes>
            <Route path="/" element={<Layout />}>
              <Route index element={<div>Content</div>} />
            </Route>
          </Routes>
        </HelpProvider>
      </DeploymentProvider>
    </MemoryRouter>,
  );
}

function renderBanner() {
  return render(
    <MemoryRouter>
      <DeploymentProvider>
        <TestDeploymentBanner />
      </DeploymentProvider>
    </MemoryRouter>,
  );
}

describe('test deployment badging', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.title = 'SB Materials';
  });

  it('warns on every page of a test installation', async () => {
    (api.getAppInfo as any).mockResolvedValue({
      testDeployment: true,
      deploymentLabel: 'Pre-prod',
      appVersion: '1.0.0',
    });

    renderBanner();

    expect(await screen.findByRole('alert')).toHaveTextContent(/Pre-prod deployment/i);
  });

  it('puts the label in the window title, so a stray tab is identifiable', async () => {
    (api.getAppInfo as any).mockResolvedValue({
      testDeployment: true,
      deploymentLabel: 'Pre-prod',
      appVersion: '1.0.0',
    });

    renderBanner();

    await waitFor(() => expect(document.title).toBe('[Pre-prod] SB Materials'));
  });

  it('says nothing at all on the live service', async () => {
    (api.getAppInfo as any).mockResolvedValue({ testDeployment: false, deploymentLabel: '', appVersion: '1.0.0' });

    renderBanner();

    await waitFor(() => expect(document.title).toBe('SB Materials'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('treats an unreachable endpoint as production rather than badging the live system', async () => {
    (api.getAppInfo as any).mockRejectedValue(new Error('network'));

    renderBanner();

    await waitFor(() => expect(api.getAppInfo).toHaveBeenCalled());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(document.title).toBe('SB Materials');
  });

  it('badges the sticky header, which stays visible once the banner scrolls away', async () => {
    (api.getAppInfo as any).mockResolvedValue({
      testDeployment: true,
      deploymentLabel: 'Pre-prod',
      appVersion: '1.0.0',
    });

    renderLayout();

    expect(await screen.findByText('Pre-prod')).toBeInTheDocument();
  });

  it('leaves the header alone on the live service', async () => {
    (api.getAppInfo as any).mockResolvedValue({ testDeployment: false, deploymentLabel: '', appVersion: '1.0.0' });

    renderLayout();

    await waitFor(() => expect(api.getAppInfo).toHaveBeenCalled());
    expect(screen.queryByText('Pre-prod')).not.toBeInTheDocument();
  });
});
