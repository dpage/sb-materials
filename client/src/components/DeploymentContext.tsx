import React, { createContext, useContext, useEffect, useState } from 'react';
import type { AppInfo } from '../types';
import { api } from '../api';

const PRODUCTION: AppInfo = { testDeployment: false, deploymentLabel: '', appVersion: '' };

const DeploymentContext = createContext<AppInfo>(PRODUCTION);

export const useDeployment = () => useContext(DeploymentContext);

/**
 * Fetches the deployment's own description once at startup. It sits outside
 * the authentication check deliberately, so that the test badging is on the
 * login page too, and it treats a failed fetch as production: badging a live
 * installation as a test one would be a good deal worse than the reverse.
 */
export function DeploymentProvider({ children }: { children: React.ReactNode }) {
  const [info, setInfo] = useState<AppInfo>(PRODUCTION);

  useEffect(() => {
    Promise.resolve(api.getAppInfo())
      .then((i) => setInfo(i ?? PRODUCTION))
      .catch(() => setInfo(PRODUCTION));
  }, []);

  useEffect(() => {
    document.title = info.testDeployment ? `[${info.deploymentLabel}] SB Materials` : 'SB Materials';
  }, [info.testDeployment, info.deploymentLabel]);

  return <DeploymentContext.Provider value={info}>{children}</DeploymentContext.Provider>;
}
