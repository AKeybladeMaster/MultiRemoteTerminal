# ADR-0063: Persist bounded transfer interruption status

**Status:** Proposed; Phase 07 acceptance remains pending

## Context

N-010 requires interrupted file-transfer status to remain available after a
utility-worker failure and application restart. Existing transfer staging
adapters may leave partial files after forced process termination. Recovery
must not guess a path, delete a same-named file, replay a transfer, or retain
credentials merely to improve restart behavior.

## Decision

- Persist an operation UUID, transport, direction, validated display filename,
  checkpointed byte counts, status/error code and UTC timestamps in a separate
  SQLite table. Do not persist local or remote paths, session IDs, connection
  endpoints or credentials in this recovery record.
- Persist at most two validated remote artifact basenames for an interrupted
  upload. Their bound and FTP control-character policy match the existing
  remote filename contract (1,024 UTF-16 code units); they are names, not paths.
  SFTP stage names derive from the operation UUID; the stage and optional
  overwrite-backup basenames are recorded before transport start, and an
  artifact-metadata write failure prevents the upload from starting. FTP/FTPS
  STOU names arrive in the preliminary server response. The worker sends the
  basename to the main process and waits for a correlated acknowledgment after
  SQLite commits it; a failed or timed-out write prevents the upload data phase
  from starting. Missing or invalid STOU names fail closed. A process crash
  between receiving the preliminary response and committing the basename can
  still leave an unidentified zero-byte server object. Names are for manual
  inspection only and never authorize a remote read, resume, rename or delete.
  Failed or cancelled FTP/FTPS uploads that have durably reported an artifact
  basename remain visible as interrupted records, because an error such as a
  late conflict can still leave a server-side stage or backup.
- When a user opens a remote folder, mark regular-file names that exactly match
  interrupted SFTP operation stages, persisted SFTP overwrite-backup basenames, or persisted FTP/FTPS artifact basenames as
  possible artifacts. This checks only the visible listing: it does not persist
  a directory, search other folders, prove identity, or authorize file actions.
- Assign one UUID to each app-process run and pass it to every storage-worker
  generation. At startup, change rows left `running` by an earlier app run to
  `interrupted` before the worker reports ready. A storage-worker replacement
  within the same app run must not mislabel a still-live transfer.
- Before upgrading an existing SQLite schema, create one sibling snapshot with
  Node's [SQLite backup API](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html#sqlitebackupsource-db-path-options)
  and verify its schema version and `quick_check`.
  Snapshot populated version-zero databases; skip only a blank version-zero
  database. Run all schema-version steps in one transaction so a failed
  migration rolls back as a unit. Retain the snapshot until a later schema
  upgrade replaces it; workbench preferences share this database.
- Expose interrupted records in 100-row keyset pages ordered by update time and
  operation ID, with explicit dismissal via the validated preload command
  bridge. A targeted lookup supports inspecting an older download without
  loading every page. Never auto-resume or clean a partial file from this
  metadata. Retain at most 10,000 `running` or `interrupted` records; acquire a
  SQLite write transaction before checking the limit and inserting a new row.
  When full, reject the new tracked transfer with `BUSY` and preserve every
  existing recovery record until the user dismisses one.
- Checkpoint progress at most once per second; the displayed value is the last
  persisted checkpoint and may be lower than the final byte count.
- Finalizing a record keeps the greatest persisted byte checkpoint and any
  previously known total when the final report is lower or omits the total.

## Consequences

The user can see a durable interruption status after process restart without
the renderer receiving local paths or credentials. SQLite upgrades preserve a
verified pre-migration snapshot and atomically roll back schema changes when a
migration fails; a candidate snapshot is verified before replacing the retained
backup. Keyset pages keep older interrupted records reachable without an
unbounded query. At the 10,000 nonterminal-record limit, new tracked transfers
fail with `BUSY`; the app never silently prunes an interruption to make room.
The app cannot automatically locate or remove an old partial
file; it can mark exact filename matches only inside a folder the user opens.
Retry remains a separate explicit file-browser operation. A synthetic persisted-row
restart E2E, a live SFTP worker-termination/restart E2E, and unit/contract
tests cover the behavior and await final review-remediation verification. The
worker test checks durable status and no auto-reconnect. An additional authored,
unrun Windows E2E forcibly terminates the app while a download record is still
running, then checks the row remains durable before restart and becomes
interrupted without a repeated SFTP request. Local download stages use the recovery operation UUID. A
typed main-process action lets the user choose a folder and reveal only the
matching regular non-symlink stage in Explorer; it does not delete or resume
the file or return its path to the renderer. Unit, broker and contract tests are
authored but unrun; the native Windows folder-picker E2E now covers cancellation
and selection of the directory containing the exact stage. Two unrun
restart unit cases also check that committed credential-vault and legacy
host-trust JSON survive malformed abandoned sibling staging files; these only
cover atomic replacement behavior, not power-loss recovery. SFTP upload stages
use the durable operation ID in their remote basename; overwrite backup names
are also operation-scoped and persisted before commit. The status banner shows
possible names for manual inspection without storing or locating the remote
directory. FTP/FTPS interruption records now preserve up to two
validated artifact basenames: a server-reported STOU name and app-generated
overwrite stages/backups. The worker waits for the durable metadata
acknowledgment before allowing STOU payload bytes to start. Missing or
nonconforming STOU names fail before upload data begins. The name and connection
are not retained, so the user must reconnect and inspect manually. A process
crash between receiving a STOU reply and committing its name can still leave an
unidentified zero-byte server object. Broader non-SQLite app-configuration
recovery and remote-directory reconciliation also remain open, so N-010 stays
PARTIAL.

