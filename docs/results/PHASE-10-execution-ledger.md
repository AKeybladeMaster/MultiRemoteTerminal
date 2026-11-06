# Phase 10 execution ledger — security and architecture

**Status:** PARTIAL; source-boundary checks and existing security acceptance pass, but platform, account-migration, interoperability, and release-review evidence remains open. No Phase 10 acceptance or promotion is claimed.

## Requirement trace

Phase 10 covers F-010, F-012, F-027, P-03, P-29, P-42, P-45, N-002–N-005, and N-012. The feature matrix and linked WP-07/WP-02 evidence remain authoritative for earlier slices.

## Current evidence

- The latest pinned-runtime `pnpm check` passed TypeScript/tools typecheck, ESLint and static import-boundary checks, all 622 unit tests, and the Windows x64 native/renderer build. This is code-level regression evidence, not a final security review.
- Existing Windows E2Es in that run passed SSH host-key rotation/reset, saved-credential exclusion, same-account safeStorage restart, master-password conversion/reset/profile restore, and the synthetic vault lock event. The 20-active-session profile also ran. Synthetic lock events do not establish physical Windows lock/resume behavior.
- The full E2E suite was 64 passed, 10 failed, 7 skipped. Native local-file, credential-bundle, custom-logo, and SSH-log dialogs could not acquire foreground focus. Other failing cases are recorded in the Phase 07/08 ledgers. The packaged session-log shutdown test was skipped by `pnpm check`; package smoke was not run.
- `pnpm dependencies:inventory` regenerated the workspace CycloneDX development inventory with 395 installed package entries. The only generated SBOM change is a transitive `re2js` update from 2.8.6 to 2.8.7. This metadata refresh is not a license/provenance judgment or distribution SBOM. [WP-07AA](WP-07AA-dependency-license-inventory-2026-10-30.md) remains partial.
- Prior WP-07Z and WP-07H evidence records the credential-boundary source review and Electron checklist review. No independent three-axis review ran on the current exact mission candidate because its phase gate failed.

## Open requirements and limits

- F-010/P-29: physical Windows lock/resume, cross-account restore, Windows-account-protected vault migration/restore, and remaining credential flows are unverified. The host run exercised only a synthetic lock event and same-account profiles; no second Windows account or physical lock interaction was available to this run.
- F-012/N-002: the renderer has no Node integration, IPC remains allowlisted and runtime-validated, and workers are process boundaries, not OS sandboxes. Broader privilege-injection, packaged native-prompt, and protocol interoperability security acceptance remains open.
- F-027/P-45: historical WP-02C acceptance covers consent, path selection, bounded logging, and portable shutdown finalization. Current un-packaged session-log picker revalidation failed at foreground activation; package smoke was not run, so no new acceptance is claimed.
- N-003/N-004/N-005: existing explicit-action, fake-port, typed-error and redaction tests passed in the 622-unit run; the exact final full-suite result remains blocked by unrelated failures, so these IDs are not upgraded here.
- N-012: the last verified SBOM records package metadata only. Current unverified packaging source also generates a bounded production dependency notice resource and hashes it; license-text compatibility, source provenance, full distribution contents, independent architecture/security review, and signed artifact provenance remain open.

## Next actions

Complete platform/account migration acceptance in an authorized Windows environment, close native dialog and packaged-flow validation, finish the dependency/license/provenance review, and obtain independent specification, standards, and implementation reviews after the relevant gates are green. Continue with independent Phase 11 work while those external proofs remain unavailable.

## Current candidate update - 2026-10-31

- Current end-of-phase verification remediation produced 647/647 passing unit tests, typecheck/lint/build passes, but the full Windows E2E stage failed with 66 passed, 10 failed and 7 skipped. Focused native local-text picker selection remains unable to close its dialog in this host session; four focused paste workflows read an empty system clipboard after the app writes it. These are not acceptance passes. Details are in the [Phase 07 ledger](PHASE-07-execution-ledger.md).
- The current implementation now adds fail-closed presence checks and hashes for the Electron and Chromium notice files in the Windows distribution SBOM and checksum manifest, with package-smoke assertions authored. These edits are unverified; the existing generated artifacts predate them.
- Current source additionally prepares and embeds top-level production dependency license/notice texts and hashes the bundled notice resource. Its unit and package-smoke assertions are authored but have not run; no notice artifact has been generated from the current source.
- Physical Windows session lock, cross-account vault restore, Windows 10, native dialog/clipboard interaction, and publisher signing remain unavailable or unverified. No Phase 10 acceptance or promotion is claimed.
- N-010 recovery finalization now preserves the greatest persisted byte checkpoint and known transfer total when a final interrupted-transfer report is lower or omits the total. A focused SQLite regression assertion is authored and unrun; this does not close restart, migration, or partial-file reconciliation acceptance.
- Workbench-settings recovery coverage now asserts that malformed legacy JSON remains byte-for-byte unchanged at its prior schema version after migration rejection. This test is authored and unrun; it does not replace full restart and migration-failure acceptance.


