# Backup and Restore: Design

**Status**: Approved design, not yet implemented
**Date**: 13 August 2026

## Purpose

The application currently has no backup story of its own. Everything that
matters lives under `DATA_DIR`: the SQLite database in `sb-materials.db`, and
the inspection photos and signatures under `uploads/`. Losing that directory
means losing every report the company has ever filed, and since the app is
deployed on a single box behind nginx there is nothing else holding a copy.

This design adds a backup and restore mechanism inside the application itself:
a scheduled worker that writes periodic tarballs to local disk with retention,
a superuser-only page for downloading those tarballs when an off-box copy is
wanted, and a restore path that accepts either an existing on-disk backup or
one uploaded through the browser.

Automatic off-box replication (pushing to S3 or similar) is deliberately out of
scope, because it brings credentials, a secrets story and network failure
handling for a benefit that a manual download already largely provides at this
scale. It remains an obvious later addition if the manual step proves too easy
to forget.

## Archive format

Backups are written to `${DATA_DIR}/backups/`, which is a sibling of `uploads/`
and so is never swept into its own archives. Each file is named
`sb-materials-<kind>-YYYYMMDD-HHMMSS.tar.gz`, where kind is one of `scheduled`,
`manual` or `pre-restore`, and the name encodes everything the listing UI needs
without having to open the file.

Each tarball contains three things:

- `manifest.json`, holding the format version, the application version, the
  creation timestamp, the kind, the database schema version the archive was
  taken under (`DB_SCHEMA_VERSION` in `server/src/db/schema.ts`), a schema
  fingerprint (the list of tables with their columns, informational only —
  see "Restore" below for what actually gates a restore), the report, photo
  and collection note counts, and a SHA-256 of the database file. The counts
  give the UI something human-meaningful to show before someone commits to a
  restore.
- `sb-materials.db`, produced through better-sqlite3's own `db.backup()`
  online-backup API rather than a filesystem copy. This matters: the database
  runs in WAL mode (`server/src/index.ts:35`), so copying the `.db` file with
  `cp` or streaming it into a tar whilst the app is serving requests yields a
  torn snapshot that may be missing recently committed transactions or be
  outright corrupt. The online backup API takes a consistent point-in-time
  copy whilst the app carries on working.
- `uploads/`, the photo and signature tree, copied verbatim.

`sessions.db` is deliberately excluded. Restoring live sessions is at best
pointless, and at worst leaves somebody logged in as a user ID that the
restored database defines as a different person.

Alongside each `.tar.gz` sits a `<archive>.tar.gz.manifest.json` sidecar holding
a copy of that same manifest, written straight from memory at creation time and
deleted with the archive it describes. It exists purely so that listing the
backups page does not have to open the archives: `tar` cannot read a single
member without streaming the whole gzip stream to EOF, so with a fortnight of
retained archives, a single list request would otherwise read several gigabytes
off disk and evict the page cache. An archive with no readable sidecar still
lists, simply without its report, photo and collection note counts.

Archive creation and extraction use the `tar` npm package, streaming to and
from disk, which avoids shelling out to a system binary and keeps behaviour
consistent between the developer machines and the deployment host.

## The scheduled worker

The worker is an in-process scheduler running inside the existing Express
process rather than a separate service, because a second process would need its
own systemd unit, its own deployment and its own access to the same database
for no benefit at this scale.

It ticks every five minutes and asks a single question: has today's configured
backup hour passed, and is the recorded `backup.last_run` earlier than that? If
both hold, it takes a backup and records the new `last_run`. Expressing the
schedule as a due-time comparison rather than a fixed timer is what makes it
robust across restarts: a box that was powered off overnight takes its missed
backup shortly after it comes back up rather than silently skipping a day, and
a process that restarts three times in an evening cannot take three backups.
It also avoids adding a cron-expression dependency for what is a single daily
trigger.

An in-memory mutex prevents a scheduled run from colliding with a manual "take
backup now", and retention pruning runs immediately after each successful
backup, keeping the newest N archives. Archives of kind `pre-restore` are
exempt from that pruning and keep their own quota of three, so that a botched
restore cannot be compounded by the retention policy quietly deleting the
safety copy it just made.

### Configuration

The schedule lives in the existing `app_settings` table, alongside the
collection-note settings, under the keys `backup.enabled`, `backup.hour`,
`backup.keep` and `backup.last_run`. The first three are added to the
`WRITABLE_SETTINGS` allowlist in `server/src/routes/settings.ts`, so they can
be edited through the UI; `backup.last_run` is deliberately left out of that
allowlist, since it is bookkeeping rather than configuration. Defaults are
enabled, 02:00, and fourteen retained archives.

