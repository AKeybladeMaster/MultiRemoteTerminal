# Phase 07 execution ledger — sessions, tunnels and productivity

**Status:** Phase 07 implementation remains active after additional N-010 changes; the final gate and affected-scope re-review are pending. Phase 07 acceptance and promotion remain blocked by PARTIAL requirements and unavailable live OpenSSH interoperability configuration.

## Prior resumed verification freeze - 2026-10-31

- This historical checkpoint was reopened by later implementation and documentation changes. The latest source and E2E additions are the N-010 SFTP overwrite-crash boundary, pre-transfer SFTP artifact-name persistence, and an upload-only test conflict-policy hook. This freeze is only a verification checkpoint; it does not waive any open acceptance criteria or claim Phase 07 complete.
- P-25 remains PARTIAL for SOCKS authentication, BIND, UDP ASSOCIATE and broad interoperability; the existing SSH forwarding interface carries TCP streams and the safe-alternative research is linked above. N-010 remains PARTIAL for broader non-SQLite configuration recovery and remaining recovery reconciliation evidence. F-007/P-28 macro prompt detection and public-server behavior, P-22/P-24 public-server forwarding behavior, and the Phase 02 resize regression also remain open.
- Current-candidate checks are eligible to run only as a whole-phase gate. Passing source checks cannot qualify promotion while mandatory acceptance remains PARTIAL or externally unverified. No tests, review, commit, push or promotion are claimed by this freeze entry.
- The first pinned-toolchain typecheck after the freeze found a preload helper type union missing the already-defined `powershell.tool.manage` command. The helper type is corrected in the current candidate; this reopens verification and the full gate must run on this exact source. No runtime authorization behavior changed.

## Verification-gate remediation - 2026-10-31

- The next pinned-toolchain typecheck also found authored-source errors in the SFTP crash E2E delay callback and in Phase 08 package-smoke / package-release test typings. Corrected the callback to use a local bounded delay, changed the SBOM hash assertion to the matcher intended for object properties with a safe optional array read, and typed subprocess environments as `NodeJS.ProcessEnv` before deleting inherited signing variables.
- The pinned TypeScript/tools typecheck passed after these corrections. The subsequent lint run found unused parameters in a new broker-test authorization stub; the stub now uses a zero-argument callback. Lint and all remaining checks must rerun on the corrected source. The candidate is back in implementation remediation, not frozen; no phase acceptance or promotion is claimed.
- On the corrected source, pinned TypeScript/tools typecheck passed and ESLint plus all static import-boundary checks passed. The Windows x64 build and remaining tests are pending.
- The Windows x64 build passed on the same source, including node-gyp native compilation and renderer packaging. Vite reports a 1,051.98 kB minified renderer chunk, above its 500 kB advisory threshold; this is recorded as a warning, not a functional acceptance failure.
- The first full unit run reported a stale assertion in the Phase 08 production-notice unit test: the implementation emitted “incomplete production package license record” while the test omitted “production.” The assertion now matches the exact current error; the full suite must rerun.
- The rerun exposed three additional issues. The 1,024-character recovery-name assertion used a download record even though only uploads may contain remote artifact names; the WP-11E controller test expected a superseded WinGet interactive-install command; and N-012 filename validation filtered names before checking bidi/control characters, allowing `LICENSE<U+202E>.txt` to evade classification. Corrected the two fixtures and added pre-classification sanitization solely for detecting hidden control/format characters in license-like filenames. The complete unit suite must rerun on these changes.
- The next full unit run passed 661/662; one additional recovery test still used a download record for the safe backslash-containing FTP artifact name. Updated the malformed-path, duplicate-name, backslash-name and C1-control assertions to use upload records, while preserving the explicit rejection of artifact names on download records. The full suite must rerun.
- After that fixture correction, the full pinned unit suite passed 662/662. This exact run includes the N-012 disguised-control filename regression and WP-11E command-route coverage. Typecheck, lint, build, integration, Electron E2E, full check, package smoke and remaining phase acceptance must be rerun on the final candidate.
- The pinned SSH integration command exited successfully with 0 passed / 1 skipped / 0 failed because `MRT_TEST_SSH_HOST`, `PORT`, `USERNAME`, `PASSWORD`, and `FINGERPRINT` are not configured. Public/disposable OpenSSH interoperability remains unverified; the skip is not a pass.

## Requirement trace

Phase 07 covers F-004, F-006–F-008, F-011; P-13, P-19, P-22–P-25, P-28,
P-38–P-40; and the relevant scalability/recovery portions of N-009/N-010.
The current matrix and historical acceptance records remain the source for
work already verified.

Existing evidence covers WP-03B–H session catalogs, search, folders and
credential-free export/import; WP-04A–I local/remote/dynamic tunnel forwarding
and routes through three gateways; WP-04L raises the configured route maximum
to eight, with max-depth unit/provider coverage and terminal, SFTP-only and all
tunnel-mode eight-gateway Windows E2E awaiting the gate; and WP-06A–F macro storage, recording,
playback, MultiExec and shortcuts. It includes 1,009 saved session definitions,
20 simultaneous saved tunnels, 100 saved/replayed macros, and confirmation of
MultiExec delivery to three independent SSH fixtures. These records do not
prove broader public-server interoperability. The N-009 memory profile is now
captured, pending final-candidate revalidation.

## Current implementation

- **WP-04B.1:** Move remote-forward exposure consent into the application start
  flow. The start reservation covers the asynchronous native prompt, denial
  opens no SSH runtime, and every start prompts again. A cancellation regression
  now keeps the definition reserved until that prompt settles.
- **WP-04J:** Add optional `0.0.0.0` binding for local SSH forwards. Loopback
  remains the default; each all-interface start requires main-process consent.
  Review-driven E2E coverage now checks relayed bytes and explicit-stop listener
  release; final gate execution is pending.
- **WP-04K:** Remote SSH forwards accept canonical IPv4 bind addresses; the
  default remains `127.0.0.1`, local binds remain limited to loopback or
  `0.0.0.0`, and SOCKS stays loopback-only. Every remote start requires
  main-process consent. The worker matches specific binds to the exact reported
  address and accepts IPv4 addresses only for `0.0.0.0`; `forwardIn` and
  `unforwardIn` use the persisted requested address. Domain, contract, worker
  protocol, SQLite, provider and Windows UI E2E coverage now includes a specific
  `127.0.0.2` loopback bind and wildcard bind. The new specific-bind checks await
  the Phase 07 gate. See [ADR-0061](../adr/ADR-0061-wp04k-public-remote-ssh-forwarding.md).
- **WP-04L / F-011 / P-22:** Raise the bounded route maximum from three to eight
  saved gateways. Domain, worker-protocol, application and provider coverage
  reaches eight and rejects nine; provider coverage checks success, target
  authentication failure and cancellation cleanup, while session logs preserve
  all eight gateway entries. Windows E2E now adds terminal, SFTP-only and local,
  remote and dynamic tunnel routes through all eight ordered gateways. It
  verifies selector bounds, relays, target-only shell/SFTP policy, exact tunnel
  bytes, host trust and cleanup; these added assertions await the Phase 07 gate.
  ADR-0062 now derives the provider deadline from route depth: eight gateways
  permit nine 130-second handshakes, eight 15-second nested channels and a
  20-second target-setup margin (1,310 seconds). Worker IPC adds 10 seconds
  (1,320 seconds maximum), and preload allows nine 120-second credential
  prompts plus the worker budget and 40 seconds of margin (2,440 seconds).
  The worker-host timer test and eight-hop E2Es await the Phase 07 gate.
- **WP-04N / N-010:** Added a SQLite v4 table (extended by a v5 migration) for path-free, credential-free
  transfer recovery records, one app-run UUID shared across storage-worker
  generations, stale app-run interruption on worker startup, one verified
  pre-migration SQLite snapshot for existing schemas (including populated
  version-zero databases) and atomic multi-version schema rollback,
  throttled progress checkpoints, typed preload list/dismiss commands, and an
  accessible renderer status banner. FTP
  and FTPS status now preserve their actual transport label. Unit, storage
  protocol, broker, SQLite, synthetic restart, and live SSH worker-termination
  E2E coverage are authored but have not been run. The live-worker fixture
  checks checkpoint persistence through app restart and no auto-reconnect. It
  does not clean partial files. Local download staging now uses the durable
  operation ID, and typed IPC lets the user select a folder and reveal the exact
  regular non-symlink stage through Explorer; unit, contract, broker and native
  Windows folder-picker E2E checks for cancellation and exact-folder selection
  are authored but unrun. Before a broker starts an SFTP upload, recovery now
  persists the deterministic operation-ID stage name and, for overwrite, the
  backup name; a metadata-write failure blocks the upload. The recovery banner
  exposes both possible names for manual inspection without storing or locating
  the remote directory. FTP/FTPS
  recovery now records up to two validated artifact basenames from STOU replies
  and overwrite staging; an authored E2E checks worker failure, SQLite
  persistence and visibility after app restart. It does not store or locate the
  remote directory, and the UI does not delete or resume the upload. A server
  that omits a valid STOU name or a failure before FTP/FTPS metadata reaches SQLite can
  still leave an unidentified artifact. Two additional
  unrun restart unit cases check
  that committed credential-vault and legacy host-trust JSON survive malformed
  abandoned sibling staging files; this does not establish power-loss durability
  or broad non-SQLite configuration recovery. Non-SQLite app-configuration
  recovery, automatic FTP remote-directory lookup and native folder-selection
  E2E remain open, so N-010 remains PARTIAL. See the [WP-04N.1 evidence](WP-04N1-ftp-artifact-recovery-2026-10-31.md) and
  [ADR-0063](../adr/ADR-0063-durable-transfer-interruption-status.md).
- **WP-06B1.1:** Expand heuristic recording-prompt recognition for common PIN,
  passcode, OTP/TOTP, two-factor, authenticator, verification and security-code
  prompts. Arbitrary and localized prompt detection remains out of scope for a
  pattern matcher.
- **WP-03F.1 / N-009:** A Windows E2E profile starts 20 active SSH sessions,
  records process private memory and working sets at startup and after the
  connections are ready, and writes an ignored JSON artifact. On Windows 11 Pro
  Education / x64 with Electron 45.0.0, it measured five processes at baseline
  (252,360 KiB private; 484,404 KiB working set) and seven while the 20 SSH
  sessions were active (531,292 KiB private; 872,344 KiB working set), a
  278,932 KiB private-byte increase. The spec gives no memory ceiling, so this
  is a recorded baseline, not a pass/fail threshold. The ignored raw artifact
  is `test-results/phase-07-ssh-memory-profile.json`; the values are preserved
  here as durable evidence.

