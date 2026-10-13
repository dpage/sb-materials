import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

// Project root is two levels up from server/src/
const projectRoot = path.resolve(__dirname, '../..');

// Load .env if present, otherwise fall back to .env.default for dev
dotenv.config({ path: path.join(projectRoot, '.env') });
dotenv.config({ path: path.join(projectRoot, '.env.default') });

const defaultSecret = 'sb-materials-dev-secret-change-me';

/**
 * Read an environment variable as a boolean flag. Deployment tooling writes
 * these by hand, so accept the spellings somebody might reasonably use rather
 * than insisting on one of them.
 */
export function parseBooleanFlag(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes((value ?? '').trim().toLowerCase());
}

const DEFAULT_DEPLOYMENT_LABEL = 'TEST';

if (!process.env.SESSION_SECRET) {
  console.warn('WARNING: SESSION_SECRET not set. Using insecure default. Set SESSION_SECRET env var for production.');
}

const serverPackageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'server', 'package.json'), 'utf-8')) as {
  version: string;
};

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  // Marks this installation as a test one rather than the live service: the
  // client paints a warning banner and the PDFs get a watermark. Deliberately
  // an environment variable rather than a database setting, because it is a
  // property of the deployment and must survive a database restored from the
  // production backup.
  isTestDeployment: parseBooleanFlag(process.env.TEST_DEPLOYMENT),
  deploymentLabel: (process.env.DEPLOYMENT_LABEL || '').trim() || DEFAULT_DEPLOYMENT_LABEL,
  dataDir: path.resolve(projectRoot, process.env.DATA_DIR || './data'),
  sessionSecret: process.env.SESSION_SECRET || defaultSecret,
  appVersion: serverPackageJson.version,
  get dbPath() {
    return path.join(this.dataDir, 'sb-materials.db');
  },
  get uploadsDir() {
    return path.join(this.dataDir, 'uploads');
  },
  get backupsDir() {
    return path.join(this.dataDir, 'backups');
  },
};
