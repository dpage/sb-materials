import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express from 'express';
import { parseBooleanFlag } from '../config';
import { appInfoRoutes } from '../routes/app-info';
import { deploymentWatermark } from '../utils/watermark';

function appInfoApp(info: { testDeployment: boolean; deploymentLabel: string; appVersion: string }) {
  const app = express();
  app.use(express.json());
  app.use('/api/app-info', appInfoRoutes(info));
  return app;
}

describe('parseBooleanFlag', () => {
  it.each(['1', 'true', 'TRUE', 'yes', 'on', ' true '])('treats %j as set', (value) => {
    expect(parseBooleanFlag(value)).toBe(true);
  });

  it.each([undefined, '', '0', 'false', 'no', 'off', 'maybe'])('treats %j as unset', (value) => {
    expect(parseBooleanFlag(value)).toBe(false);
  });
});

describe('GET /api/app-info', () => {
  it('reports a test deployment without requiring a session', async () => {
    const app = appInfoApp({ testDeployment: true, deploymentLabel: 'PRE-PROD', appVersion: '1.2.3' });

    const res = await request(app).get('/api/app-info');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ testDeployment: true, deploymentLabel: 'PRE-PROD', appVersion: '1.2.3' });
  });

  it('reports a production deployment', async () => {
    const app = appInfoApp({ testDeployment: false, deploymentLabel: 'TEST', appVersion: '1.2.3' });

    const res = await request(app).get('/api/app-info');

    expect(res.body.testDeployment).toBe(false);
  });
});

describe('deploymentWatermark', () => {
  it('uses the deployment label as the watermark text', () => {
    expect(deploymentWatermark('PRE-PROD')).toMatchObject({ text: 'PRE-PROD', bold: true });
  });

  it('stays faint enough to read the report through', () => {
    const { opacity } = deploymentWatermark('TEST');
    expect(opacity).toBeGreaterThan(0);
    expect(opacity).toBeLessThan(0.3);
  });
});