Tests have been added or updated for these changes, including Windows UI E2E,
actual wildcard listener assertions and the 20-active-session profile. The
public remote-forward regression exposed a pinned `ssh2` pre-event lookup that
rejected a concrete IPv4 channel address for a registered `0.0.0.0` bind. The
worker now resolves such addresses to the wildcard registration while keeping
the existing port, address-family, active-forward and consent checks. See
[ADR-0061](../adr/ADR-0061-wp04k-public-remote-ssh-forwarding.md).

## Gate evidence to date

**Last successful repository gate — 2026-10-31, prior to review corrections:**

- Pinned Node 24.14.1 / pnpm 12.15.0: typecheck and tools typecheck passed;
  lint and static import boundaries passed; Windows x64 native and renderer
  build passed. The renderer bundle was 1,043.22 kB minified, above Vite's
  500 kB advisory.
- Full unit suite: 622/622 passed. Full Electron E2E suite: 75 passed, 7
  skipped, 0 failed. The skips were the known Git Bash first-input-after-resize
  acceptance and six package-only cases. A separate package smoke was not run.
- The SSH three-gateway route, saved-tunnel relay, native-dialog, clipboard and
  shell-input cases passed in that run. The skipped shell resize-first-input
  case remains open under Phase 02.
- N-008's per-key Windows measurement passed: 32 keys, 51 ms p95, 555.9 ms
  maximum. The prior run before the virtual-list and measurement corrections
  had 64 E2Es passed, 11 failed and 7 skipped.
- The 1,000-session E2E passed, including forward/reverse keyboard traversal
  and 20 search samples at 66.5 ms p95. The corrected helper recalculates the
  list viewport after scrolling its first focusable control into view.
- The 20-active-session SSH E2E passed. Its measured baseline and active
  process totals are recorded above; the spec sets no memory ceiling.
- The disposable OpenSSH fixture suite reported 0 passed / 1 skipped because
  its `MRT_TEST_SSH_*` server configuration is absent. The controlled `ssh2`
  fixture is not public-server interoperability evidence.

**Independent reviews of that candidate:** the specification review found that
WP-04J did not verify wildcard-local traffic relay or explicit stop cleanup and
that the N-009 measurement statement was stale; the measurement is now
preserved above. It also confirmed that F-011, F-007/P-28 and P-25 still have
open requirements listed below. The implementation review found no production
correctness defect, but found that WP-04K did not verify an active wildcard
remote forward unbinding on app shutdown. The standards review found no hard
rule breach and one non-blocking possible data-clump smell in the consent
callback type.

The current worktree adds E2E assertions for WP-04J traffic/stop and WP-04K
shutdown unbind, plus fixture acknowledgement after its server listener closes.
The standards review's possible duplicated endpoint shape was removed by using
the existing `SshHostEndpoint` type. These review corrections have not been
rerun. Phase 07 remains unaccepted; the
current candidate still has open parity requirements and the separate package
smoke has not run.

## Open requirements and limits

- **P-22/F-011:** WP-04L raises the configured route maximum to eight gateways under ADR-0062.
  Maximum-depth unit/provider coverage and terminal, SFTP-only and all tunnel-mode
  eight-gateway UI E2E are awaiting the Phase 07 gate; routes beyond eight hops
  and broad server interoperability remain open.
- **P-25/F-006:** Dynamic forwarding currently implements no-auth TCP
  `CONNECT`; SOCKS authentication, `BIND`, `UDP ASSOCIATE` and broader
  interoperability remain open. The TCP-only SSH forwarding constraint and
  required credential/consent work are documented in [WP-04M research](WP-04M-socks5-ssh-transport-research.md).
- **F-007/P-28:** Secret-prompt filtering remains heuristic, and public-server
  macro playback interoperability remains open.
- **N-009:** The 20-active-SSH-session memory profile was captured. The
  specification gives no memory ceiling, so no pass/fail limit is claimed. The
  recorded baseline remains pending recapture in the final code gate.
- **N-010:** WP-04N's implementation, synthetic persisted-row restart fixture,
  live SFTP worker-termination/restart E2E, and native folder-picker E2E are authored and pending the
  Phase 07 gate. The worker E2E checks checkpoint persistence and no automatic
  reconnection. Partial-file reconciliation and non-SQLite app-configuration
  recovery remain open; snapshot integrity, transaction rollback and
  abandoned-staging restart tests are authored but not run.
- **F-006/P-24:** WP-04K now accepts canonical IPv4 remote binds and enforces
  exact channel-address matching for specific binds. These assertions await the
  Phase 07 gate; interoperability across real SSH server policies remains open.
  The controlled UI fixture is not public-server evidence.

Session, tunnel-definition and macro-definition count limits are not added.
The published evidence for the existing count workflows is retained; a passing
record-count test is not treated as proof of live-session memory behavior.

## Git and gate state

- Active development branch: `dev-1`.
- Candidate base before Phase 07 edits: `af17e34e35510d42fb91683e73b20a095f3b4d5b`.
- `origin/dev-1` was verified at the same hash after fetch. `origin/main` was
  `811701c230e4f0c953ce58dbf907afc3f3d7ecc3`.
- Phase 07 edits are still uncommitted. The previously frozen candidate received
  review-driven E2E corrections; this current candidate is awaiting its final
  code gate. Existing user changes in `AGENTS.md`,
  `pnpm-workspace.yaml`, `docs/agents/`, `docs/CODEX-RESUME.md` and
  `session-context.md` are preserved and excluded from staging.
- No phase acceptance, review approval, push or promotion is claimed. The
  development branch and protected pre-existing files remain unchanged by
  commits; work is still unstaged.

## Next actions

Complete the remaining Phase 07 requirements and decide each documented parity
gap against the canonical acceptance criteria. Rerun the code gate after the
review-driven E2E changes. Resolve all Important/Critical findings and re-review
affected areas after any further code changes. Keep P-22's
longer-than-eight-hop routes, P-25's SOCKS authentication/BIND/UDP, heuristic
macro prompt limits, and broader server interoperability visibly partial; do
not promote the phase while a mandatory acceptance criterion remains open.

## Candidate updates after prior freeze - 2026-10-31

The previously frozen candidate received additional WP-04N FTP/FTPS artifact-name persistence, schema-v5 migration, UI, contract/unit and restart-E2E source changes. The phase is not frozen now; these changes and earlier WP-04L/WP-04N acceptance coverage remain unverified. No requirement status changed and no phase acceptance is implied.

P-25 remains PARTIAL: the current SSH adapter provides TCP streams without UDP datagrams; SOCKS authentication has no isolated credential lifecycle; BIND would require request-scoped consent, an advertised address the peer can actually reach, and a two-reply peer-filtered listener lifecycle. SSH `forwardIn` reports a port but not an authoritative reachable bind address, and server policy may widen or constrain the bind. WP-04M records the transport evaluation and safe rejection behavior. N-010 remains PARTIAL: FTP/FTPS STOU artifact basenames are now persisted when reported and shown for manual inspection, but automatic lookup, nonconforming-server behavior, the gap before SQLite persistence, and broader non-SQLite recovery remain open. F-011/P-22 and P-24 retain broad public-server policy interoperability limits. These gaps block promotion; complete remaining mandatory implementation before freezing and running the phase gate.

### Gate progress - 2026-10-31

- Using workspace-local Node 24.14.1 and pnpm 12.15.0, the corrected TypeScript/tools typecheck passed, ESLint and all static import-boundary checks passed, and the Windows x64 native/renderer build passed. Vite reports the existing large renderer chunk advisory at 1,046.38 kB minified.
- Full unit, integration, Electron E2E, package smoke and review gates remain pending. Phase 07 acceptance/promotion is still blocked by the PARTIAL requirements listed above.

- The full unit suite initially passed 637/641, then 641/642 after corrections. The four bridge/SQLite/eight-hop cancellation failures were resolved; the older SSH host-trust close test now expects the explicit `CANCELLED` result. Final pinned-toolchain run: 642/642 unit tests passed.

### Final candidate freeze - 2026-10-31

- Phase 07 implementation is frozen for the final gate. The latest source changes include review-driven wildcard-forward assertions, eight-hop route/E2E coverage, durable transfer recovery including FTP artifact names, and a correction that gives routed worker IPC 190 seconds to return after the provider's 180-second deadline. A fake-timer test covers the worker-host bound.
- P-25 remains PARTIAL: unsupported SOCKS authentication, BIND and UDP ASSOCIATE are explicitly rejected. WP-04M documents why the current TCP-only SSH provider cannot safely supply those semantics and evaluates a compatible tunnel alternative. No parity claim or acceptance-status change is made.
- N-010 remains PARTIAL for remote artifact lookup and broader non-SQLite configuration recovery. The authored acceptance covers visible durable interrupted status, explicit local partial inspection, manual remote artifact inspection, no automatic retry, and migration backup/rollback; no paths or credentials are stored.
- No automated checks have run since these final candidate edits. Any code change during the gate returns Phase 07 to implementation and requires the applicable checks to be rerun. No commit, push, review approval or phase acceptance is implied by this freeze.
## Final automated verification - 2026-10-31

- Pinned Node 24.14.1 / pnpm 12.15.0 `pnpm check` passed typecheck, lint/import boundaries, 644/644 unit tests, Windows x64 build, and 76/76 executed Windows Electron E2Es. Seven E2Es were skipped: the known first-input-after-resize regression and six package-only cases (run separately below). The resize requirement remains open; the skip is not acceptance evidence.
- `pnpm test:ssh-fixture` reported one skipped live OpenSSH integration acceptance because `MRT_TEST_SSH_HOST`, `PORT`, `USERNAME`, `PASSWORD`, and `FINGERPRINT` are not configured. Interoperability therefore remains unverified.
- `pnpm package:win:smoke` rebuilt the current x64 NSIS and portable artifacts, generated per-artifact CycloneDX SBOMs and SHA-256 manifest, and passed 6/6 packaged smoke tests: ASAR/fuses, manifest/SBOM, offline NSIS install/uninstall at 200% scale, portable local settings, shipped native credential prompt against loopback SSH, and session-log finalization on shutdown.
- The artifacts are unsigned (`NotSigned`; no publisher identity is configured). Manifest hashes: portable `79F3D1010F7C45E925B560C7444E6CE8F2BAE0FC3E5C49D44D6203DEF953B930`; installer `960CF4FB25120928D53831AEF478E0E00F22D34FEC21862343320E9BB084D8B6`.
- Phase 07 is not accepted for promotion. P-25 still lacks SOCKS authentication, BIND and UDP ASSOCIATE; N-010 still lacks automatic remote artifact reconciliation and broader non-SQLite configuration recovery; and live public-server interoperability is not established. These remain in scope and are not converted to VERIFIED by the passing code/package checks.