## N-010 migration rollback regression - 2026-10-31

- Strengthened the authored SQLite regression to fail after an earlier migration step has changed schema within the transaction, then assert schema version, prior column state, and retained conflicting-table data survive rollback. No test ran; this is coverage authored for N-010 and does not establish migration acceptance.


## N-010 abrupt application termination recovery - 2026-10-31

- Added unrun Windows E2E coverage for forced application termination during an active SFTP download. It checks committed recovery metadata and the local stage survive process exit, then checks startup converts the stale run to `interrupted` without an automatic SFTP request. This strengthens restart coverage but does not close broader non-SQLite app-config or remote-artifact reconciliation requirements.


## N-010 bounded recovery-record count - 2026-10-31

- Static recovery-path review found that terminal transfer rows are pruned but interrupted rows are intentionally retained until explicit dismissal and had no total bound. The SQLite repository now retains at most 10,000 running/interrupted records; `BEGIN IMMEDIATE` protects the count-and-insert decision. At capacity it returns `BUSY` without deleting prior user-visible recovery metadata.
- Added a regression test that seeds the cap, asserts a new tracked transfer is rejected, and confirms all interrupted rows remain. Updated ADR-0063, the recovery architecture description, SPEC-001 N-010, FEATURE-MATRIX N-010, and the implementation-plan work package. No tests ran; N-010 and Phase 10 remain unverified and partial.
## N-010 recovery filename display hardening - 2026-10-31

- Recovery status now renders C0/C1 controls, Unicode line separators, and hidden direction marks in file names and artifact basenames as visible U+ labels. This keeps remote-controlled names from visually reordering or hiding recovery guidance while preserving ordinary Unicode, including emoji joiners. Added unrun renderer-helper coverage; no automated checks or phase verification ran. N-010 and Phase 10 remain PARTIAL pending the Phase 07 gate and platform/account acceptance.
## N-010 bounded recovery artifact metadata parsing - 2026-10-31

Static review found SQLite recovery decoding converted the persisted artifact-name column to a string and passed it directly to JSON.parse. Writes already validate at most two safe basenames, so a normal row is small, but a corrupted or externally modified database could supply an arbitrarily large JSON value to the parser. The adapter now caps serialized metadata at 8 KiB on write, rejects non-text or oversized values before parsing on read, and returns the existing CORRUPT category for malformed persisted data. A SQLite regression test seeds an oversized interrupted-upload row and asserts corruption; it is authored but unrun under the major-phase freeze. N-010 remains PARTIAL pending broader recovery reconciliation and the Phase 07 gate.
## N-010 persisted-state recovery inventory - 2026-10-31

Static source inspection of the user-data composition found the SQLite database, the encrypted `credentials.json` vault, and legacy `ssh-host-keys.json` as the long-lived persisted state paths. Workbench preferences, sessions, tunnels, macros, and transfer recovery records reside in SQLite. The two JSON writers use unique same-directory temporary files, exclusive creation, file flush, and rename; authored restart cases cover an abandoned sibling staging file beside each committed JSON document. This narrows the earlier broad "non-SQLite app configuration" note to credential-vault corruption/recovery and migration-only host-trust handling. It does not prove power-loss durability, recovery from a corrupt committed vault, or cross-account behavior; N-010 remains PARTIAL and no test ran.

## 2026-11-01 Credential-vault path identity guard (unverified)

The shared vault-document reader now uses lstat, rejects symbolic links, and compares the opened file's device/inode identity with the path entry before reading. This covers initialization and conversion staging reads, preventing a path swap from silently substituting another document. Added a unit regression that skips only when the Windows account cannot create a symbolic link. No automated checks ran; N-010 and Phase 10 remain PARTIAL.

## 2026-11-01 Legacy host-trust path identity guard (unverified)