## API

A new `/api/backups` router, mounted in `server/src/index.ts` alongside the
existing routers and therefore already covered by the CSRF middleware. Every
endpoint requires a superuser, using the existing `requireSuperuser` middleware:

| Method   | Path                        | Purpose                                       |
| -------- | --------------------------- | --------------------------------------------- |
| `GET`    | `/api/backups`              | List archives with filename, size, kind, date  |
| `POST`   | `/api/backups`              | Take a backup immediately                      |
| `GET`    | `/api/backups/:file/download` | Stream an archive to the browser             |
| `DELETE` | `/api/backups/:file`        | Delete an archive                              |
| `POST`   | `/api/backups/:file/restore` | Restore from an on-disk archive               |
| `POST`   | `/api/backups/restore/upload` | Restore from an uploaded archive             |

Every `:file` parameter is resolved by matching it against the actual directory
listing rather than by sanitising the string and joining it to a path, which
closes off directory traversal by construction instead of by vigilance.
Uploads are received through multer, as photos already are, and written to a
temporary file rather than buffered in memory, since these archives are large.
All of restore's scratch space (the uploaded file, the extraction used for
validation, and the copy of an on-disk archive taken before the pre-restore
snapshot's pruning can reach it) lives in `${DATA_DIR}/.restore-tmp/` rather
than in the system temporary directory. Peak usage is roughly one uncompressed
archive, and a unit running with `PrivateTmp=yes` gets a private tmpfs sized
against RAM, so using `/tmp` would mean a restore could fail with `ENOSPC`, and
an opaque 500, long before the volume the administrator sized for this data was
anywhere near full.

## Restore

Restore is the destructive half of this feature and is designed accordingly.
The sequence is:

1. **Validate.** Confirm the file is a gzip tar containing a `manifest.json` of
   a format version this code understands, that the database member opens as a
   valid SQLite database, that its SHA-256 matches the manifest, and that its
   database schema version (`dbSchemaVersion` in the manifest) is not higher
   than this build's own `DB_SCHEMA_VERSION`. That last check is deliberately
   one-directional: an *older* archive is always accepted, because the app's
   own boot-time migrations (`createSchema`) already tolerate that drift for
   any live database, restore or not, and the swap below always ends with a
   restart that runs them. An archive with no recorded version at all — taken
   before this field existed — is treated as version 0, the oldest possible,
   and is likewise always accepted. Only an archive from a build *newer* than
   this one is refused, since this build's migrations were written without
   knowledge of whatever schema change that newer build made. (An earlier
   version of this check compared the full table/column shape for exact
   equality instead, and it was too strict: a production database's
   `collection_notes` table had carried three columns — `weight`,
   `received_signature_path`, `received_signed_date` — since before the
   commit that dropped them from `CREATE TABLE`, because the migrations here
   are additive-only and nothing ever ran a compensating `DROP COLUMN`, so a
   fresh database never had them at all. That harmless, already-tolerated
   drift was enough to block a completely safe restore.) Anything that fails
   validation is rejected before a single existing file is touched.
2. **Snapshot.** Take a full backup of the current state, tagged `pre-restore`,
   so that restoring the wrong archive is recoverable rather than terminal.
3. **Stage.** Extract the archive into `${DATA_DIR}/.restore-staging/`.
4. **Mark.** Write a marker file recording the swap that is about to happen.
5. **Respond.** Return 200 to the browser whilst the app is still healthy, so
   the client can show its own "restarting" state rather than seeing a dropped
   connection and guessing.
6. **Exit.** Close both database handles and `process.exit(0)`, once the
   response has actually been flushed to the socket. Note that nothing is
   swapped here.
7. **Restart.** systemd brings the service back up, and the swap happens there:
   before anything else touches the data directory, startup finds the marker,
   moves the current `sb-materials.db*` and `uploads/` aside, moves the staged
   files into place, deletes `sessions.db`, and clears the marker.

That is a change from the obvious sequencing, in which the swap happens inline
before the exit and the startup check exists only to clean up after a crash, and
it is worth being explicit about why. Doing the swap only at startup means there
is exactly one code path that ever moves live data, and it is exercised by every
single restore rather than by the rare interrupted one; the crash-recovery path
is no longer a rarely-run branch that has to be right the first time it matters.
It also means the swap always runs against a data directory that no live process
is holding open, rather than one whose database handles were closed moments ago.
Every restore is, in effect, treated as an interrupted restore recovered on
boot.