## Recovery metadata follow-up - 2026-10-31

Static review found the durable recovery record accepted remote artifact basenames only up to 255 characters, while the existing FTP filename contract accepts 1,024 UTF-16 code units. This caused valid longer STOU names to be omitted from persisted recovery metadata; the prior progress wrapper swallowed that storage rejection, leaving no manual artifact name after interruption. Recovery validation now uses the existing 1,024-unit remote bound and FTP control-byte policy while still rejecting path separators, and local display filenames explicitly enforce 255 UTF-16 code units. Authored unit cases cover the boundary and safe literal backslash names. These changes are unrun, return Phase 07 to implementation, and do not close automatic remote lookup or other N-010 gaps.

## Native dialog automation target scoping - 2026-10-31

- Native SSH-log and interrupted-transfer folder scenarios now pass the Electron app process ID into the Windows UI Automation helper. The helper requires that ID and filters both dialog discovery and close verification to the app process tree, so it cannot select or dismiss an unrelated window with the same title.
- These are test-source corrections only. No automated check has run on this candidate; the prior phase gate remains failed and Phase 07 is not frozen or accepted.

## Dialog path-entry fallback removal - 2026-10-31

- Static inspection found that the non-foreground picker path still fell back to activating the dialog and sending keystrokes when UI Automation and the verified Win32 path setter both failed. Removed that fallback; selection now fails explicitly unless one of the direct path setters retains the requested value. SSH credential-prompt automation keeps its separate interactive path.
- This corrects the helper to match the documented process-scoped, direct-control approach. No Windows E2E was rerun; the candidate remains in Phase 07 remediation.

## Native dialog action invocation - 2026-10-31

- Shared Windows dialog automation now invokes one uniquely named enabled action button through UI Automation InvokePattern first, then uses the existing verified native button/control-ID fallback. Ambiguous matches fail explicitly. This avoids depending on foreground activation for picker and consent actions.
- The source change is unverified; no E2E or package smoke ran, so the prior gate failure and Phase 07 status remain unchanged.

## N-010 recovery checkpoint finalization - 2026-10-31

- SQLite recovery finalization now preserves the greatest persisted byte checkpoint and a previously known total when a final interruption report regresses or omits those values. A focused regression assertion is authored but unrun; this returns the candidate to implementation and does not change N-010's PARTIAL status.


## N-010 migration rollback regression - 2026-10-31

- Strengthened the authored SQLite migration rollback case: the fixture removes the v2 tunnel-name column, sets the v1 marker, and seeds a conflicting macro-shortcut table with retained data. The v2 ALTER succeeds before v3 table creation fails; assertions require the version, absent column, and sentinel row to remain unchanged after rollback. The test is unrun and N-010 remains PARTIAL.


## N-010 abrupt application termination recovery - 2026-10-31

- Extended the existing Windows SFTP recovery E2E to start a download, wait for a committed `running` row and byte checkpoint, force-terminate the Electron process tree, and verify the running row plus operation-named stage survive before restart. The next app run must surface the row as `interrupted` without issuing another SFTP request or creating the final destination. The test is authored and unrun; N-010 remains PARTIAL.

## N-010 current-folder artifact-name matching - 2026-10-31

- The remote files pane now marks exact regular-file name matches for interrupted SFTP operation stages and persisted FTP/FTPS artifact basenames when the user opens a folder. It uses existing path-free recovery records and does not search, reconnect, resume, rename, delete, or claim identity.
- Added an assertion to the FTP restart E2E source for the visible marker after reopening the saved profile. No tests ran; N-010 remains PARTIAL and Phase 07 remains unfrozen pending its complete gate and remaining acceptance.

## N-010 SFTP upload-stage restart visibility - 2026-10-31

- Extended the Windows SFTP crash E2E source to force-terminate the app while an overwrite commit is paused after the old target moves to the operation-ID `.backup`. It verifies the running recovery row, `.partial` and `.backup` survive, startup marks the transfer interrupted without reconnecting, then reopening the folder marks both exact files as possible artifacts. The test-only main-process hook chooses overwrite for the specified test file.
- The E2E and existing recovery checks remain unrun; N-010 remains PARTIAL pending the Phase 07 gate. FTP/FTPS metadata-loss windows, automatic remote lookup and broader non-SQLite configuration recovery remain open.

## N-010 pre-transfer SFTP artifact persistence - 2026-10-31

- SFTP upload dispatch now persists the deterministic `.partial` basename and, for overwrite, the operation-scoped `.backup` basename before starting the transport. If the storage update fails, the upload is not started and the recovery row is finalized as failed when possible. Added application-use-case and broker regression sources for write ordering and fail-closed behavior.
- Updated ADR-0063 and the specification, feature matrix, security, implementation plan and Phase 07 ledger to distinguish the closed SFTP pre-start metadata window from the still-open FTP/FTPS server-name persistence window. No automated checks ran; N-010 remains PARTIAL and Phase 07 remains in implementation.

## Phase 07 verification progress � final Windows x64 build - 2026-10-31

- Reran pnpm build on the current candidate with pinned Node 24.14.1 / pnpm 12.15.0. Native x64 compilation and the renderer build succeeded; the 1,051.98 kB bundle still emits its existing advisory.
- No code changed during the build rerun. The full phase check and packaged smoke remain pending; live OpenSSH interoperability remains unavailable because fixture credentials are not configured.
## Phase 07 full-check failure � 2026-10-31

- Final-candidate pnpm check ran under pinned Node 24.14.1 / pnpm 12.15.0 with workspace-local TEMP/TMP. Typecheck, lint/import boundaries, 662 unit tests, Windows x64 build, and the Electron E2E launch completed; the overall command failed at E2E with 65 passed, 13 failed, and 7 skipped.
- Failed E2Es: local text editor file selection; SSH session-log file selection; durable interrupted-download folder selection; eight-gateway route setup; FTP interrupted-upload artifact visibility; macro recorder clipboard fixture; tab-selection clipboard copy; local terminal preload command inventory; Git Bash saved-session clipboard fixture; supplementary Unicode clipboard fixture; PowerShell tool-management policy-copy assertion; credential-bundle native picker; and custom-logo native picker.
- The 7 skips include the existing first-input-after-resize regression and six packaged-only checks, which remain separate smoke-test acceptance.
- Native picker failures concentrate in tests/e2e/windows-native-dialog.ps1 path-control discovery/action completion. The gateway E2E fails while parsing its generated ed25519 server key. The FTP test cannot find its expected interrupted-upload marker after reconnect. Clipboard fixtures observed an empty Windows clipboard. The preload and policy-copy failures are stale E2E expectations against current documented bridge/UI. No package smoke or independent review has run.
- Phase 07 remains unaccepted and unpromoted. The full candidate gate is reopened for these failures and the previously documented P-25, N-010, and external interoperability acceptance gaps.
## Phase 07 native-picker failure diagnostics - 2026-10-31

- Added failure-only control summaries to the shared Windows native-dialog E2E helper. The error reports visible UI Automation edit/combo/button/text/list-item IDs and names, plus the classic filename control handle; failed close actions report remaining controls. This adds diagnosis data without changing path selection or dialog actions.
- The full gate reproduced native picker failures, but this instrumentation is not yet run. It must be removed or retained only if the diagnostics remain useful and do not expose unrelated user content; current automation scopes dialogs to the test app process tree.
## Phase 07 native-picker diagnostics follow-up - 2026-10-31

- Reproduced the local-text native picker failure in isolation. The OS is exposing the actual Windows common file dialog in Italian; its UI Automation tree contains localized shell controls and repeated file-property edits, while the existing exact filename matcher does not identify a writable field/action pair.
- Extended failure-only diagnostics to include the classic Win32 child-control IDs/classes and accessible button labels while omitting edit values and file-list names. This is diagnostic test code only; no file-selection behavior changed and the focused E2E remains failing pending root-cause remediation.
## Phase 07 native-picker path fix - 2026-10-31

- Corrected the test helper to locate the visible enabled Win32 Edit child whose control ID is 1148, rather than calling SetWindowText on the outer ComboBoxEx32 container. This preserves the actual common-dialog path field and existing explicit button invocation/process scoping.
- The focused local-text picker had reproduced the failure; this correction is unverified until the focused picker E2E runs. Credential/log/folder/logo dialogs share the same helper and must be covered by the resumed full gate.
## Phase 07 native-picker action fix - 2026-10-31

- Microsoft BM_CLICK documentation confirms the native click can fail when its dialog is inactive. The helper now activates the app-scoped dialog before its Win32 button fallback; UI Automation InvokePattern remains preferred.
- The focused picker scenario still needs to verify the combined nested-edit and activation changes. Technical reference: https://learn.microsoft.com/en-us/windows/win32/controls/bm-click
## Phase 07 native-picker command dispatch - 2026-10-31

- Removed the native fallback's activation requirement after the focused test showed this automation desktop cannot reliably set the picker as the foreground window. Once the helper identifies the app-scoped dialog and enabled button by accepted label or exact control ID, it now sends BN_CLICKED to that dialog owner using the verified child handle.
- This changes test-only native button dispatch and remains unverified pending focused picker E2E; no keyboard path was added.
## Phase 07 native button parent correction - 2026-10-31

- The explicit BN_CLICKED fallback now sends WM_COMMAND to the verified button's actual Win32 parent, with the button ID and HWND. Microsoft documents BN_CLICKED as a notification sent to the button parent. The earlier dialog-owner attempt did not close the picker and remains superseded.
- Focused native-picker E2E remains pending.
## Phase 07 native-picker UI Automation value correction - 2026-10-31

