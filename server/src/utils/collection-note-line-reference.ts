import Database from 'better-sqlite3';

/**
 * Each line of a collection note carries its own unique reference, allocated
 * by the app rather than typed: the note's reference with a suffix, so
 * SBM1061 has lines SBM1061-1, SBM1061-2 and so on. This is separate from the
 * free-text reference the user puts on a line, which is SB Materials' own and
 * may be anything.
 *
 * A line keeps the reference it was given for as long as it exists, so
 * deleting a line never renumbers the ones around it, and the suffix carries
 * on from the highest already used.
 */

const SUFFIX = /-(\d+)$/;

/** The suffix of a line reference, or null when it does not conform. */
export function parseLineSuffix(lineReference: string | null | undefined): number | null {
  const match = SUFFIX.exec((lineReference ?? '').trim());
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Every line reference in use, lower-cased.
 *
 * Captured before a save replaces a note's lines, so that a reference which
 * belonged to a line being deleted is not immediately handed to a new one:
 * the number may already have been quoted on paper by then.
 */
export function takenLineReferences(db: Database.Database): Set<string> {
  const rows = db.prepare('SELECT line_reference FROM collection_note_items').all() as {
    line_reference: string | null;
  }[];
  return new Set(rows.map((row) => (row.line_reference ?? '').toLowerCase()).filter(Boolean));
}

/**
 * Allocate references for the lines of a note that do not have one yet,
 * leaving those that do exactly as they are.
 *
 * Candidates are checked against every reference in use rather than just this
 * note's, because a note's reference can be overtyped: a line may keep a
 * reference whose prefix another note now uses, and handing the same string
 * out twice would trip the unique index and fail the save.
 */
export function allocateLineReferences(
  taken: Set<string>,
  noteReference: string,
  lines: { line_reference?: string | null }[],
): string[] {
  const inUse = new Set(taken);

  let next = 0;
  for (const line of lines) {
    const suffix = parseLineSuffix(line.line_reference);
    if (suffix !== null && suffix > next) next = suffix;
  }

  return lines.map((line) => {
    const existing = (line.line_reference ?? '').trim();
    if (existing) return existing;
    let candidate = '';
    do {
      next += 1;
      candidate = `${noteReference}-${next}`;
    } while (inUse.has(candidate.toLowerCase()));
    inUse.add(candidate.toLowerCase());
    return candidate;
  });
}
