import { Router } from 'express';

export interface AppInfo {
  testDeployment: boolean;
  deploymentLabel: string;
  appVersion: string;
}

/**
 * Deployment facts the client needs before anybody has logged in: the login
 * page has to carry the test-deployment warning too, so this route is
 * deliberately unauthenticated. It exposes nothing that is not already
 * decided by the deployment's own environment.
 */
export function appInfoRoutes(info: AppInfo): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json(info);
  });

  return router;
}