- Cross-process Win32 text-setting only verified the Edit child's displayed value and did not make the common picker accept the selection. Removed that fallback. Path selection now uses ValuePattern on a uniquely matched filename field or the exact visible enabled Edit child under control ID 1148, then verifies the retained value before invoking the native action.
- Microsoft documents SetWindowText as unable to change a control in another application; this native picker belongs to Electron while the helper is PowerShell. Focused E2E is required to establish that the UI Automation value provider works on this OS.
## Phase 07 native-picker UI Automation diagnosis - 2026-10-31

- The focused picker confirms the common-dialog filename Edit child is exposed by Win32, but UI Automation ValuePattern still rejects setting it. Enhanced failure output to include the provider exception type/message without logging the selected path or current filename.
- No path selection or button action is claimed successful; the focused test remains failed pending this provider diagnosis.
## Phase 07 native combo change notification - 2026-10-31

- The exact nested Edit control has no ValuePattern provider on this Windows common dialog. Native fallback now sets that control, verifies the returned value, then sends CBN_EDITCHANGE to its ComboBoxEx parent so the dialog processes the filename edit instead of merely displaying it.
- This uses the verified control ID 1148 within the target app�s native dialog and remains test-only. Focused picker E2E is pending.
## Phase 07 native-picker command-target diagnostics - 2026-10-31

- The nested-edit plus CBN_EDITCHANGE path is applied, but the native dialog still remains open. Added failure-only parent class/control IDs to native child diagnostics to verify the actual BN_CLICKED message receiver before adjusting dispatch.
- The focused test remains failed; no interactive file picker acceptance is claimed.
## Phase 07 native-picker activation correction - 2026-10-31

- The helper now considers the verified dialog active when GetActiveWindow returns its HWND, even if another window remains foreground. The native fallback activates the app-scoped dialog and uses BM_CLICK on its uniquely identified enabled child button, matching Microsoft�s documented requirement.
- This supersedes direct WM_COMMAND dispatch. Focused E2E remains pending.
## Phase 07 native button UI Automation fallback - 2026-10-31

- Added a direct AutomationElement.FromHandle/InvokePattern attempt for the exact verified native button control ID before the Win32 BM_CLICK fallback. This handles native controls omitted from the dialog�s UI Automation descendant tree where the provider still exposes InvokePattern.
- No source acceptance has passed yet; the local-text picker E2E remains pending.
## Phase 07 native-picker input remediation � 2026-10-31

- Resumed from the focused local-text E2E failure: the helper could read back text after cross-process SetWindowText and sent dialog/button notifications, but the native picker remained open. This does not demonstrate selection.
- The shared helper serves local text, SSH logs, transfer recovery folders, credential bundles, and custom logos. Replace the synthetic text/button messages with focused keyboard input to the app-scoped native control, retaining extension/path checks and requiring the picker to close as acceptance evidence. No production code changes.

## Phase 07 native-picker keyboard remediation � 2026-10-31

- Replaced cross-process SetWindowText, combo notifications and synthetic BM_CLICK with focused UI Automation plus keyboard input to the app-scoped Win32 filename edit and identified action button. The helper verifies keyboard focus and the entered path, escapes SendKeys metacharacters, and still requires the real dialog to close. Test-only changes cover the shared native dialog callers; no dialog bypass hook is used.
- Next: rerun the focused local-text native picker E2E as failure remediation, then cover each shared dialog path before restarting the full frozen Phase 07 gate.

## Phase 07 native-picker helper compile correction � 2026-10-31

- The first targeted local-text E2E rerun stopped in PowerShell Add-Type before launching the dialog: failure diagnostics still referenced GetParent after its P/Invoke declaration was removed. Restoring the diagnostic dependency; no application code was exercised. The focused E2E must rerun.

- Restored the Win32 GetParent declaration used only by the native child-control diagnostics. The helper now compiles its diagnostic class; retrying the same focused local-text E2E.

## Phase 07 native-picker submit diagnosis � 2026-10-31

- The focused local-text E2E progressed through the updated filename-field focus and keyboard entry without a path-field error, then failed because the OS UI Automation tree omitted the localized Win32 action button. No selection or dialog close was observed. Change file-picker acceptance to Enter from the already verified native edit, and cancellation to Escape; this is keyboard interaction with the real dialog.

- Native file-picker actions now press Enter while the verified filename field retains focus; picker cancellation sends Escape. This covers local text, SSH log export, interrupted-download folder selection, credential bundle import/export and custom logo selection. The targeted local-text E2E rerun is pending; no automated verification beyond failure remediation has been performed.

## Phase 07 native-picker cancellation helper correction � 2026-10-31

- The focused test progressed to its first cancel-picker action and failed because the earlier helper refactor removed Send-DialogKeys while updating callers. Restore that helper as a focus-plus-key operation; no native dialog selection behavior was verified in this run.

- Restored Send-DialogKeys for verified picker cancellation paths. The same targeted local-text scenario is rerunning.

## Phase 07 native-picker action focus remediation � 2026-10-31

- After genuine keyboard filename entry, Enter did not dismiss the local-text picker because its configured action label is Edit and it is not the dialog default. The focused test failed at dialog-close verification. The helper will traverse Tab focus only within the app-scoped native dialog, verify focus reaches the exact enabled Win32 action button ID, then send Space; the traversal is bounded and has no action until the target receives focus.

- Added bounded native keyboard traversal: the helper preserves a focused child within the target dialog, tabs at most 32 times, and sends Space only after the exact enabled action button HWND receives focus. File-picker callers now use this verified button path; no text or click messages are posted across processes.

## Phase 07 native-picker failure location correction � 2026-10-31

- The latest local-text E2E reaches the first cancel branch and times out waiting for that dialog to close; the run does not reach the selected-path action. The prior note attributing this run to Enter on the selected path was premature. Change native picker cancellation from Escape after window activation to the bounded, focus-verified Cancel button traversal. Accept the Italian native label Annulla where exposed.

- All native picker cancellation branches now target enabled Win32 Cancel control ID 2 through bounded Tab traversal and Space; the UI Automation label check includes English and Italian. Removed the unused generic SendKeys wrapper. Retrying the focused local-text dialog E2E.

- The focused rerun now reaches the file-dialog Cancel control path but fails before the picker closes; the target action button is absent from the UIA descendant list, and the current helper hides its native-control exception in a broad fallback catch. Add failure-only focused-HWND detail and the underlying exception to distinguish control identification, focus traversal, and key delivery before choosing the next fix.

- Native button fallback now preserves the exact failure type and last focused element (control type, HWND, automation ID and name), with Win32 button labels. Diagnostics omit edit values and file-list names. This will identify why bounded traversal does not activate the Cancel button.

- Failure-only diagnostics identified the exact native-picker mismatch: Win32 control ID 2 is the enabled Button='Annulla', but AutomationElement.FromHandle reports no Button control type for it. Update the helper to validate the button by Win32 class, parent dialog, visibility and enabled state; continue using UIA's focused HWND only to confirm tab traversal target focus.

- Native action validation now uses Win32 to require a visible, enabled Button class child owned by the exact dialog; UIA is not required to model native button semantics. The next focused run will verify traversal reaches its HWND and activates it.

- The bounded Tab run reached the desktop weather UIA group rather than the dialog Cancel HWND, proving the picker was not actually active on the helper's input queue. Replace Tab traversal with verified Win32 focus on the exact app-owned dialog child while temporarily attaching input queues; send Space only if GetFocus confirms the target HWND. This remains test-only and process-scoped.

- Replaced UIA SetFocus/Tab traversal with a bounded native operation that attaches only the helper and target window input threads, raises the app-scoped dialog, calls SetFocus on the validated child HWND, confirms GetFocus matches it, and detaches in finally. Text and action are still delivered via keyboard. Retrying the focused Windows local-text E2E.

- The latest run confirms FocusDialogControl reaches the exact native button: its next failure is .NET SendKeys rejecting the unsupported {SPACE} key token. Use a literal space keystroke for native button activation. This resolves a helper syntax defect; acceptance still requires the focused dialog tests and full phase gate.

- Replaced the invalid named SPACE token with a literal space key and removed stale focus diagnostics from the direct native-focus path. Rerunning the local-text acceptance scenario.

- Native focus verification now succeeds for the button, but a literal Space key does not dismiss the picker in this host. Replace that final step with the Win32 BM_CLICK message sent only to the already validated and focused button HWND; this targets the actual native dialog control and preserves close verification.

- Button activation now uses BM_CLICK after IsEnabledDialogButton verifies the exact child class, owner, visibility and enabled state and FocusDialogControl verifies focus. Automated testing remains limited to this focused native-dialog remediation run.

- The current targeted test now completes its real Cancel interaction and reaches a second native picker. It fails only at filename typing: focus was set on the edit in an attached input queue, but SendKeys ran after detaching and did not populate the path. Move bounded Unicode keyboard input into the same attach/focus scope, verify the dialog is foreground and the exact edit retains the fixture path, then retry.

- Path entry now uses Windows SendInput Unicode key events while the helper and app input queues are attached: Ctrl+A selects the edit contents, each path character is delivered as a keyboard event, and the exact edit text plus foreground dialog are verified before returning. This preserves real picker event processing and avoids SendKeys on the detached queue. Retrying the focused E2E.

- After the native Cancel path succeeded, the targeted test reached filename typing. SendInput did not populate the native Edit; the current bool result does not distinguish foreground/focus rejection, Win32 SendInput rejection, or a text mismatch. Add failure-only numeric/handle status and path lengths only, without emitting the selected path or current edit contents.

- Added sanitized SendInput diagnostics: foreground and focus HWNDs, whether the input queues attached, accepted/expected event counts, Win32 error and path string lengths. No path content or edit text is logged. Retrying the same focused E2E.

- Sanitized focus diagnostics show the exact filename Edit has focus, while GetForegroundWindow returns a different HWND from the picker. Update the foreground guard to allow only the picker itself or its actual GW_OWNER window, and retain exact focused-edit validation. This supports standard owned Windows dialogs without sending keys to unrelated foreground windows.

- The keyboard guard now accepts the native dialog as foreground or its exact GW_OWNER, with the same focused Edit HWND requirement; unrelated foreground windows remain blocked. Rerunning the focused real-dialog E2E.

