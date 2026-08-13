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
  creation timestamp, the kind, a schema fingerprint (the list of tables with
  their columns), the report and photo counts, and a SHA-256 of the database
  file. The fingerprint is what lets a restore refuse an archive taken against
  a schema the running code cannot read, and the counts give the UI something
  human-meaningful to show before someone commits to a restore.
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

## Restore

Restore is the destructive half of this feature and is designed accordingly.
The sequence is:

1. **Validate.** Confirm the file is a gzip tar containing a `manifest.json` of
   a format version this code understands, that the database member opens as a
   valid SQLite database, that its SHA-256 matches the manifest, and that its
   schema fingerprint is one the running code can read. Anything that fails
   here is rejected before a single existing file is touched.
2. **Snapshot.** Take a full backup of the current state, tagged `pre-restore`,
   so that restoring the wrong archive is recoverable rather than terminal.
3. **Stage.** Extract the archive into `${DATA_DIR}/.restore-staging/`.
4. **Mark.** Write a marker file recording the swap that is about to happen.
5. **Respond.** Return 200 to the browser whilst the app is still healthy, so
   the client can show its own "restarting" state rather than seeing a dropped
   connection and guessing.
6. **Swap.** Close both database handles, move the current `sb-materials.db*`
   and `uploads/` aside, move the staged files into place, delete
   `sessions.db`, then `process.exit(0)`.
7. **Restart.** systemd brings the service back up against the restored data.

The marker file written at step four is what makes this safe against a power
cut or an OOM kill in the middle of step six. On startup the application checks
for it before anything else, and either completes the interrupted swap or rolls
it back to the pre-restore state, so an interrupted restore leaves a working
application rather than a half-populated data directory.

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
manifest says the archive contains (its date, and its report and photo counts)
so that the decision is made against the archive's actual contents rather than
against a filename. Once a restore is accepted the page switches to a
full-screen overlay explaining that the application is restarting, polls until
the server answers again, and then sends the user to the login page, since the
session store has been cleared by then.

## Testing

Unit tests cover the archive round trip against temporary directories, creating
an archive from a known data directory and extracting it to compare; manifest
validation, including rejection of a truncated archive, one with a corrupt
database, one with a mismatched checksum and one with an unknown format
version; the filename resolution, including traversal attempts; retention
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
rather than complete.

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
