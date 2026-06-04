// Limits for a single photo-upload request. The client posts all newly added
// photos for a report, and inspections routinely carry dozens of large phone
// photos, so a big save is split into several requests that each stay within:
//   - MAX_UPLOAD_FILES: the server's multer per-request file cap
//   - MAX_UPLOAD_BYTES: under nginx's client_max_body_size (75M), with margin
//     for multipart overhead
export const MAX_UPLOAD_FILES = 100;
export const MAX_UPLOAD_BYTES = 70 * 1024 * 1024;

/**
 * Greedily split items into chunks where each chunk has at most `maxCount`
 * items and a total size at or below `maxBytes`. A single item larger than
 * `maxBytes` is placed in its own chunk (it can't be split further).
 */
export function chunkBySizeAndCount<T>(
  items: T[],
  sizeOf: (item: T) => number,
  maxCount: number = MAX_UPLOAD_FILES,
  maxBytes: number = MAX_UPLOAD_BYTES,
): T[][] {
  const chunks: T[][] = [];
  let current: T[] = [];
  let currentBytes = 0;

  for (const item of items) {
    const size = sizeOf(item);
    if (current.length > 0 && (current.length >= maxCount || currentBytes + size > maxBytes)) {
      chunks.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(item);
    currentBytes += size;
  }
  if (current.length > 0) chunks.push(current);

  return chunks;
}