- The foreground diagnostic confirms the desktop host is unrelated to the app-owned picker; SendInput is correctly blocked to avoid typing into another window. The previous Win32 edit attempt sent CBN_EDITCHANGE to the ComboBoxEx child instead of the picker dialog. Replace keyboard injection with the native filename Edit text plus CBN_EDITCHANGE addressed to the #32770 picker with the ComboBoxEx HWND and control ID; retain actual-button BM_CLICK and close verification.

- Removed SendInput and its diagnostics because the desktop foreground is outside the app. The filename helper now writes only the native dialog's real ID-1148 edit, verifies it, then sends CBN_EDITCHANGE to the #32770 owner with the verified ComboBoxEx HWND. The earlier bug targeted the nested ComboBoxEx rather than its owner. Rerunning the focused scenario.

- Restored the existing GetFocus P/Invoke required by button activation after removing the SendInput helper. The focused native-picker E2E now exercises Cancel, validated native edit/CBN_EDITCHANGE, and the app button activation in sequence.

## Phase 07 native ComboBoxEx notification correction � 2026-10-31

- Corrected the immediately prior diagnosis after checking Microsoft Win32 documentation. For the reported hierarchy dialog -> ComboBoxEx32 -> ComboBox -> Edit, the embedded ComboBox's CBN_EDITCHANGE is sent to the ComboBoxEx HWND with the inner ComboBox HWND in lParam; ComboBoxEx forwards its WM_COMMAND notifications to the dialog. The original ComboBoxEx target was correct. Restore that documented route; the direct dialog-targeting change is superseded. Reference: https://learn.microsoft.com/en-us/windows/win32/controls/comboboxex-controls
- The current focused run confirms native Cancel activation succeeds with verified focus plus BM_CLICK. Next rerun exercises filename edit notification and the action button together.

- Restored CBN_EDITCHANGE delivery to the ComboBoxEx control, with wParam carrying control ID 1148 and lParam carrying its embedded ComboBox HWND, matching Microsoft's documented forwarding model. Running the focused local-text test again.

- The current run verifies the fixture path is retained by the actual filename Edit and reaches the button activation, but the native picker remains open. Add the documented parent-notification chain after WM_SETTEXT: EN_UPDATE/EN_CHANGE from the Edit to its ComboBox, followed by CBN_EDITUPDATE/CBN_EDITCHANGE from that ComboBox to ComboBoxEx. References: https://learn.microsoft.com/en-us/windows/win32/controls/en-change ; https://learn.microsoft.com/en-us/windows/win32/controls/comboboxex-controls

- The helper now sends the validated Edit EN_UPDATE/EN_CHANGE to its embedded ComboBox, then CBN_EDITUPDATE/CBN_EDITCHANGE to ComboBoxEx with the correct HWNDs and control ID. It still verifies the exact native edit text and invokes the actual dialog action button. Rerunning focused local-text E2E.

## Phase 07 native-picker investigation paused for independent work � 2026-10-31

- The focused local-text E2E confirms native cancellation closes when the exact visible enabled Cancel HWND is activated through a focused BM_CLICK. The subsequent picker retains the requested path in its actual ID-1148 Edit and receives the documented nested EN/CBN notifications, but the custom Edit action still does not close it. The real native selection acceptance remains failing; no dialog bypass or success claim is made. Further diagnosis is deferred while independent later-phase requirements are completed. Phase 07 stays unaccepted; do not commit/push/merge.

## Phase 07 FTP artifact marker E2E viewport correction - 2026-10-31

- The final FTP interrupted-upload restart assertion checked a marker for a sorted, virtualized file row while the remote list remained at its top. Added a scroll to the list bottom before asserting the visible artifact marker. The implementation already matches persisted FTP/FTPS basenames against regular files in the open folder; this adjusts the E2E viewport setup, not the acceptance condition. No automated tests were run; Phase 07 remains unaccepted.
## N-010 FTP/FTPS STOU persistence acknowledgment - 2026-10-31

- FTP/FTPS utility-worker transfer progress now requires a UUID-correlated acknowledgment for artifact metadata. The worker waits for the main process to finish the serialized SQLite write before allowing `basic-ftp` to proceed from the STOU preliminary reply to payload transfer. Failed, absent or timed-out persistence fails closed; absent or invalid server-assigned STOU names are rejected before payload transfer. Pending acknowledgments are bounded to 128 with a 15-second deadline and are cancelled with the transfer.
- Recovery and worker-host regression sources verify write-before-continue, acknowledgment after the callback settles, fail-closed persistence failure, and strict progress/ack protocol validation. The fake FTP adapter now awaits its unique-name callback; its authored unit cases hold and reject that persistence callback to assert payload behavior. A Windows FTP E2E reads the running SQLite row on the fixture's first received payload bytes and requires the STOU basename already be committed.
- No automated checks were run; these implementation and E2E sources return Phase 07 to active implementation. A hard app/worker crash between receiving the STOU response and committing the basename can still leave an unidentified zero-byte server object. Automatic remote-directory lookup, partial-file reconciliation and broader non-SQLite app-configuration recovery remain open; N-010 is PARTIAL.
## Eight-hop route fixture key isolation - 2026-10-31

- The full Phase 07 run reported a generated Ed25519 host key rejected during eight-hop SSH fixture construction, although a separate 100-key constructor check and an isolated route replay passed. The route E2E now uses P-256 ECDSA host keys for its gateway and target fixtures; the separately exercised Ed25519 agent-signature path remains unchanged. This keeps route-depth acceptance independent of the transient fixture key-parse failure without claiming a root cause or interoperability. No checks ran; Phase 07 remains unaccepted.
## 2026-11-01 native picker selection notification follow-up

Static review traced the recorded Windows picker failure to an early return in `Set-DialogPath`: UIA `ValuePattern.SetValue` retained the visible filename and bypassed the helper's existing native ComboBoxEx notification sequence. Removed that early return so UIA entry continues through the validated Win32 edit and EN/CBN notifications. The existing native picker E2E is the relevant loop; no automated test ran under the major-phase freeze, so selection acceptance remains unverified.
## 2026-11-01 N-010 FTP/FTPS artifact-failure visibility

- runTrackedFileTransfer now settles an unsuccessful FTP/FTPS upload as interrupted when durable progress contains a remote artifact basename. This keeps potentially retained files visible for manual review after app restart, including after a late conflict; artifact-free failures and SFTP cleanup behavior are unchanged.
- A focused unit regression is authored; no automated checks ran. N-010 remains PARTIAL.
## 2026-11-01 cancelled FTP upload restart acceptance

- Extended the existing Windows FTP restart E2E to require both the transport-failed artifact and the earlier user-cancelled STOU artifact in the post-restart recovery banner. No new fixture or network service is introduced; the assertion uses the already retained server-assigned name.
- The E2E and application unit regression are authored but unrun. N-010 remains PARTIAL.
## 2026-11-01 common native-picker action fallback

Static review found that a successful UI Automation InvokePattern returned before checking whether a common file dialog actually closed. This skipped the existing validated Win32 button fallback when UIA reported success without completing the native action. For dialogs exposing the known filename edit control, the helper now waits up to 750 ms for closure, then proceeds to the existing enabled-button and owner checks if still visible. Existing Windows picker E2Es cover selection and cancellation; none ran under the whole-phase freeze. Native selection acceptance and Phase 07 remain unverified.
## 2026-11-01 eight-hop timeout budget source audit (superseded)

Static tracing confirms the candidate uses a 180-second provider-wide routed-open deadline, eight 15-second nested-channel deadlines (120 seconds total), a 190-second worker-host request deadline with its 10-second termination cleanup grace, and a preload budget of nine 120-second credential prompts plus 190 seconds and 40 seconds of margin (1,310 seconds for eight gateways). Host-key decisions are serialized inside the provider-wide deadline; slow first-use trust approval may therefore time out before each challenge reaches its separate two-minute expiry. This is a source-level budget trace only; no route E2E or timing test ran, and eight-hop interoperability remains unverified.

## 2026-11-01 WP-04L cumulative SSH route timeout correction

- Static tracing found the 180-second provider deadline could not honor the separate per-hop host-key challenge lifetime across a slow first-use route. Added one shared application budget helper: each of up to nine SSH handshakes receives the existing 130-second ready timeout, each of up to eight nested channels retains 15 seconds, and target shell/SFTP setup gets a 20-second margin. The maximum provider deadline is 1,310 seconds; worker IPC adds 10 seconds, and preload adds nine 120-second credential prompts plus a 40-second margin for a 2,440-second maximum.
- Updated the SSH provider, worker adapter and preload to derive their deadlines from the same route-depth helper. Added authored unit and bridge fake-timer coverage for the eight-hop budget; no automated checks ran under the phase-wide freeze. WP-04L and Phase 07 remain unverified and unaccepted.
## 2026-11-01 N-010 uncertain SFTP overwrite rollback (unverified)

- When an overwrite backup contains an object different from the expected target, failure to restore that backup now returns `UNAVAILABLE` rather than `CONFLICT`. Existing transfer tracking therefore retains the uncertain operation as interrupted and keeps its recorded backup basename available for manual inspection.
- Added a fake-SFTP regression for a concurrent target replacement plus failed backup rollback. No automated check ran; Phase 07 and N-010 remain PARTIAL.
Follow-up (2026-11-01): Added a recovery-use-case regression for the same rollback failure, verifying the durable interrupted row and `.partial`/`.backup` names. It remains unrun under the major-phase freeze.
## 2026-11-01 N-010 SFTP failed-stage cleanup visibility (unverified)

When an owned SFTP upload stage cannot be removed after a skip race, another upload failure, or cancellation, the provider now returns `UNAVAILABLE` so the existing pre-transfer recovery record remains interrupted instead of reporting a clean skip or cancellation. Same-route cleanup metadata is retained, and the regression checks a different route cannot remove the stage. Fake-SFTP regressions are authored but unrun; Phase 07 and N-010 remain PARTIAL.
Correction to the 2026-11-01 SFTP cleanup note: the orphan registry is in-memory and survives only while its SSH worker remains alive. Worker termination or app restart does not automatically reconcile the remote stage; the durable interrupted record and manual folder inspection remain the recovery path. N-010 stays PARTIAL.
## 2026-11-01 local download-stage cleanup failure

