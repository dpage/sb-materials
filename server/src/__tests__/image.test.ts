import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { resizeToJpeg, imageFileToJpegDataUrl } from '../utils/image';

describe('resizeToJpeg', () => {
  it('caps the long edge at maxDim and outputs JPEG', async () => {
    const source = await sharp({
      create: { width: 4000, height: 3000, channels: 3, background: { r: 120, g: 80, b: 40 } },
    })
      .png()
      .toBuffer();

    const out = await resizeToJpeg(source, 2048, 82);
    const meta = await sharp(out).metadata();

    expect(meta.format).toBe('jpeg');
    expect(meta.width).toBe(2048);
    expect(meta.height).toBe(1536);
    // Re-encoded JPEG of a flat image must be far smaller than the source PNG.
    expect(out.length).toBeLessThan(source.length);
  });

  it('does not upscale images already smaller than maxDim', async () => {
    const source = await sharp({
      create: { width: 800, height: 600, channels: 3, background: { r: 10, g: 20, b: 30 } },
    })
      .png()
      .toBuffer();

    const out = await resizeToJpeg(source, 2048, 82);
    const meta = await sharp(out).metadata();

    expect(meta.width).toBe(800);
    expect(meta.height).toBe(600);
  });

  it('bakes EXIF orientation into the pixels', async () => {
    // A 200x100 landscape image tagged orientation=6 (rotate 90° CW on display)
    // should physically become 100x200 once orientation is applied.
    const source = await sharp({
      create: { width: 200, height: 100, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();

    const out = await resizeToJpeg(source, 2048, 82);
    const meta = await sharp(out).metadata();

    expect(meta.width).toBe(100);
    expect(meta.height).toBe(200);
    // Orientation tag should be cleared/normalised after baking.
    expect(meta.orientation === undefined || meta.orientation === 1).toBe(true);
  });
});

describe('imageFileToJpegDataUrl', () => {
  it('downscales a file on disk and returns a JPEG data URL', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-img-'));
    const file = path.join(dir, 'big.png');
    await sharp({
      create: { width: 3000, height: 2000, channels: 3, background: { r: 200, g: 50, b: 50 } },
    })
      .png()
      .toFile(file);

    const dataUrl = await imageFileToJpegDataUrl(file, 1200, 80);
    expect(dataUrl).not.toBeNull();
    expect(dataUrl!.startsWith('data:image/jpeg;base64,')).toBe(true);

    const decoded = Buffer.from(dataUrl!.split(',')[1], 'base64');
    const meta = await sharp(decoded).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.width).toBe(1200);
    expect(meta.height).toBe(800);

    fs.rmSync(dir, { recursive: true });
  });

  it('returns null for a missing file', async () => {
    const result = await imageFileToJpegDataUrl('/no/such/file.jpg', 1200, 80);
    expect(result).toBeNull();
  });
});
