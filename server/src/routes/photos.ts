import { Router } from 'express';
import Database from 'better-sqlite3';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { requireAuth } from '../middleware/auth';
import { config } from '../config';
import { archiveImageFile } from '../utils/image';
import { logger } from '../utils/logger';

// Max photos accepted in a single upload request. The client posts all newly
// added photos for a report in one request, and inspections routinely carry
// dozens of photos, so this needs generous headroom (the per-file size limit
// and nginx body limit are the real backstops). The old cap of 20 caused
// "Save failed: Upload failed" (MulterError: Unexpected field) on big reports.
const MAX_PHOTOS_PER_UPLOAD = 100;

export function photoRoutes(db: Database.Database): Router {
  const router = Router();

  router.use(requireAuth);

  // Configure multer - stores files in uploads/{reportId}/
  const storage = multer.diskStorage({
    destination: (req: any, _file, cb) => {
      // Extract reportId from the URL path
      const match =
        req.originalUrl?.match(/\/(?:upload|signature)\/(\d+)/) || req.url?.match(/\/(?:upload|signature)\/(\d+)/);
      const reportId = match ? match[1] : 'misc';
      const dir = path.join(config.uploadsDir, reportId);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`;
      cb(null, uniqueName);
    },
  });

  const upload = multer({
    storage,
    limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
    fileFilter: (_req, file, cb) => {
      const allowed = /\.(jpg|jpeg|png|gif|webp|heic|heif)$/i;
      if (allowed.test(path.extname(file.originalname))) {
        cb(null, true);
      } else {
        cb(new Error('Only image files are allowed'));
      }
    },
  });

  // Upload photo(s) for a report
  router.post('/upload/:reportId', upload.array('photos', MAX_PHOTOS_PER_UPLOAD), async (req, res) => {
    const reportId = parseInt(req.params.reportId as string, 10);
    const report = db.prepare('SELECT id FROM reports WHERE id = ?').get(reportId);
    if (!report) {
      res.status(404).json({ error: 'Report not found' });
      return;
    }

    const files = req.files as Express.Multer.File[];
    if (!files?.length) {
      res.status(400).json({ error: 'No files uploaded' });
      return;
    }

    // Downscale/re-encode every upload to an archival JPEG (also handles EXIF
    // orientation and HEIC). Done before any DB insert so a failure leaves no
    // dangling rows.
    const filenames: string[] = [];
    try {
      for (const file of files) {
        const newPath = await archiveImageFile(file.path);
        filenames.push(path.basename(newPath));
      }
    } catch (err) {
      logger.error('Failed to process uploaded photo:', err);
      files.forEach((f) => fs.existsSync(f.path) && fs.unlinkSync(f.path));
      res.status(400).json({ error: 'Failed to process image' });
      return;
    }

    const labels = Array.isArray(req.body.labels) ? req.body.labels : req.body.labels ? [req.body.labels] : [];
    const containerIds = Array.isArray(req.body.container_ids)
      ? req.body.container_ids
      : req.body.container_ids
        ? [req.body.container_ids]
        : [];

    const stmt = db.prepare(
      'INSERT INTO report_photos (report_id, container_id, photo_label, file_path, sort_order) VALUES (?, ?, ?, ?, ?)',
    );

    const maxOrder = db
      .prepare('SELECT COALESCE(MAX(sort_order), -1) as max_order FROM report_photos WHERE report_id = ?')
      .get(reportId) as { max_order: number };

    const inserted = [];
    for (let i = 0; i < files.length; i++) {
      // Store path relative to uploadsDir: "{reportId}/{filename}"
      const relPath = `${reportId}/${filenames[i]}`;
      const result = stmt.run(
        reportId,
        containerIds[i] ? parseInt(containerIds[i], 10) : null,
        labels[i] || null,
        relPath,
        maxOrder.max_order + 1 + i,
      );
      inserted.push({
        id: result.lastInsertRowid,
        file_path: relPath,
        photo_label: labels[i] || null,
      });
    }

    res.json(inserted);
  });

  // Serve a photo - supports both "reportId/filename" and legacy flat "filename"
  router.get('/file/*', (req, res) => {
    // req.params[0] captures everything after /file/
    const relativePath = (req.params as any)[0] as string;
    const filePath = path.resolve(config.uploadsDir, relativePath);

    // Prevent directory traversal
    if (!filePath.startsWith(path.resolve(config.uploadsDir))) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'Photo not found' });
      return;
    }
    res.sendFile(filePath);
  });

  // Update photo metadata
  router.put('/:id', (req, res) => {
    const { photo_label, sort_order, container_id } = req.body;
    db.prepare(
      `UPDATE report_photos SET
       photo_label = COALESCE(?, photo_label),
       sort_order = COALESCE(?, sort_order),
       container_id = ?
       WHERE id = ?`,
    ).run(photo_label, sort_order, container_id ?? null, req.params.id);
    res.json({ ok: true });
  });

  // Delete photo
  router.delete('/:id', (req, res) => {
    const photo = db.prepare('SELECT file_path FROM report_photos WHERE id = ?').get(req.params.id) as any;
    if (!photo) {
      res.status(404).json({ error: 'Photo not found' });
      return;
    }

    // Delete file from disk
    const filePath = path.resolve(config.uploadsDir, photo.file_path);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    db.prepare('DELETE FROM report_photos WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  // Save signature for a report
  router.post('/signature/:reportId', upload.single('signature'), (req, res) => {
    const reportId = parseInt(req.params.reportId as string, 10);
    const report = db.prepare('SELECT id FROM reports WHERE id = ?').get(reportId);
    if (!report) {
      res.status(404).json({ error: 'Report not found' });
      return;
    }

    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    // Store path relative to uploadsDir: "{reportId}/{filename}"
    const relPath = `${reportId}/${file.filename}`;
    db.prepare('UPDATE reports SET signature_path = ? WHERE id = ?').run(relPath, reportId);
    res.json({ signature_path: relPath });
  });

  return router;
}