The shared legacy host-trust JSON reader now rejects symbolic links and checks that the opened file has the same device/inode identity as the path entry inspected before opening, including migration snapshot and retirement reads. Added a Windows-capability-aware unit regression. No automated checks ran; N-010 and Phase 10 remain PARTIAL.


## 2026-11-01 Durable FTP artifact retention across progress updates (unverified)

The shared transfer tracker now merges progress snapshots so a later event without remoteArtifactNames does not erase previously checkpointed remote artifact names. Static review of the FTP provider confirmed it sends artifact names only when changed, followed by ordinary progress events without that property. Added a unit regression that discovers an artifact, receives a later nameless progress event, then fails with CONFLICT; it asserts the record remains interrupted with the latest byte count. No automated checks ran; N-010/Phase 10 remain PARTIAL.

## 2026-11-01 N-010 uncertain SFTP overwrite rollback (unverified)

A static review found that a changed remote object could remain in an overwrite backup after rollback failure while the provider returned terminal `CONFLICT`, hiding that backup from the interrupted-recovery view. The provider now returns `UNAVAILABLE` when it cannot restore the object, and the fake-SFTP regression checks the retained backup name. The test remains unrun; N-010 and Phase 10 remain PARTIAL.
Follow-up (2026-11-01): Added a recovery-use-case regression for the same rollback failure, verifying the durable interrupted row and `.partial`/`.backup` names. It remains unrun under the major-phase freeze.
## 2026-11-01 N-010 SFTP failed-stage cleanup visibility (unverified)

Failed cleanup of an owned SFTP upload stage now surfaces as `UNAVAILABLE`, preserving interrupted recovery status after a commit-time skip race or cancellation. The operation stage basename was already durably recorded before transport start; same-route cleanup remains bounded and isolated. Fake-SFTP coverage is authored but unrun, and N-010/Phase 10 remain PARTIAL.
Correction to the 2026-11-01 SFTP cleanup note: the cleanup registry is worker-local, not durable across worker termination or app restart. The SQLite interrupted record remains available for manual inspection; automatic remote reconciliation remains open.
## 2026-11-01 local download-stage cleanup failure

FTP and SFTP download providers now preserve an interrupted outcome when cleanup of the local operation-scoped partial fails. The shared cleanup contract reports `UNAVAILABLE`; it does not recursively delete a replacement directory. FTP and SFTP provider regression cases are authored but unrun. N-010 and Phase 10 remain PARTIAL.
Follow-up (2026-11-01): The local staged-download identity guard now prevents ordinary replacement-file cleanup or commit and leaves the mismatched object intact. The FTP/SFTP regressions are authored but unrun. A concurrent replacement between the path identity check and path-based operation remains possible.
## 2026-11-01 N-010 explicit-undefined progress metadata guard (unverified)

- unTrackedFileTransfer now preserves previously captured remote artifact names if a later progress snapshot includes emoteArtifactNames: undefined, which object spread previously overwrote. The FTPS tracker regression now covers that runtime shape. No automated checks ran; N-010 and Phases 07/10 remain PARTIAL.
## 2026-11-01 generated release-metadata write safety (unverified)

N-012 output generation now stages bounded notice, dependency-inventory, SBOM, and checksum documents in unique exclusive workspace-local siblings, syncs them, rechecks the observed destination before atomic replacement, and removes only the operation's temporary file on failure. Added a package-release assertion for successful replacement without temporary-file residue. No automated check, SBOM, or package output ran; Phase 10/N-012 remain PARTIAL.

## 2026-11-06 essential shutdown/recovery implementation (unverified)

Both existing main-process teardown paths now attempt later cleanup after an individual provider rejects. Application quit independently attempts session-log finalization, terminal providers, X11, and storage shutdown; storage runs in finally. Storage-worker shutdown now has a three-second deadline, reports a typed unavailable error/redacted diagnostic when exit does not arrive, and reports failed/throwing kill attempts. It retains the genuine worker-exit barrier: timeout never cleans a still-live worker's staging files, fabricates exit, or allows worker replacement. Three launcher-seam regressions are authored for kill-without-exit, false, and throw, followed by genuine-exit cleanup checks. Existing main composition has no injected-failure seam; no redundant wrapper/source-string test was added. No tests/typecheck/lint/build ran. N-010 account/platform/power-loss and broader recovery acceptance remain PARTIAL.
