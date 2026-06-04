import sharp from 'sharp';
import path from 'path';
import fs from 'fs';

// Archival copy stored on disk at upload time: generous enough to zoom in on
// for a dispute, but a fraction of a raw phone photo's size.
export const ARCHIVE_MAX_DIM = 2048;
export const ARCHIVE_QUALITY = 82;

// Further-downscaled copy embedded in generated PDFs. The PDF only ever shows
// photos at ~400pt wide, so 1200px is plenty and keeps the file lean.
export const PDF_MAX_DIM = 1200;
export const PDF_QUALITY = 80;

/**
 * Resize and re-encode an image buffer to JPEG.
 *
 * - Auto-orients from EXIF (`.rotate()` with no args) so phone photos aren't
 *   sideways, baking the orientation into the pixels.
 * - Caps the long edge at `maxDim` without ever upscaling.
 * - Converts any input format (PNG, HEIC/HEIF, etc.) to JPEG.
 */
export async function resizeToJpeg(input: Buffer, maxDim: number, quality: number): Promise<Buffer> {
  return sharp(input)
    .rotate()
    .resize({ width: maxDim, height: maxDim, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality, mozjpeg: true })
    .toBuffer();
}

/**
 * Resize an image file on disk to the archival JPEG copy.
 *
 * Returns the new file path, with its extension forced to `.jpg`. The output is
 * written to a temp file and atomically renamed so a crash can't leave a
 * half-written image; the original is removed if its name changed.
 */
export async function archiveImageFile(filePath: string): Promise<string> {
  const output = await resizeToJpeg(fs.readFileSync(filePath), ARCHIVE_MAX_DIM, ARCHIVE_QUALITY);

  const dir = path.dirname(filePath);
  const base = path.basename(filePath, path.extname(filePath));
  const newPath = path.join(dir, `${base}.jpg`);

  const tmpPath = `${newPath}.tmp`;
  fs.writeFileSync(tmpPath, output);
  fs.renameSync(tmpPath, newPath);

  if (path.resolve(newPath) !== path.resolve(filePath)) {
    fs.unlinkSync(filePath);
  }
  return newPath;
}

/**
 * Read an image file and return it as a downscaled JPEG data URL, ready to embed
 * in a PDF. Returns null if the file is missing or can't be processed (callers
 * treat that as "no image" rather than failing the whole document).
 */
export async function imageFileToJpegDataUrl(filePath: string, maxDim: number, quality: number): Promise<string | null> {
  if (!fs.existsSync(filePath)) return null;
  try {
    const jpeg = await resizeToJpeg(fs.readFileSync(filePath), maxDim, quality);
    return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
  } catch {
    return null;
  }
}