## Acceptance

- Validate record shape, file name, UUID, byte counts, error code and timestamp
  at domain, storage-worker and renderer IPC boundaries.
- Verify stale app-run rows become `interrupted`, the recovery run ID remains
  stable across storage-worker replacement, dismissal deletes only the
  selected interrupted record, and the pre-migration snapshot passes integrity
  checks while a failed multi-version upgrade leaves the original schema intact.
- Verify a stale final interruption report cannot reduce a persisted byte
  checkpoint or erase a previously known transfer total.
- Verify a rejected legacy workbench-settings migration leaves its stored JSON
  and schema version unchanged.
- Verify 100-row keyset pagination reaches every interrupted row, including
  older rows after more than one page, and targeted lookup remains scoped to an
  interrupted operation.
- Verify new tracked transfers fail with `BUSY` at 10,000 nonterminal records
  and leave all existing recovery metadata unchanged.
- Windows restart E2E seeds a prior `running` row and verifies the user-visible
  interruption and explicit dismissal. The live SFTP E2E kills the SSH utility
  worker during transfer, then verifies status persistence through app restart
  and no automatic reconnection. These tests await the Phase 07 gate; partial-
  file reconciliation remains open.
- Windows E2E forcibly terminates the app during a download and during an SFTP
  overwrite commit after the original target has moved to its operation-ID
  backup. It verifies the local stage, remote `.partial` and retained `.backup`
  survive, the next app run marks the upload `interrupted` without an automatic
  SFTP request, and opening the remote folder marks both exact regular files as
  possible artifacts. This acceptance is authored but unrun.
- Verify local download stages use the operation UUID, the main process accepts
  reveal requests only for an interrupted download, the user selects the
  containing directory, and only the exact regular non-symlink stage is shown
  in Explorer. Native Windows folder-picker cancellation and exact-folder
  selection E2E is authored but awaits the Phase 07 gate. Verify the SFTP
  upload basename matches its operation UUID and is shown without the path;
  FTP/FTPS worker failure and app restart retain a valid server-selected STOU
  basename and show it for manual inspection without a path. Automatic remote
  directory lookup and broader non-SQLite recovery remain open. A Windows FTP
  E2E must inspect SQLite when the first payload bytes arrive and verify the
  server-selected basename is already committed; this source is authored but
  awaits the Phase 07 gate. The process-crash interval between the STOU reply
  and SQLite commit can leave an unidentified zero-byte object.
- Verify interrupted SFTP overwrite uploads retain the operation-scoped backup
  basename in recovery metadata when replacement and rollback fail, and mark
  its exact matching regular file after the user opens that folder. The provider
  unit case and Windows crash-at-backup UI E2E are authored but await the Phase
  07 gate.
- A Windows restart E2E must verify that reopening a remote folder marks an
  exact matching interrupted upload artifact name, without persisting the
  folder or issuing resume/delete operations. The current E2E source is authored
  but unrun; name equality is not identity proof.
- Verify SQLite-backed workbench settings are retained in the snapshot. The
  credential-vault and legacy host-trust abandoned-staging restart tests await
  the Phase 07 gate; broad non-SQLite app-config recovery and partial-file
  reconciliation stay open before claiming N-010.
- Bound the serialized remote-artifact metadata to 8 KiB on SQLite writes and
  reject non-text or oversized persisted values before JSON parsing. The
  regression test for a corrupt oversized row is authored but awaits the
  major-phase verification gate.
- Verify failed or cancelled FTP/FTPS uploads with durably reported artifact
  basenames remain visible as interrupted recovery records, including a late
  conflict after staging; artifact-free failures keep their normal outcome.

## 2026-11-01 same-run SFTP cleanup and recovery messaging

The durable recovery record never authorizes automatic transfer resume, remote lookup, rename, or deletion. Separately, the existing WP-05K worker-owned recovery registry may remove only its exact SFTP `.partial` stage after a reconnect to the same trusted route while that SSH utility worker remains alive; this behavior predates and does not read the durable recovery metadata. It does not remove SFTP overwrite backups or FTP/FTPS artifacts. Recovery UI copy now discloses this distinction, and authored Windows E2E assertions cover both SFTP disclosure and FTP artifact retention. These source changes remain unverified under the major-phase test freeze.