FTP and SFTP download providers no longer suppress a failed local partial-file removal. They return `UNAVAILABLE`, allowing the durable tracker to preserve interrupted status; cleanup remains nonrecursive and does not delete a replacement directory. Regression tests exercise both transport callers but remain unrun under the Phase 07 freeze. N-010 and Phase 07 remain PARTIAL.
Follow-up (2026-11-01): Local staged downloads now capture the opened file identity and reject commit/cleanup if the operation path names a replacement object. Focused FTP/SFTP cases check that a replacement file is not committed or removed; tests remain unrun. Path-based filesystem calls retain a final check-to-operation race, so no race-free claim is made.
## 2026-11-01 N-010 explicit-undefined progress metadata guard (unverified)

- runTrackedFileTransfer now preserves previously captured remote artifact names if a later progress snapshot includes remoteArtifactNames: undefined, which object spread previously overwrote. The FTPS tracker regression now covers that runtime shape. No automated checks ran; N-010 and Phases 07/10 remain PARTIAL.

## 2026-11-01 real SOCKS5 client acceptance authored (unverified)

- Extended the existing eight-gateway SSH tunnel E2E fixture to accept a bounded HTTP GET and added a Windows inbox `curl.exe` request through the SOCKS5 hostname CONNECT proxy. This supplements the existing custom-protocol checks with a real client and exercises the eight-hop route; it covers TCP CONNECT only.
- Updated F-006, P-25 and WP-04M traceability. Microsoft documents the Windows curl utility at https://learn.microsoft.com/en-us/windows/curl/.
- The test was authored but not run under the Phase 07 implementation freeze. It does not address proxy authentication, BIND, UDP ASSOCIATE, public SSH-server interoperability, or the remaining Phase 07 acceptance gaps. Phase 07/P-25 remain PARTIAL.

## 2026-11-01 eight-hop SOCKS E2E event-loop correction (unverified)

Static review found the E2E used `execFileSync` for curl while the same test process owned the HTTP/SSH fixtures, blocking their event loop until curl timed out. The curl request now uses asynchronous `execFile` with the existing 20-second process bound, 4 KiB output cap, and 15-second curl deadline. No E2E or automated checks ran; Phase 07 remains PARTIAL and the test is unverified.

## 2026-11-01 WP-04L worker-timeout regression budget correction (unverified)

Static review found the worker-host timer regression still advanced the superseded 180-second provider budget after WP-04L raised the eight-hop deadline to 1,310 seconds. It now imports the shared provider-budget helper and advances one millisecond past the eight-hop provider deadline, verifying the worker request still has time to settle. No automated checks ran; WP-04L and Phase 07 remain unverified and PARTIAL.

## 2026-11-01 WP-04M explicit BIND rejection case (unverified)

Static review found the existing SOCKS5 unit case asserted the unsupported `UDP ASSOCIATE` reply and no-auth-only method selection, but did not assert the corresponding RFC 1928 `BIND` rejection. Added an explicit loopback-provider BIND request assertion for reply code 7. The source test is unrun; P-25 and Phase 07 remain PARTIAL, and no BIND support is claimed.

## 2026-11-01 Phase 07 implementation freeze for verification

The current Phase 07 source candidate is frozen for its phase-wide automated gate after WP-04L route-depth timeout/acceptance corrections, WP-04M explicit rejection coverage, WP-04N durable transfer recovery/restart coverage, and the prior forwarding, macro, and session changes. Acceptance and promotion are not claimed. P-25 remains PARTIAL because authenticated SOCKS methods, BIND, and UDP ASSOCIATE are not implemented on the current transport; N-010 retains documented manual-reconciliation and broad non-SQLite limits; external SSH/public-server interoperability and the earlier resize defect remain open. Any implementation correction found by the gate reopens the freeze and requires the applicable full verification to rerun.

## 2026-11-01 verification remediation - recovery progress typing

The first pinned typecheck failed because `runTrackedFileTransfer` wrote an explicit `undefined` for optional `remoteArtifactNames` under `exactOptionalPropertyTypes`. The tracker now merges only the three persisted progress fields and omits the optional artifact-name property when neither the new nor retained value exists. The existing authored explicit-undefined regression covers preservation of previously reported names. The freeze is reopened; no tests ran during this remediation.

The follow-up typecheck passed the application packages and exposed three test-source typing/scope errors: duplicate recovery-banner local names in the FTP restart E2E, an intentionally explicit-undefined fixture using an invalid direct assertion, and a fixture passing an invalid error target. Renamed the resumed banner local, marked the deliberate invalid runtime shape with an unknown bridge, and used the valid default application target. These are source fixes only; no tests or further checks ran yet.

The next pinned `corepack pnpm typecheck` passed both TypeScript project builds on the corrected source. Lint/import-boundary verification and the remaining phase gate are pending.

`corepack pnpm lint` then passed ESLint and the complete static/dynamic/export/type import-boundary check. The Windows x64 application build is next; no unit or E2E tests have run in this gate yet.

The runner inspection found that these commands used global Node v24.14.0 even though `.node-version` and `package.json` pin v24.14.1. Their outcomes are preliminary and do not count as pinned-toolchain gate evidence. No unit/E2E tests ran. The remaining checks are paused until an exact v24.14.1 runtime is available without changing the machine-wide Node link.

