import { describe, it, expect } from 'vitest';
import { chunkBySizeAndCount, MAX_UPLOAD_FILES, MAX_UPLOAD_BYTES } from '../utils/uploadChunks';

const MB = 1024 * 1024;

describe('chunkBySizeAndCount', () => {
  it('returns no chunks for an empty list', () => {
    expect(chunkBySizeAndCount([], (n: number) => n, 100, 70 * MB)).toEqual([]);
  });

  it('keeps everything in one chunk when within both limits', () => {
    const items = [1 * MB, 2 * MB, 3 * MB];
    const chunks = chunkBySizeAndCount(items, (n) => n, 100, 70 * MB);
    expect(chunks).toEqual([[1 * MB, 2 * MB, 3 * MB]]);
  });

  it('splits when the file count exceeds the max', () => {
    const items = Array.from({ length: 250 }, (_, i) => i);
    const chunks = chunkBySizeAndCount(items, () => 1, 100, 70 * MB);
    expect(chunks.map((c) => c.length)).toEqual([100, 100, 50]);
    // No item dropped or duplicated.
    expect(chunks.flat()).toEqual(items);
  });

  it('splits when the cumulative byte size would exceed the max', () => {
    // 30MB files, 70MB cap -> 2 per chunk (90MB would overflow).
    const items = [30 * MB, 30 * MB, 30 * MB, 30 * MB, 30 * MB];
    const chunks = chunkBySizeAndCount(items, (n) => n, 100, 70 * MB);
    expect(chunks.map((c) => c.length)).toEqual([2, 2, 1]);
  });

  it('never exceeds the byte cap within a chunk (unless a single item is over)', () => {
    const items = [40 * MB, 40 * MB, 10 * MB];
    const chunks = chunkBySizeAndCount(items, (n) => n, 100, 70 * MB);
    for (const chunk of chunks) {
      const total = chunk.reduce((a, b) => a + b, 0);
      expect(total).toBeLessThanOrEqual(70 * MB);
    }
  });

  it('places an oversized single item in its own chunk without looping', () => {
    const items = [100 * MB, 5 * MB];
    const chunks = chunkBySizeAndCount(items, (n) => n, 100, 70 * MB);
    expect(chunks).toEqual([[100 * MB], [5 * MB]]);
  });

  it('exposes limits matching the server cap and nginx body size', () => {
    expect(MAX_UPLOAD_FILES).toBe(100);
    expect(MAX_UPLOAD_BYTES).toBe(70 * MB);
  });
});
