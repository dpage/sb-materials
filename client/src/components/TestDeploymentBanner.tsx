import React from 'react';
import { useDeployment } from './DeploymentContext';

export const TEST_BANNER_RED = '#b3261e';

/**
 * Full-width warning strip shown on every page of a test installation,
 * including the login page. Nothing is rendered at all on the live service.
 */
export function TestDeploymentBanner() {
  const { testDeployment, deploymentLabel } = useDeployment();

  if (!testDeployment) return null;

  return (
    <div
      role="alert"
      style={{
        background: TEST_BANNER_RED,
        color: '#ffffff',
        padding: '6px 16px',
        textAlign: 'center',
        fontSize: 13,
        fontWeight: 700,
        letterSpacing: 0.4,
        textTransform: 'uppercase',
      }}
    >
      {deploymentLabel} deployment &middot; not the live system &middot; reports printed here are watermarked
    </div>
  );
}