Obtained the official Windows x64 Node v24.14.1 archive inside ignored workspace `.tmp`, verified its SHA-256 (`6e50ce5498c0cebc20fd39ab3ff5df836ed2f8a31aa093cecad8497cff126d70`) against [Node's published checksum list](https://nodejs.org/download/release/v24.14.1/SHASUMS256.txt), and confirmed the extracted runtime reports v24.14.1 with Corepack pnpm 12.15.0. The machine-wide Node link remains unchanged. The full verification sequence is restarting with the exact pinned runtime; preliminary outputs above remain non-acceptance evidence.

With the implementation remediation complete and the exact runtime staged locally, the gate's repeated `git diff --check` passed. Only the same Git CRLF-normalization warnings appeared; the pinned typecheck now follows.

The exact pinned runtime/Corepack sequence passed `pnpm typecheck` (both TypeScript project builds, exit 0). ESLint and import-boundary checks are next.

The same pinned Node/Corepack sequence passed `pnpm lint`, including the repository's static/dynamic/export/type import-boundary checker. The native Windows x64 application build follows.

The pinned build passed `corepack pnpm build`: node-gyp used Node v24.14.1 on win32/x64 and compiled the native addon; Vite built the renderer. Vite retains its existing 1,052.99 kB minified chunk-size advisory. The full unit suite is next.

## 2026-11-01 pinned unit-gate fixture remediation

- The pinned full unit suite exited 1: 680 passed, 3 failed, 6 skipped. Two FTP worker-host failures came from the test fake treating `progress-ack` as a new command and replying to the still-pending upload with an empty result. The remaining FTP transfer failure called download on a session the same test had deliberately retired during rollback coverage.
- Updated the fake to record acknowledgments without replying, and moved the successful-download assertions onto the separately opened download session already used by the later cancellation cases. Production FTP behavior is unchanged. No retest has run yet; the Phase 07 verification gate remains open and Phase 07 is not accepted.
- The next pinned full unit run reported 682 passed, 1 failed, 6 skipped. The remaining failure followed a recovery-callback rejection: the direct provider test threw a generic `Error`, which correctly retires a transport after an unexpected failure, then reused that retired session for cancellation assertions. The real worker translates a failed durable-progress acknowledgment to `FtpFilesProviderError('UNAVAILABLE')`; updated the direct test to model that typed transport failure. This test change is unverified; the gate remains open.
- The subsequent pinned full unit suite passed: 683 passed, 0 failed, 6 skipped (20.8 seconds). Skips include Windows symlink-capability tests that are explicitly skipped when the account cannot create symlinks; no failing unit cases remain. Integration/E2E and remaining phase gates are still pending.
- The pinned `pnpm test:ssh-fixture` command exited 0 with 0 passed / 1 skipped / 0 failed. The live SSH/SFTP acceptance requires `MRT_TEST_SSH_HOST`, `PORT`, `USERNAME`, `PASSWORD`, and `FINGERPRINT`, which are not configured; disposable OpenSSH interoperability is BLOCKED and is not a passing acceptance check.
- The full pinned Windows `pnpm test:e2e` command completed with 69 passed, 9 failed, 7 skipped in 10.1 minutes. Failures: native local-editor and session-log dialogs; SFTP crash/no-replay recovery; durable interrupted-transfer restart/dismissal; SSH jump routes through eight gateways; saved loopback-forward restore; FTP profile browsing/reconnect; cross-profile encrypted credential-bundle restore; and custom-logo native picker. Skips: the known Git Bash first-input-after-resize case and six package smoke tests gated by package prerequisites. The detailed Playwright traces are in the generated `test-results/` report; failures are being classified before remediation. Phase 07 is not accepted.
- Static triage confirmed the SFTP failure occurs because a transfer-level `UNAVAILABLE` sets only a status notice, leaving the remote pane without its reconnect control; RemoteFilesPane now marks the transport unavailable so the existing reconnect action appears. The FTP E2E opened SQLite from its fixture root instead of Electron's captured `userData` directory; corrected both recovery-database reads. The native-dialog automation now has a strict visible/enabled Win32 button fallback by exact accepted label for dialogs with control ID 0. The native picker, folder selection, FTP and SFTP E2Es must all be rerun; no acceptance is inferred from source changes.
## 2026-11-01 native picker and local partial lookup remediation (unverified)

- The failed Windows picker logs show that common Open dialogs expose filename edit control 1148 inside `ComboBoxEx32`; the helper previously sent the combo-change notification to that control instead of its owning dialog. Updated the helper to notify the owning dialog with the inner `ComboBox` handle, as specified by [Microsoft's ComboBoxEx documentation](https://learn.microsoft.com/en-us/windows/win32/controls/comboboxex-controls). The credential-export Save dialog instead exposes edit 1001 inside `FloatNotifySink`/`ComboBox`; added that observed, ancestry-checked layout to the same bounded filename setter.
- The interrupted-download E2E seeds the exact `.mrt-<operation-id>.partial` regular file in the folder it selects. The adapter rejected noncanonical but absolute directory strings before lookup; it now resolves the user-selected directory before joining the validated fixed stage basename. Added a trailing-separator regression and made the E2E surface the lookup alert text on failure.
- These are candidate fixes based on the captured failing E2E and Windows control-tree evidence. No tests, typecheck, lint, build or package checks ran; Phase 07 and P-35 remain PARTIAL pending the complete phase gate and native picker rerun.

## 2026-11-01 Phase 07 verification candidate freeze resumed

The current Phase 07 candidate is frozen for the sequential phase-wide verification gate after source remediation for the prior Windows E2E failures: SFTP transport-error reconnect state, Electron `userData` database lookup, exact-label consent-dialog activation, common Open-dialog ComboBoxEx notifications, Save-dialog `FloatNotifySink` filename selection, and normalization of the explicitly selected local recovery folder. The local-stage trailing-separator regression and improved lookup-error diagnostics are included. The fixes have not been verified on this candidate. P-25 (authenticated SOCKS, BIND, UDP ASSOCIATE and broad interoperability), N-010 (automatic remote reconciliation and broad non-SQLite recovery), configured live OpenSSH interoperability, and the existing post-resize first-input defect remain partial or blocked; they are not waived and prevent claiming full Phase 07 acceptance. Any gate finding that changes source reopens the phase and requires the prescribed gate to run again.

- Final-candidate `git diff --check` passed (exit 0); Git emitted only existing CRLF normalization warnings. Pinned Node v24.14.1 / pnpm 12.15.0 `pnpm typecheck` passed both project-reference and tools TypeScript builds (exit 0). The freeze remains active; no unit or E2E tests have run after the latest remediation.
- Pinned `pnpm lint` passed ESLint and static/dynamic/export/type import-boundary verification (exit 0). The Windows x64 build is next in the sequential gate; no unit/E2E tests have run on the current candidate.
- Pinned Windows x64 `pnpm build` passed, including node-gyp compilation with Node v24.14.1/win32/x64 (exit 0). Vite emitted the existing 1,053.06 kB minified renderer-chunk advisory. The sequential unit gate follows; no production source changed.
- The full pinned unit suite passed: 683 passed, 0 failed, 6 skipped (20.6 seconds). The six skips are existing Windows symlink-capability cases on this account. Proceeding to the live SSH integration fixture; it will be recorded as blocked if its required disposable credentials/server are unavailable.
- The pinned SSH fixture integration command exited 0 but reported 0 passed / 1 skipped / 0 failed because `MRT_TEST_SSH_HOST`, `PORT`, `USERNAME`, `PASSWORD`, and `FINGERPRINT` are not configured. Real disposable OpenSSH interoperability is BLOCKED and is not treated as a pass. The Windows Electron E2E suite is next.
- The final-candidate pinned Windows `pnpm test:e2e` run completed with 67 passed, 11 failed, and 7 skipped in 10.2 minutes. Failures: local native text picker; SSH session-log consent/save dialogs; local interrupted-stage recovery; FTP profile browse/reconnect; macro password-prompt capture; terminal Ctrl+W/middle-click close; real-shell multi-tab workbench; Git Bash reopen; supplementary Unicode paste; encrypted credential-bundle Save dialog; custom-logo native picker. The seven skips include the known Git Bash first-input-after-resize defect and six package-artifact smoke cases. Eight-hop terminal/SFTP/tunnel route coverage and the SSH worker-crash/reconnect scenario passed. Package smoke, full `pnpm check`, and all independent reviews remain pending; Phase 07 remains unaccepted.

## 2026-11-01 native-dialog selection and FTP fixture remediation (unverified)

- Replaced fabricated `WM_COMMAND` edit/combo notifications in the Windows native-dialog E2E helper with `CDM_SETCONTROLTEXT` on the discovered filename control, then require `CDM_GETFILEPATH` to equal the requested path before activating the dialog. Microsoft documents these messages for Explorer-style common Open/Save dialogs; the current Windows E2E candidate still needs to confirm that the app dialogs accept them: [set control text](https://learn.microsoft.com/en-us/windows/win32/dlgbox/cdm-setcontroltext), [read selected path](https://learn.microsoft.com/en-us/windows/win32/dlgbox/cdm-getfilepath).
- The FTP recovery E2E no longer opens its read-only SQLite handle immediately after the app shows Ready. It opens lazily on the first uploaded payload, at the point where it asserts that the recovery artifact name was durably recorded before transfer bytes.
- No automated verification ran after these changes. The Phase 07 gate remains open; native-picker selection, local-stage recovery, FTP profile flow, and all other prior E2E failures remain unverified.

## 2026-11-01 targeted picker/FTP remediation result (gate still open)

- Ran six affected Windows E2Es with pinned Node v24.14.1 / pnpm 12.15.0: FTP profile browse/reconnect passed; local text picker, SSH session-log selection, interrupted-download recovery, encrypted credential bundle, and logo picker failed before app-level selection because `CDM_GETFILEPATH` did not report the path entered into the visible filename field. This rejects the common-dialog-message assumption for the current dialogs; it does not establish a product recovery failure for the recovery scenario.
- Replaced the CDM message approach with focus on the actual native filename edit and escaped literal `SendKeys` input, which lets the Windows edit/combo process ordinary keyboard notifications. The helper checks the resulting visible filename text. This second remediation has not yet been run; Phase 07 remains unaccepted.
- The immediate follow-up run showed `SendKeys.SendWait` fails with Windows `Access denied` for the helper process on this desktop, across the five affected picker cases; FTP passed again. Replaced global keyboard injection with focused edit-control `WM_CHAR` input, which should use the edit's normal native notification path without cross-process input injection. This candidate is unverified and Phase 07 remains open.
- A focused local-text picker rerun then failed because the native edit text did not match after `WM_CHAR`; no app-level picker assertion ran. The helper now needs more precise instrumentation/selection handling before further broad retries. All other tests remain unrun against this latest approach.
- Replaced per-character `WM_CHAR` with the native edit control's `EM_SETSEL` plus `EM_REPLACESEL` operation after focusing the actual filename edit. This sends the replacement through the control's edit-change processing and supports Unicode paths without global input injection. The change is unverified.
- The focused test showed `EM_REPLACESEL` also failed the helper's visible-text assertion. Reassessing the earlier CDM attempt revealed it had been aborted before clicking because the helper required `CDM_GETFILEPATH` to equal a typed path before the dialog processed Open/Save. Restored only the documented `CDM_SETCONTROLTEXT` setter and visible-field validation; the E2E will now verify actual dialog selection after activation. This revision is unverified.
- The focused test also showed `CDM_SETCONTROLTEXT` did not update the observed filename edit, so the legacy-message approach is rejected for this dialog. Added a direct `AutomationElement.FromHandle(edit).GetCurrentPattern(ValuePattern).SetValue(path)` attempt before the native setter. This revision is unverified; app-level picker acceptance has not been reached.
- A focused local-text picker rerun showed the direct-handle UIA attempt and CDM setter still did not update the edit. Changed the helper to set the observed parent `ComboBoxEx32` control (ID 1148) and verify its nested edit; the Save-dialog layout continues to set its ancestry-validated edit (ID 1001). This revision is unverified.
- That focused test also showed setting the parent `ComboBoxEx32` did not update its nested edit. Restored the confirmed visible-text setter on the nested edit and removed all synthetic combo notifications, so the E2E can test the native dialog's own response to activation. This revision is unverified.
- With direct edit text and no synthetic notifications, the local-text picker still remained open after its action button. Microsoft documents that ComboBoxEx reports completed edit operations through a `CBEN_ENDEDIT` `WM_NOTIFY`; the next helper candidate will set the edit, send that properly structured notification with `CBENF_RETURN`, and then let the dialog's action button validate the path. This is test automation only and remains unverified: [ComboBoxEx notification model](https://learn.microsoft.com/en-us/windows/win32/Controls/comboboxex-controls), [NMCBEENDEDITW layout](https://learn.microsoft.com/en-us/windows/win32/api/commctrl/ns-commctrl-nmcbeendeditw).
- The focused E2E after the `CBEN_ENDEDIT` notification still failed because the dialog remained open. Added `CDM_GETFILEPATH` to native-dialog failure diagnostics to distinguish visible filename text from the common dialog's committed selection state before further changes.
- The follow-up local-picker run still left the dialog open and reported an empty `CDM_GETFILEPATH` value after `CBEN_ENDEDIT`; no file was selected. Removed the ineffective synthetic `CBEN_ENDEDIT` message while retaining the selected-path diagnostic. Native file selection remains BLOCKED on this helper/runtime and is not accepted.

### 2026-11-01 native picker cross-process message diagnosis

- A focused rerun after removing the synthetic notification reproduced the open-dialog failure. The actual configured action button is ID 1 / `Edit`; the helper invoked it, so a localized-button-name mismatch is not the cause.
- The earlier `CDM_GETFILEPATH` call passed a PowerShell-process `StringBuilder` address to the app process. Since the message is above `WM_USER`, Windows does not marshal that pointer. The diagnostic now uses bounded target-process memory. Filename setting attempts the same explicit marshalling for `CDM_SETCONTROLTEXT`, but the E2E then failed before field read-back; the exact failing Win32 operation still needs instrumentation. Microsoft sources: [CDM_SETCONTROLTEXT](https://learn.microsoft.com/en-us/windows/win32/dlgbox/cdm-setcontroltext), [SendMessage cross-process marshalling](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendmessage).
- This changes E2E helper code only. The latest focused picker run is red; Phase 07 remains unaccepted and no broader verification ran.
- Added stage-specific Win32 error reporting for dialog-owner access, remote allocation/write, bounded CDM message, and visible/selected path read-back. This helper instrumentation is unverified; no broader check ran.
- The focused rerun completed remote allocation/write and the `CDM_SETCONTROLTEXT` send without a Win32 error, but both filename edit and selected-path read-back remained empty. This current picker ignores that legacy setter; the next isolated probe uses UI Automation on the owning filename combo. No product code or broader test scope changed.
- Removed the ineffective cross-process CDM setter and selected-path probe after confirming the modern picker ignored them, which also removes unnecessary remote-process memory access. The current isolated helper probe uses the owning `ComboBox` UIA `ValuePattern` and validates the real filename edit read-back; it is unrun.
- The combo `ValuePattern` probe was run and failed with “Pattern not supported”; the filename edit remained empty. Replaced it with `LegacyIAccessiblePattern.SetValue` on the native Edit handle, as a separate probe. It is unrun; Microsoft documents the pattern as a bridge to MSAA servers and notes value-setting is supported only for some elements: [pattern](https://learn.microsoft.com/en-us/windows/win32/api/uiautomationclient/nn-uiautomationclient-iuiautomationlegacyiaccessiblepattern), [SetValue](https://learn.microsoft.com/en-us/windows/win32/api/uiautomationclient/nf-uiautomationclient-iuiautomationlegacyiaccessiblepattern-setvalue).
- PowerShell 5.1 lacks the managed `System.Windows.Automation.LegacyIAccessiblePattern` type. Replaced that unexecutable probe with `AccessibleObjectFromWindow` and `Accessibility.IAccessible.set_accValue` on the native Edit HWND; the COM interop candidate is unrun.
- The E2E reached `AccessibleObjectFromWindow`, which returned the requested IAccessible IID, but PowerShell could not cast its COM proxy to `Accessibility.IAccessible`; no text was set. Removed the cast to try the same native IDispatch member directly. The next probe is unrun.

### Picker investigation reconciled against October 31 handoff

- The full handoff already records that SendInput is blocked because the desktop foreground is unrelated to the app, and that direct native edit text followed by the documented ComboBoxEx `CBN_EDITCHANGE` plus nested Edit `EN_UPDATE`/`EN_CHANGE` notifications still leaves the picker open. The ComboBoxEx notification target had also been corrected in the historical notes. These approaches are already tried and remain failing.
- This continuation reproduced the direct-SetWindowText picker failure, then confirmed cross-process CDM setting does not update this dialog and the filename combo has no UIA ValuePattern. Removed the speculative CDM/UIA/MSAA helper paths and restored direct SetWindowText. Removed the invalid `CDM_GETFILEPATH` diagnostic because its WM_USER+ buffer was not marshalled by SendMessage. The cleanup itself has not been rerun; the direct-setter behavior was the red baseline.
- Native picker acceptance stays BLOCKED; this is test helper work only and no product code changed. Proceed with independent Phase 07 failures.
- Targeted `macro recorder captures completed terminal lines and suppresses a recognized password prompt` failed before recording because Electron `clipboard.writeText` read back empty after the bounded five-second poll; prompt assertions were not reached. The focused companion `macro recorder protects a recognized password prompt already open when recording starts` passed (1/1), covering detection, pause, and secret exclusion without clipboard use. The clipboard-dependent paste-omission acceptance remains blocked by this host; no product code changed.
- Split the combined terminal-tab E2E at the clipboard boundary: copy/clear remains in its own clipboard-dependent test, while Ctrl+W, middle-click, and confirmed context-menu close are covered by a standalone test. Targeted pinned-runtime execution passed (1/1, 3.7s), confirming all three close paths independently of clipboard behavior.
- The cleaned native local-text helper completed cancellation, then failed selection: the Windows common dialog remained open after the actual filename edit was populated and its action button invoked. The helper now names the failed action. This confirms the unresolved boundary is selection acceptance, not cancellation; native file selection remains blocked.
- The focused FTP profile/browse/reconnect E2E passed on the pinned runtime (1/1, 10.8s) with the corrected captured-userData SQLite path and virtualized-list positioning. This closes that specific gate failure; it does not verify the full FTP recovery acceptance beyond the test's assertions.
- The focused SFTP crash/no-replay recovery E2E passed on the pinned runtime (1/1, 2m). It validates forced worker/application interruption, durable status after restart, and no automatic reconnection; native local-stage reveal is a separate acceptance path.
- Added a focused Windows recovery restart E2E for durable interruption display, path secrecy, safe progress, explicit status dismissal and SQLite deletion. It separates these checks from the native folder-picker action in the broader recovery E2E; the new test is authored and unrun.
- The first focused status-test run exposed fixture ordering (SQLite was edited before the initial app reached `Ready` and applied migrations). Added the same ready-state wait used by the existing restart E2E; this test-fixture correction remains unverified.
- The next status-test run reached recovery UI assertions and found its no-auto-resume text locator was scoped too narrowly to a row; corrected it to the containing recovery region, matching the existing acceptance locator. The rerun remains pending.
- Focused status-only recovery E2E passed on the pinned runtime (1/1, 4.1s): restart converted the seeded running row, rendered redacted durable progress and explicit no-auto-resume status, dismissal removed the selected row from SQLite, and the fixture path was absent from renderer text. Folder selection/reveal remains separately blocked.
- The broader recovery E2E closed the native directory dialog, then reported `NOT_FOUND` for the chosen directory. Its fixture creates the expected operation-ID stage for both the current and older records; static adapter naming matches the seed format, so the selected folder value versus the older operation-ID must be diagnosed before accepting local-partial reveal.
- Added a current-page record lookup before the existing older-page lookup in the recovery E2E, each against its own operation-ID stage in the same selected directory. This distinguishes a selected-directory problem from a paginated-record ID mismatch; targeted rerun pending.
- The current-page lookup also returned `NOT_FOUND`. Added a temporary E2E diagnostic wrapper that forwards to the real native `showOpenDialog` and captures only its returned path for comparison; it does not fake selection and is diagnostic-only, not acceptance evidence. Rerun pending.
- Diagnostic capture showed the genuine native dialog returned `C:\\Users\\Mance\\Downloads`, not the workspace `partials` directory. This confirms the old helper closed the dialog in its default Downloads location; visible filename text was not the selected directory. Next probe sets the test app's Downloads path to a workspace fixture directory and keeps the native dialog/action real.
- Set the isolated test app's standard Downloads location to the workspace partials directory before opening the real folder picker, to test whether the OS dialog's default directory follows Electron's configured path. This diagnostic rerun is pending.
- With the workspace-local Downloads path, the real dialog returned the requested folder and local-stage lookup succeeded for the current-page archive row. The older paginated row still surfaced `NOT_FOUND`; added a second returned-path comparison to isolate its operation-ID association. This remains a diagnostic, not native-picker acceptance evidence.
- The second native dialog also returned the exact workspace fixture folder, but its older-row lookup still produced `NOT_FOUND`. Added a direct typed-bridge pagination assertion that `older-001.tar` carries the seeded operation ID before the UI action; this distinguishes renderer row binding from repository query results. Rerun pending.
- Removed the main-process diagnostic hook because the test uses a prior built Electron bundle; compiling it would invoke the build script's cleanup of both generated `dist` trees. Replaced it with a direct typed-bridge call using the exact paged operation ID, while retaining the real native dialog; this diagnostic distinguishes UI-button binding from the shared lookup without a production change.
- The real-shell 10-tab/process E2E failed before tab creation and process lifecycle checks because its initial supplementary Unicode clipboard write read back empty. Split clipboard paste acceptance into its own Windows E2E so the shell/tab/process scenario can be evaluated independently; the changed tests are not yet rerun.
- After separation, the real-shell 10-tab/process E2E passed on the pinned runtime (1/1, 27.3s), verifying startup cancellation, bridge isolation, nine PowerShell processes plus cmd, tab navigation, resizing, confirmed close, worker-crash cleanup and restart. Clipboard paste remains separately blocked by host read-back.
- Split Git Bash's Unicode clipboard assertion from its real-shell/prompt-color/saved-session test for the same failure-boundary reason. The Bash paste remains independently represented; neither resulting test has run after the split.
- After separation, the Git Bash shell/prompt-color/resize/saved-session-reopen E2E passed on the pinned runtime (1/1, 7.2s), including shell output, prompt state, continuation handling, saved reopen and close behavior. Its Unicode clipboard paste remains an independent host-blocked acceptance.
- Correction to the recovery diagnosis: with the app Downloads path set to the workspace `partials` folder, both current and paginated older-row selections returned that exact folder and produced no alert. The apparent older-row failure was an eager diagnostic string awaiting `alert.textContent()` when no alert existed; the locator timed out rather than indicating `NOT_FOUND`. The assertion now checks alert absence directly; final targeted rerun pending. Removed temporary probes; no production source changed.
- Final focused recovery restart E2E passed on the pinned runtime (1/1, 12.3s), verifying durable status, older-page targeting, native folder selection/cancellation, exact stage reveal, dismissal and SQLite deletion. The app Downloads path was scoped to its workspace fixture; no product code changed.
- Set the local text editor E2E app's Downloads path to its workspace fixture directory and added a forwarding-only probe of the real native open-dialog result. This checks whether the real picker selects the fixture after the existing helper action; targeted rerun pending.
- Correction to the recovery diagnosis: with the app Downloads path set to the workspace `partials` folder, both the current and paginated older-row selections returned that exact folder and produced no alert. The apparent older-row failure was an eager diagnostic string awaiting `alert.textContent()` when no alert existed; the locator timed out rather than indicating `NOT_FOUND`. The assertion now checks alert absence directly; final targeted rerun pending. Removed temporary main-process/direct-bridge probes; the app build was not run because its script cleans both `dist` trees.
- The focused local-text E2E still failed at native selection: cancellation passed, but the genuine Windows Common File Dialog stayed open after the helper populated the filename control and invoked the configured Edit action. The forwarding-only result probe was not reached. This reproduces the previously documented native picker boundary; no product source changed. Local-text native selection remains BLOCKED on this desktop, and the Phase 07 gate remains open.
- Focused eight-gateway saved-profile route E2E passed on pinned Node v24.14.1/pnpm 12.15.0 (1/1, 32.0s). It exercised one- through eight-gateway chains for SSH terminal, SFTP-only and tunnel modes, per-hop trust and cleanup. This verifies the revised P-256 fixture and bounded routes in the controlled loopback environment only; it does not establish public-server interoperability or close P-22/P-24/P-25.
- Rechecked P-02/F-002 first-input-after-resize acceptance and its preload/ConPTY path. The E2E remains explicitly skipped; repository evidence records 19/25 passes across the latest repeated Bash run and no stable `node-pty`/ConPTY resize-completion or child-redraw acknowledgment. No implementation change was made because the known wait/order variations do not reliably fix the loss and disabling Readline would alter normal shell behavior. P-02/F-002 remain open.
- Added an unverified test-helper path that selects the unique enabled `settings.txt` file-list item through Windows UI Automation `SelectionItemPattern` in the actual app-owned dialog, rather than setting its filename edit. The helper still invokes the configured native dialog action and checks that it closes; it does not replace the dialog result. No product source changed. Focused local-text picker E2E pending.
- The focused picker rerun showed Windows UI Automation exposes no enabled `ListItem` or `DataItem` named `settings.txt` in this app-owned Common File Dialog. Removed that unusable speculative helper and restored the existing validated filename-control path. The test failed before activating selection; the returned-dialog-path probe was not reached. Native file selection remains BLOCKED by this desktop's dialog surface; no product source changed.
