import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

// Project root is two levels up from server/src/
const projectRoot = path.resolve(__dirname, '../..');

// Load .env if present, otherwise fall back to .env.default for dev
dotenv.config({ path: path.join(projectRoot, '.env') });
dotenv.config({ path: path.join(projectRoot, '.env.default') });

const defaultSecret = 'sb-materials-dev-secret-change-me';
if (!process.env.SESSION_SECRET) {
  console.warn('WARNING: SESSION_SECRET not set. Using insecure default. Set SESSION_SECRET env var for production.');
}

const serverPackageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'server', 'package.json'), 'utf-8')) as {
  version: string;
};

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
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