The marker file written at step four is what makes this safe against a power cut
or an OOM kill: the swap is idempotent and driven entirely by what is on disk,
so it converges whether it is being run for the first time or resumed partway
through, and an interrupted restore leaves a working application rather than a
half-populated data directory. Where the swap cannot show that a set-aside
original has been superseded, it renames the leftovers to a timestamped
`.restore-aside-<when>` directory rather than deleting them, and logs that it has
done so, on the grounds that stale files needing a human are a far better outcome
than a deleted last copy.

Exiting the process and letting systemd restart, rather than swapping the
database connection in place, is a deliberate simplification. Every route
module currently receives its `Database` handle at construction time
(`reportRoutes(db)` and friends), so hot-swapping would mean threading a
mutable holder through all nine route modules and every helper, for the sake of
avoiding two seconds of downtime on an operation that happens perhaps once a
year.

## User interface

A new superuser-only `Backups` page, added to the menu alongside Users and
Lookups and gated on `is_superuser` in the same way. It shows a table of
existing archives with their date, size and kind, offering Download, Restore
and Delete per row; a "Take backup now" button; an "Upload and restore" file
input; and the schedule controls for enabled, hour and retention count.

Restore goes through the existing `ConfirmDialog` component but with a typed
confirmation rather than a plain acknowledgement, and the dialog shows what the
manifest says the archive contains (its date, and its report, photo and
collection note counts) so that the decision is made against the archive's
actual contents rather than against a filename. Once a restore is accepted
the page switches to a
full-screen overlay explaining that the application is restarting, polls until
the server answers again, and then sends the user to the login page, since the
session store has been cleared by then.

## Testing

Unit tests cover the archive round trip against temporary directories, creating
an archive from a known data directory and extracting it to compare; manifest
validation, including rejection of a truncated archive, one with a corrupt
database, one with a mismatched checksum and one with an unknown format
version; acceptance of an older (or unversioned) database schema and rejection
of a newer one than this build supports; the filename resolution, including
traversal attempts; retention
pruning, confirming it keeps the newest N and never prunes a `pre-restore`
archive; and the scheduler's due-time logic across simulated restart and
missed-window boundaries.

Route tests follow the existing `server/src/__tests__/helpers.ts` pattern and
cover authorisation on every endpoint, since a non-superuser reaching any of
these would be able to exfiltrate the entire database.

The restore swap is written as a pure function over directory paths and tested
directly, including the crash-recovery paths, by invoking the startup marker
check against deliberately half-swapped directories. The `process.exit` call
remains a thin untested wrapper around it.

## Operational dependencies

Two things outside this repository must be true for this to work, and both need
confirming before the feature is deployed.

The systemd unit `sb-materials.service` must be configured with
`Restart=always`. Restore relies on the process exiting and being brought back
up; if the restart policy is not set, a restore will stop the application
rather than complete. `sb-materials.service.example` in this repository is a
unit with that directive and an explanation of why it is there, and the README
says the same in its deployment section, so that this cannot be missed by
somebody who never reads this document.

The nginx configuration currently caps request bodies at 75M, which was sized
for photo uploads. An uploaded backup archive contains the entire photo tree
and will comfortably exceed that, so the `/api/backups/restore/upload` location
needs its own larger `client_max_body_size`, or the upload will be rejected
with a 413 before Express ever sees it. `nginx.conf.example` in this repository
should be updated to match whatever the deployment uses.

## Known costs and trade-offs

The main ongoing cost is disk. Each archive holds a complete copy of the photo
tree, so fourteen nightly archives occupy roughly fourteen times the size of
`uploads/`. Photos are already resized on upload to 2048px at quality 82, which
keeps the individual files modest, but the multiple is real and will grow with
the archive. Making retention configurable through the UI is the mitigation:
if disk becomes tight, the count can be reduced without a redeploy.
Deduplicating unchanged photos between archives would fix this properly, but it
would replace a format anyone can open with `tar -xzf` with something bespoke,
and that is a poor trade for a small internal application.

The second trade-off is that these backups sit on the same disk as the data
they protect, so they defend against accidental deletion, a bad restore and
application-level corruption, but not against the machine dying. Closing that
gap is what the manual download is for, and what an automatic off-box push
would eventually address.
