# Session Context for Resume

This file records the work state at the user's request to pause and resume tomorrow. **Do not commit this file.** It is a temporary, untracked handoff note.

## Objective and workflow

- Continue MultiRemoteTerminal development on `dev`; commit each completed phase, review it against the specification and standards, and push after fresh remote verification. Promote reviewed, accepted phases to `main` with regular `--no-ff` merges, then return to `dev`.
- Product remains unfinished. WP-01L PowerShell backtick continuation coloring is reviewed and promoted; P-30 remains PARTIAL and the Windows release gates remain open.
- Current branch state: `dev=1b1497affb9fbcfb58d015fb43889afa7cca3873`, tracking `origin/dev`; `main=e1209cc878b5f2f09b3ffdd4eb0360cc721cd86b`, tracking `origin/main`. `origin/HEAD` points to `main`; dev is an ancestor of main and both trees are `187d5ebdfd1f238bd9b69c6a633d186bdae2dc68`. Continue work on `dev` and keep requirement statuses partial until their documented acceptance gates pass.
- Keep `docs/` canonical. Never claim implementation, tests, packaging or pushes without verification. Use essential tests and preserve known security/interop limits.
- Keep this file untracked. The user explicitly said not to commit `session-context.md`.

## Branch and remote state at the WP-05K promotion (historical)

- Workspace: `E:\This is my year\MultiRemoteTerminal`
- Current branch: `dev-1`
- Local and remote `dev-1`: `b4d2cd9aeb0089bfd46a2e745664afa025b41cb7` (`fix(sftp): make recovery barrier cancellable`).
- Remote `main`: merge commit `3c9d7789ffc78c95bd4e8df829fd26a88d31a249` (`merge: promote WP-05K SFTP upload recovery`), whose second parent is the promoted `dev-1` commit.
- `origin/HEAD` points to `main`. Remote refs were verified with `git ls-remote --heads origin dev-1 main` after both pushes.
- Tracked worktree is clean; this file is the only untracked item. Do not add or commit it.

## Work completed before this pause

### Earlier project progress

The repository already contains the documented Windows app foundations and prior vertical slices, including secured Electron/preload IPC, local terminals, SSH/SFTP, Telnet, FTP/FTPS, SSH tunnels/gateways, saved sessions/folders and JSON folder export/import, terminal-tab close/context actions, Bash support, and WP-06A's persistent typed macro library. Consult `docs/FEATURE-MATRIX.md` and the linked evidence records for exact scope and limits.

### WP-06B1 implementation and prior fixes

- Added an application-layer recorder for one running local/SSH/Telnet terminal. It retains complete input lines only, caps steps/line/total macro text, omits clipboard paste, stores no output/transcript, strips ANSI control strings, and uses heuristic recognized-secret-prompt suppression.
- Added prompt/resume tests for repeat prompts, paused prompts, control strings, redraws, manual pause, line/step/text limits, and focus handling.
- Updated renderer start/resume focus, prompt warnings, reserved macro-name text budget, save/retry behavior, docs, and Windows E2E coverage.
- Review defects fixed before commit `738e354`: recorder resumes safely around a recognized prompt already open while paused; repeated recognized prompts are not ignored; redraws inspect current content; paused output tracks a bounded transient line; recorder focus avoids dialogs; aggregate text limits reserve the macro name.

### Review results for committed HEAD `738e354`

Two-axis review was run against `origin/main...HEAD`.

- Spec reviewer found: (1) an already-visible prompt at recording start was not seeded into the recorder; (2) cursor-addressed redraw rows were flattened instead of tracking the cursor row; (3) the stopped-recording save-error banner omitted the error code. It otherwise confirmed the earlier pause/repeated-prompt/focus fixes and that documentation counts were correct for that committed tree.
- Standards reviewer found: paused prompt detection was recalculated from the entire line and could clear after an echoed character/newline, allowing a possible secret capture. It found no further smell-baseline issue and confirmed other reviewed fixes.
- These findings are not yet fully reviewed after correction. Fresh two-axis review is required before publishing.

## Current uncommitted changes at pause

Only these tracked files were modified after `738e354`:

- `packages/application/src/macro-recording.ts`
  - Prompt detection while paused is now latched until input submission or Ctrl+C.
  - Screen-redraw parsing tracks a bounded set of rows and cursor coordinates for common CSI cursor movement/erase sequences; it checks the actual cursor row.
  - Added bounds for rows and CSI sequence length.
- `apps/desktop/src/renderer/TerminalPane.tsx`
  - `TerminalUiHandle.currentLineText()` reads the active xterm buffer line up to the cursor.
- `apps/desktop/src/renderer/main.tsx`
  - Recording refuses a missing terminal handle and seeds the recorder with the target terminal's currently visible cursor line before accepting input.
  - Recording save failure text now includes target, IPC error code, and retry/discard guidance.
- `tests/unit/macro-recording.test.ts`
  - Added two regressions for prompt latch across echo/newline and cursor-addressed redraw.
- `tests/e2e/foundation.test.ts`
  - Added a Windows scenario that opens a PowerShell password prompt before recording starts and verifies its secret is omitted.

`session-context.md` is new and untracked. Keep it uncommitted as requested.

## Validation evidence

### Last full check, on committed HEAD before the latest fixes

`corepack pnpm check` passed on `738e354` before the uncommitted review fixes:

- TypeScript typecheck and tools typecheck
- ESLint and import-boundary checks
- 255 unit tests
- Windows x64 native addon and renderer build
- All 19 Electron E2E tests

The renderer emitted a bundle-size advisory (about 669.59 kB minified at that build); the build succeeded.

### Latest dirty-tree checks

- `node --test tests/unit/macro-recording.test.ts`: **14/14 passed** after the latch/redraw code changes.
- `corepack pnpm build`: **passed** after the latest renderer/application changes; native x64 addon built; renderer bundle is 671.04 kB and emits the same >500 kB advisory.
- The new prompt-at-start E2E was first run against the old built renderer and failed as expected: no recognized-prompt status appeared after starting recording at an open `Password:` prompt. It was a successful reproduction before the fix; it has **not** been rerun against the latest build.
- A first attempt at that E2E failed in test setup because the xterm textarea was not focused. The test was adjusted to click the terminal host and then focus verification passed far enough to reproduce the actual missing-prompt warning.
- No `typecheck`, lint, focused E2E after the latest build, or full `pnpm check` has run after the current changes.

## Historical next steps at the WP-06B1 pause

1. Re-check `git status --short --branch`; stay on `dev-1`. Preserve the current modifications and the untracked `session-context.md`.
2. Run `node --test tests/unit/macro-recording.test.ts` if code changed since the recorded green run.
3. Run the new E2E against the current build:
   `corepack pnpm exec playwright test --grep "protects a recognized password prompt already open"`
   Fix any test or implementation issue and repeat until green.
4. Run the existing recorder E2E and, if focus code changed, the macro-library focus E2E.
5. Run `corepack pnpm check` on the exact final source. Expected counts are likely 257 unit tests and 20 E2Es after the two new unit tests and one new E2E, but verify actual output.
6. Update `docs/ARCHITECTURE.md`, `docs/SECURITY.md`, `docs/FEATURE-MATRIX.md`, `docs/adr/ADR-0013-wp06-macro-safety-and-storage.md`, and the WP-06B1 evidence file to describe prompt seeding, latched prompt state, cursor-aware redraw scanning, save-error metadata, and actual final test counts. Keep F-007/P-28/P-40 partial until later requirements pass.
7. Run `git diff --check`; ensure no debug markers or generated build products are staged. Commit only the implementation/docs/tests, not `session-context.md`.
8. Request fresh Spec and Standards reviews against `origin/main...HEAD`; handle material findings and revalidate.
9. Push `dev-1`, verify with `git ls-remote --heads origin dev-1`, merge into local `main` preserving history (no force push), push `main`, verify remote hashes, then return to `dev-1`.
10. Continue WP-06B2 explicit single-terminal playback, then WP-06C confirmed MultiExec. Keep limitations explicit; the project is not release-complete.

## Skills and design constraints

- Read during this work: `code-review`, `requesting-code-review`, `diagnosing-bugs`, and `codebase-design` under `C:\Users\Beasty\.agents\skills\`.
- The diagnosing-bugs loop was applied to the new review findings: two new unit tests were run red (both failed on the pre-fix implementation) and then green after the fix. The new Windows E2E also reproduced the open-prompt-start gap before the code fix.
- WP-06B2 should follow the architecture's `MacroRunner` deep-module entry (`validate`, `run`, `cancel`) and macro IPC/progress event family in `docs/ARCHITECTURE.md`; keep target selection per run, require explicit preview/approval, support cancellation/timeouts, stop on disconnect, and never auto-reconnect/replay. Read relevant sections of `docs/IMPLEMENTATION-PLAN.md`, `docs/ARCHITECTURE.md`, `docs/SECURITY.md`, ADR-0013, and current source before implementing.
- No dependency was added. The MobaXterm archive was not inspected during this resumed slice; WP-06 behavior is already specified and did not need external reverse-engineering evidence.

## Resumed WP-07C startup greeting work (2026-10-25)

- Active branch is `dev-1`, tracking `origin/dev-1` at `5a6009d` before this slice commit. `origin/main` is at merge commit `486013c` before this slice promotion.
- Implemented persisted, bounded Unicode startup greeting preferences end to end: domain validation, application manager, SQLite settings repository in the storage worker, typed IPC, accessible settings dialog, startup display/dismissal, docs and Windows E2E coverage. No new package or schema migration was needed.
- Applied `codebase-design`, `frontend-design`, `ui-taste`, `web-design-guidelines`, `diagnosing-bugs`, `requesting-code-review`, and `code-review` workflows. The dialog was inspected at a 620 px viewport; its screenshot is ignored local output under `test-results/`.
- Found that the validator accepted Unicode C1 control U+0085. Added a regression assertion, observed the expected red failure, changed validation to reject Unicode `Cc` controls other than tabs/newlines, then confirmed the focused suite green.
- Latest checks: `corepack pnpm typecheck` passed; `corepack pnpm lint` and import boundaries passed; focused seven-file suite passed 74/74; Windows build passed (renderer bundle 725.75 kB minified / 195.06 kB gzip, with Vite's >500 kB advisory); targeted Windows Electron E2E passed (over-limit message, save, dismiss, restart, clear, restart); `git diff --check` passed. The oversized-input regression test was first run red, then passed after adding the pre-scan UTF-16 length bound.
- `docs/results/WP-07C-startup-greeting-2026-10-25.md` records behavior, architecture, verification, limitations, and review status. P-34 is verified for this narrow feature, while F-009 and WP-07 release gates remain open.
- WP-07C is committed locally on `dev-1` as `57a67c9`, `1837c33`, `910c0db`, `4a32772`, `3dc0cf5`, `e59f13f`, `5f00675`, and evidence-only follow-up `d9d91ab`. Final spec, standards and merge-readiness reviews passed on code head `5f00675`; the results-only follow-up records the outcome. Next: fetch/verify, push `dev-1`, merge into `main` with a normal merge commit, push and verify `main`, then return to `dev-1`.
- Review-driven fixes now map preference errors to user-facing retry/recovery guidance in both the settings dialog and startup alert. Corrupt settings retain a distinct non-retryable `CORRUPT` code through application and typed IPC boundaries. A regression test reproduced the category collapse to `UNAVAILABLE` before the mapping fix.
- A merge-readiness review found that size validation happened after normalization. The domain now rejects input longer than 1,024 UTF-16 code units before scanning; a test instrumenting `String.prototype.replace` reproduced the old work pattern red and passes with the guard. The IPC parser has an oversized-payload rejection assertion.
- A subsequent E2E review found the text-area error message misreported over-limit input as a control-character error; the E2E reproduced the message mismatch, which now reports the 512-character limit and keeps Save disabled.
- Do not stage or commit this `session-context.md` file. Continue to the next documented work package after WP-07C; do not consider the overall project finished.

## Resumed WP-08A external RDP launch (2026-10-25)

- Implemented and committed `87f4e6e` (RDP viewer launch), `69b9f19` (result formatting), `2b7cbdb` (trusted gesture security fix), and `b31119d` (review outcome).
- Independent spec review approved with P-07 and F-018 still partial. Standards review first found a P1 bypass: direct `rdp.launch` requests could spawn the external viewer without going through the dialog. The fix requires a trusted click on the marked RDP launch button, binds it to the canonical host and port in preload, adds a short-lived main-process authorization, and requires the broker to consume that sender/endpoint-scoped authorization before spawning. Follow-up review found no remaining bypass and recommended merge.
- Verification after the fix: typecheck, lint/import-boundary checks, full unit suite (301 passed), Windows x64 build, and targeted RDP Windows E2E (including direct bridge-call denial and trusted launch) passed. No live RDP server was available; P-07 remains PARTIAL.
- `dev-1` remote hash is `b31119d`; `main` remote merge hash is `82f1db8`. Returned to `dev-1` after promotion. Keep `session-context.md` untracked and do not commit it.

### WP-08B VNC research before implementation

- `docs/IMPLEMENTATION-PLAN.md` says WP-08 covers external RDP/VNC providers first and a remote text editor with save-conflict semantics; `docs/FEATURE-MATRIX.md` keeps P-08 planned.
- The local machine has no `vncviewer.exe` or `tvnviewer.exe` at standard TigerVNC/TightVNC install paths and neither command resolves from PATH.
- Official TigerVNC materials inspected: GPL-2.0 license, Windows x64 viewer packages, standalone viewer artifact about 24.1 MB, current stable release 1.16.2 from 2026-03-26, standard install prefix `C:\Program Files\TigerVNC`, and `vncviewer [host][::port]` connection syntax. Sources: https://github.com/TigerVNC/tigervnc, https://sourceforge.net/projects/tigervnc/files/stable/1.16.2/, https://tigervnc.org/doc/vncviewer.html, and TigerVNC `BUILDING.txt`.
- No VNC dependency was added, downloaded, installed, or run. Decide whether the integration should detect only a fixed TigerVNC install path, then record licensing/integrity and real fixture limitations before coding. Do not bundle GPL viewer binaries without a separate licensing decision. A live screen/input test still needs a trusted viewer and local RFB test server.
- Relevant codebase-design skill was reread. For implementation, preserve a narrow typed launch interface, fixed executable discovery, shell-free args, endpoint validation, explicit-click authorization, no credential persistence, and truthful external-provider state. Use targeted essential unit tests plus Windows E2E when feasible.

## WP-08B VNC implementation and review fix (2026-10-25)

- Implemented the user-installed TigerVNC launch flow and credential-free VNC profiles. Bundle format is v5; prior v1â€“v4 inputs remain compatible under their existing kind limits. Added a one-use endpoint-bound trusted click, fixed OS-known Program Files discovery, no PATH lookup or shell, and an external-provider security warning. No TigerVNC binary was downloaded, installed, bundled, or used.
- Added `docs/results/WP-08B-vnc-external-viewer-2026-10-25.md`, ADR-0016, dependency record and user guide/help updates. P-08 stays PARTIAL because no live viewer/server was available and connection/display/input behavior is unverified.
- Commit `97ed87c` was pushed to `origin/dev-1`. Remote verification returned `97ed87c067c6370ad03f01200d4f49834dea90b8`; `origin/main` was `82f1db82276aa9ec01f63af1b57de1133fc758c3`.
- First review: Spec review recommends merge for the partial scope; it notes F-015 reconnect/error behavior tied to live viewer state remains open. Standards review found that mixed-case/lowercase Windows `VNC_USERNAME` / `VNC_PASSWORD` environment names could evade exact-case deletion.
- Applied `diagnosing-bugs`: added an environment-at-spawn assertion and ran `corepack pnpm exec node --test tests/unit/vnc-viewer.test.ts`, which failed red on the mixed-case key (`true !== false`). Changed filtering to compare names case-insensitively. Focused seven-file test suite passed 103/103, typecheck passed, lint/import boundaries passed, Windows x64 build passed (736.25 kB minified renderer warning), and VNC Windows E2E passed 1/1.
- Security fix is committed as `bb2ad86` and pushed. The final follow-up Spec and Standards reviews both approve merge for this scoped partial slice; the Standards issue is fixed and the Spec reconnect limitation remains documented. A results-only follow-up commit records both reports. Promote to `main` with a normal merge commit, then continue on `dev-1`; do not stage or commit this context file.
- Next planned feature: WP-08 remote text editor with remote-change conflict detection, then syntax/color behavior under F-014 as a separately verified partial/complete slice. Read current SFTP modules and relevant docs before implementation.


## Resume update â€” WP-08C completed and promoted (2026-10-25)

The user explicitly instructed continuous autonomous work until completion or manual pause. Continue on `dev-1`; do not stop after this context entry. Preserve `session-context.md` as untracked and never commit it.

### Final WP-08C work

- Added the conflict-aware SFTP remote text editor for regular files, with explicit read/save/reload, strict UTF-8 and 512 KiB limits, SHA-256 revisions, remote identity checks, staged sibling writes, backup/replace with rollback attempts, pre-commit cancellation, progress, typed IPC, worker ownership, and draft retention on conflict.
- Added a regression test after independent review found that closing during an active operation could leave pane actions disabled and that a confirmation could overlap commit. The reproducer failed before the fix. The final UI keeps the dialog open while an operation is active, allows cancellation before commit, waits for cancellation settlement before closing, blocks save/reload while a discard prompt is open, blocks close/discard during work, and resets activity on effect cleanup.
- Fixed textarea newline normalization by normalizing for display and restoring the first line-ending style from the remote file on save. Consistent CRLF/LF/CR files retain their convention; mixed-style files use the first detected style throughout. The E2E fixture now verifies CRLF preservation.
- Review outcomes: Standards found zero documented-standard breaches. It kept duplicated SFTP lock wrappers and string revision values as judgment-call suggestions, not merge blockers. Spec review found zero actionable mismatches. General review found no remaining actionable issues after the fix; ready to merge.
- Final validation after the fix: `corepack pnpm typecheck` passed; `corepack pnpm lint` passed including import-boundary checks; the focused eight-file unit command passed 113/113; `corepack pnpm build` passed on Windows x64 (Vite renderer chunk 742.94 kB, over its advisory 500 kB); `corepack pnpm setup:electron` passed; the focused Playwright loopback SFTP E2E passed 1/1 in 23 seconds.

### Commits, push and promotion

- `3281920` â€” `feat(sftp): add conflict-aware remote text editor (WP-08C)`.
- `e5c8808` â€” `fix(sftp): keep editor operations safe during close`.
- `a703a55` â€” `docs(results): record WP-08C review outcome`.
- `1d26387` â€” `docs(results): record WP-08C main promotion`.
- Pushed `dev-1` through `1d26387837c45de9aafb99125c95c2159ffdd18d`.
- Promoted code with normal merge commit `bfd6e1f5a6198558db3da17b77e89945311a088a`; promoted the final evidence record with normal merge commit `b9eb9ea08d072833f2aab9a29161ee426eb44275`.
- Latest `git ls-remote --heads origin dev-1 main` confirmed `dev-1=1d26387837c45de9aafb99125c95c2159ffdd18d` and `main=b9eb9ea08d072833f2aab9a29161ee426eb44275`.
- Workspace is back on `dev-1`, clean except for this untracked file.

### Next work

Continue with the next uncompleted vertical slice in `docs/IMPLEMENTATION-PLAN.md` and `docs/FEATURE-MATRIX.md`. WP-08C remains partial under F-014/P-27: local editing, syntax/color profiles, keyword highlighting, autosave and high-DPI acceptance remain open. The earlier user also asked for terminal readability and more connection types; inspect current matrix and implementation plan to pick the next scope, use its required installed skills, implement incrementally, test only essential behavior, review before merge, push from `dev-1`, merge into `main` preserving history, and return to `dev-1`.

## Resume update â€” WP-09E serial terminal and profiles promoted (2026-10-25)

The user's latest instruction is to continue autonomously until the product is ultimately finished or manually paused. This section supersedes the older branch hashes and next-work suggestions above. Keep this handoff file untracked and never commit it.

### Current branch and remote refs

- Workspace: `E:\This is my year\MultiRemoteTerminal`
- Current branch: `dev-1`, tracking `origin/dev-1`.
- `origin/dev-1`: `171d07834f5e81ee24b2293d92b653a6c932b1a0` (`feat(serial): persist profiles and extend folder bundles`).
- `origin/main`: `7c915f4964d5c9d4347284392f4e9a0524e46813` (regular merge commit promoting serial profile persistence).
- The last merge was verified with `git ls-remote`; local work returned to `dev-1`.
- Working tree is clean except this untracked file.

### WP-09E P-12A â€” Windows serial/COM terminal

- Added strict `COM1`â€“`COM4095` config validation, bounded port listing and serial write deadlines; application lifecycle/controller; typed `serial.*` commands; native SerialPort adapter in a supervised Electron utility worker; and renderer port picker, terminal session, tab close and context-menu integration.
- Added approved pinned SerialPort production dependencies and mock-only test support; documented ADR-0019, dependency evidence and partial feature status.
- Unit tests, typecheck, lint/import-boundary checks, Windows x64 build, mock-backed serial E2E and packaged Windows smoke passed. The E2E only opens the test mock. No physical COM device or driver signature was verified. The Vite renderer bundle exceeds the 500 kB advisory.
- Independent Standards and Spec review found no blocking findings.
- Commit `538833c` was pushed on `dev-1`, merged into `main` with regular merge commit `cea08b7a07441546ba0af11d13fcd6035e13a1a9`, verified remotely.

### WP-09E.1 â€” Serial saved profiles and bundle v6

- Saved definitions now accept a validated, non-secret serial configuration. SQLite stores the settings in `options_json` with null `host`, `port` and `credential_ref`; the existing schema already permits `kind='serial'`, so no schema migration was needed.
- The renderer can save an active serial session, display and reopen saved profiles, and export/import them through saved-folder JSON bundle v6. Bundle versions 1â€“5 remain accepted with their prior supported protocol sets.
- When a saved COM port is missing, the dialog keeps that path unavailable and disables Connect. It does not silently substitute another port; the user must explicitly select a currently listed port.
- Added ADR-0020, security/architecture/spec/feature-matrix updates, storage/bundle/unit tests, and Windows E2E for save, folder export, import into another profile, restart persistence, settings restore, mock reconnect, and the absent-port safeguard.
- Final validation: typecheck passed; lint and import boundaries passed; focused serial/catalog/bundle unit tests passed 21/21; Windows build passed; focused serial Playwright tests passed 2/2; `git diff --check` passed. Build emits the existing >500 kB renderer chunk advisory. No physical device was opened.
- Independent Standards and Spec re-reviews passed after addressing stale security documentation, adding absent-port E2E, and centralizing serial configuration equality.
- Commit `171d078` was pushed on `dev-1`, merged into `main` with regular merge commit `7c915f4`, and verified remotely.

### Remaining work

- Product is **not finished**. Continue from current `docs/IMPLEMENTATION-PLAN.md` and `docs/FEATURE-MATRIX.md`; preserve honest partial states.
- Serial acceptance still lacks physical-device interoperability, hot-unplug hardware validation and Windows driver-signature review. F-016 also remains partial for FTPS interoperability.
- The user-requested terminal readability, Bash, saved-folder export/persistence, tab close/context actions, SFTP/FTP/Telnet and other protocol work is implemented to the documented partial/verified status in the feature matrix. P-30 remains partial for full shell-aware/zsh syntax highlighting; current ANSI contrast and keyword decoration evidence does not equal shell grammar highlighting.
- Next: inspect the most valuable open requirement and its ADR/tests, choose the next independent slice, read its relevant installed skill before edits, implement incrementally on `dev-1`, run only essential type/unit/Windows E2E/smoke checks, get Standards and Spec reviews, commit/push, merge to `main` with history preserved, verify remote refs and return to `dev-1`.

## Resume update ï¿½ WP-09E disconnect follow-up promoted (2026-10-25)

- Confirmed the serial read-error regression commit `ea755060b3b7f57e9f3455e488449a0681040d37` is on `origin/dev-1`.
- Confirmed regular merge commit `0e96f853ba333cee2baf76388a50f3c40ba10088` is on `origin/main`; `origin/HEAD` points to `origin/main`.
- Returned to `dev-1`; the only untracked file is this `session-context.md`.
- Focused serial/broker unit tests passed 30/30, typecheck and lint/import-boundary checks passed, and `git diff --check` passed before promotion. The test exercises a binding-level read error and explicit reconnect, not physical device unplug.
- Product is still not finished. Next work: inspect remaining planned/partial requirements, choose a small independent vertical slice, read relevant skill instructions, implement and validate, obtain code review, push `dev-1`, merge to `main` with history preserved, verify remote refs, and return to `dev-1`.

## Resume update -- WP-03E opt-in automatic saved sessions (2026-10-25)

- Added version-3 workbench preference `autoSaveSessions`, disabled by default. Workbench settings expose an opt-in checkbox; legacy v1/v2 preferences migrate with saving disabled.
- Added typed `session.remember` through preload, main broker, application session catalog and SQLite storage worker. The main broker checks the persisted setting before allowing catalog writes. The SQLite implementation normalizes definitions, deduplicates by protocol and endpoint/options, updates recency and preserves existing names/folders/favorites.
- Successful direct local terminal, direct SSH, SFTP, Telnet, FTP/FTPS and serial connections can be remembered. Startup's default PowerShell, gateway-routed SSH and external RDP/VNC are excluded. Credentials, keys and terminal text are not stored.
- Updated architecture, security, user guide, implementation plan and feature matrix; added ADR-0021 and WP-03E results. P-13 is now marked VERIFIED with combined acceptance evidence; F-004/P-38 remain open for 1,000-definition Windows acceptance.
- Validation on Windows x64: typecheck and lint/import boundaries passed; focused unit suite passed 67/67; native/renderer build and Electron setup passed; focused opt-in/dedup/restart Electron E2E passed 1/1 after review fixes. Vite reports the existing renderer chunk-size advisory (>500 kB). UI screenshot is `test-results/auto-save-session-settings.png`.
- Review initially found the local terminal path did not require `running`, and renderer preference-load timing could skip saves. Fixed in `af4e51e` by requiring local `running` and making the broker's persisted preference authoritative. Both issues were re-reviewed and confirmed fixed; no hard standards/spec findings remain. A possible duplicated running-check smell was left as a non-blocking judgement call because protocol payloads differ.
- Local `dev-1` commits: `8796223` feature, `af4e51e` review fix, `988ead1` review evidence. They are ahead of origin by three commits at the time of this note and have not yet been pushed/merged.
- `session-context.md` remains untracked and must not be committed.
- Promoted WP-03E with regular merge commit `0ae6c2602dc7333447d60dd2e3ae7b711e096696`; `git ls-remote` confirmed `origin/dev-1=988ead1e39f8feed9ee5f8168079a72b5e9fe3db` and `origin/main=0ae6c2602dc7333447d60dd2e3ae7b711e096696`. Fetched refs and returned workspace to `dev-1`.
- Continuing on `dev-1` with the next gap: F-004/P-38 Windows acceptance for 1,000 saved session definitions. Do not commit this context file.

## Resume update -- WP-07H N-002 Electron review follow-up (2026-10-25)

The user explicitly said to continue until the ultimate product goal is complete or manually paused. Continue autonomously on `dev-1`, reviewing each phase, pushing it, merging into `main` with a regular merge commit, verifying remote refs, and returning to `dev-1`. This handoff file is user-requested and remains untracked; never commit it.

### Current state

- Workspace: `E:\This is my year\MultiRemoteTerminal`.
- Current branch: `dev-1`, based on promoted WP-07G (`d7298e2`).
- `origin/dev-1`: `d7298e2129b576b09678cf17b3823b1f2b6e498b`.
- `origin/main`: `eac8a8dc7d64411ccedaae509d358207738df5e1`; `origin/HEAD` points to `origin/main`.
- WP-07G was reviewed (Spec and Standards passed; independent Electron audit had no high/critical issue), pushed to `dev-1`, merged to `main` and verified. The merge commit is `eac8a8d`.
- Current WP-07H implementation/doc changes are uncommitted and are under Spec and Standards review. Ignore this context file in reviews/commits.

### WP-07H work completed so far

- Independent N-002 review found no high/critical Electron-boundary issue. It recorded unsigned artifacts as a medium release gap, and two ungated E2E delay flags as a low issue.
- Added `apps/desktop/src/main/e2e-test-hooks.ts` to require `!app.isPackaged`, `MRT_E2E=1`, and an exact CLI flag. Wired both terminal-open and session-create delay hooks and the transfer-path hook to this guard.
- Updated the two intentional foundation E2Es to opt in explicitly with `MRT_E2E=1`.
- First added packaged regression test and ran it against the prior artifact; it failed as expected because the session-save operation did not complete within eight seconds when the delay flags were passed.
- Added focused unit coverage (2/2 pass) and an installed NSIS ASAR tamper scenario that changes an embedded SHA-256 integrity hash and checks the process exits. Package smoke also passes both E2E flags to the installed build and verifies a saved session is created.
- Validation: typecheck passed; lint/import boundaries passed; focused saved-session timeout E2E passed (1/1); full `corepack pnpm package:win:smoke` passed (4/4), including ASAR tamper and both package launch paths. The package is still unsigned; no publisher certificate is configured.
- Updated `docs/SECURITY.md`, `docs/FEATURE-MATRIX.md`, `docs/IMPLEMENTATION-PLAN.md`, and added `docs/results/WP-07H-n002-electron-review-follow-up-2026-10-25.md`. N-002/P-32/M4 remain partial; malicious terminal-output privilege-injection acceptance and valid signatures remain open. Windows 10, native credential dialog/live SSH, OS-wide offline and broader crash/startup coverage remain open.

### Immediate next steps

1. Wait for WP-07H Spec and Standards reviews. Fix hard findings, run the necessary focused checks, and obtain follow-up review if the reviewed code changes.
2. Commit/push WP-07H on `dev-1`; verify with `git ls-remote`; merge `dev-1` into `main` using a regular merge commit; push and verify; return to `dev-1`.
3. Continue with N-002 hostile terminal-output privilege-injection test, then examine remaining M4 acceptance gaps in `docs/FEATURE-MATRIX.md`, `docs/IMPLEMENTATION-PLAN.md`, and `docs/SECURITY.md`. Do not mark N-002/M4/P-32 complete until the documented gates pass.
4. Keep this file untracked and out of every commit.
## Resume update -- WP-07I promoted; WP-07J in review (2026-10-25)

- WP-07I hostile SSH output acceptance is complete. Focused loopback SSH E2E and CSP/Electron-policy E2E passed 1/1 each. Spec review's initial low label mismatch was fixed and follow-up approved; Standards review found no actionable issue.
- WP-07I commit `6bd52d7` was pushed to `dev-1`, merged to `main` with regular merge commit `703d547`, remotely verified, and the workspace returned to `dev-1`.
- Current `origin/dev-1` is `6bd52d7ab996455bcd2d2661c7a956afbf8cbc0a`; `origin/main` is `703d54759f1b517789e7d765b0fc3071c9f34a3d`; `origin/HEAD` remains `origin/main`.
- WP-07J is an uncommitted N-001 lost-SSH recovery acceptance slice. A Windows loopback E2E approves first-use host trust, authenticates a password session through the test-only provider, saves a credential-free profile, resets the accepted fixture TCP socket, verifies failed/UNAVAILABLE state, then explicitly reopens the saved profile and receives new shell output. Focused E2E passed 1/1; typecheck and lint/import-boundary passed. A graceful `ssh2` client end() correctly produced `exited`; test now uses `Socket.resetAndDestroy()` to model abrupt link loss. No production code changed in WP-07J.
- Updated SPEC/FEATURE-MATRIX to track F-003/P-03 as PARTIAL; key/agent auth and disposable OpenSSH interoperability remain open. N-001 remains partial because Windows locked-vault E2E is still open; separate existing E2Es cover ConPTY-worker crash and SFTP edit conflict.
- WP-07J Spec/Standards reviews are pending. Ignore this untracked handoff file in reviews and commits.
- Next: finish review and promote WP-07J, then implement a focused Windows locked-vault recovery E2E and continue remaining M4 gates. Keep `session-context.md` untracked.
## Resume update -- WP-07J promoted; WP-07K completed locally (2026-10-25)

- WP-07J SSH transport-loss recovery was reviewed and promoted. `origin/dev-1` is `2dce8438ed4efcbd89515fa5714c9ed946272892`; `origin/main` is regular merge commit `80df0709991d43d0196cb70a4cfbff97398391fe`; remote refs/default branch were verified and workspace returned to `dev-1`.
- WP-07K adds a Windows E2E of actual Electron `safeStorage`: store/resolve a random secret, emit the registered synthetic `powerMonitor` `lock-screen` event, assert the vault rejects resolution with `locked`, explicitly unlock through the guarded main-process test probe, resolve again, and ensure plaintext is absent from `credentials.json`.
- Test probe is enabled only when unpackaged, `MRT_E2E=1`, and `--mrt-e2e-vault-probe` is present; it is main-process-only and not exposed to preload/renderer.
- Updated `docs/IMPLEMENTATION-PLAN.md`, `docs/FEATURE-MATRIX.md`, `docs/SPEC-001-MultiRemoteTerminal.md`, `docs/SECURITY.md` and added WP-07K results. N-001/F-010/P-29 remain partial: the E2E event is synthetic, the unlock is test-only, saved credentials are not wired to the vault, and physical session-lock, user-facing vault management, master-password and full plaintext-exclusion checks remain open.
- Windows x64 validation passed: `corepack pnpm build` (existing Vite >500 kB advisory), focused Playwright `--grep "session-lock event"` 1/1, `corepack pnpm typecheck`, `corepack pnpm lint` including import-boundary checks, and `git diff --check`. Initial E2E attempt used a stale build; rebuilt and reran successfully.
- Current changes are staged for review/commit. `session-context.md` remains untracked and must not be committed. After review, fix findings, commit and push WP-07K to `dev-1`, verify remote refs, merge into `main` with regular merge history, verify, return to `dev-1`, then continue with the next open requirement. The user said to continue until the product is complete or manually paused.
### WP-07K promotion and next slice

- WP-07K Spec and Standards reviews passed. Spec found no missing or incorrect WP-07K behavior. Standards found no hard violations and noted a small duplicated credential-reference validation smell; the result record documents why it remains local in the two-call test-only probe.
- Committed WP-07K as `64ac95d` plus review disposition `604ee86`; pushed `dev-1` and verified `origin/dev-1=604ee86c1feedc53b6bf4233be0203bf51e68c58`.
- Merged `dev-1` into `main` with regular merge commit `1a33350c2327232adf8bfbcd76cb3d53607d1604`; pushed and verified `origin/main` and remote symbolic `HEAD` both point to main. Returned to `dev-1`.
- Next slice: add a Windows E2E for the real Electron safeStorage vault persisting a test credential across application restart, using the existing guarded main probe. Keep security/N-001/F-010/P-29 partial for remaining user-flow, physical session-lock and full plaintext-exclusion gaps.
- `session-context.md` remains untracked and is excluded from commits.
### WP-07L local progress (not yet reviewed or promoted)

- Added a Windows E2E for real Electron safeStorage persistence: write a random test credential, confirm no plaintext in credentials.json, close the app, relaunch on the same temporary user profile, resolve the same credential, and recheck the file.
- Added shared E2E launch/state-wait helpers used by WP-07K and WP-07L. No production source changed in this slice.
- Updated SPEC, SECURITY, FEATURE-MATRIX, IMPLEMENTATION-PLAN and added `docs/results/WP-07L-vault-restart-2026-10-25.md`. The security checklist now separately marks same-profile app-process restart and vault-file plaintext check as passed; DB/log/export/IPC exclusion, physical lock, master password, profile migration and OS-account-change behavior remain open.
- Validation on Windows x64: focused combined Playwright test for safeStorage/session-lock passed 2/2; `corepack pnpm typecheck`, `corepack pnpm lint` including import boundaries, and `git diff --check` passed. Reused the already-built WP-07K main process because this slice changed tests/docs only.
- Current diff is ready to stage and review; do not commit this session-context file.
### WP-07L review and promotion

- Spec review approved the same-profile restart and vault-file checks, and asked to stop attributing restart-only behavior to N-001. The result record now says WP-07L covers F-010/P-29 persistence and complements WP-07K, which tests lock/unlock behavior.
- Standards review found no documented-standard violations; it noted duplicated main-process probe lookup/missing-probe guards in separate serialized `app.evaluate` callbacks. The result record tracks why the small test-harness duplication remains rather than adding a generalized dispatch layer.
- WP-07L commit `6896faa` plus review-disposition commit `a74650c` were pushed to `dev-1`, regular-merged into `main` (`ddfb7bc`), pushed, and remotely verified. `git ls-remote --symref` confirmed `HEAD` points to `main`; workspace returned to `dev-1`.
- `origin/dev-1=a74650cbf3389a6cff8517e7d9df80e0457c2f58`; `origin/main=ddfb7bc7ff8b442d16e1f8e7cf5101ca957941a9`.
- Next: continue M4/security review from unchecked items in `docs/SECURITY.md` and requirements matrix, prioritize an independently verifiable slice, and keep this context file untracked.
### WP-07M local security-evidence progress (not yet reviewed or promoted)

- Re-ran `node --test tests/unit/host-trust.test.ts tests/unit/ssh-terminals.test.ts`: 22/22 passed, including changed-host-key detection/blocking, non-secret warning and a conflicting key not replacing trusted material.
- Re-ran the Windows `SSH saved-profile jump routes` Playwright E2E: 1/1 passed for one- and two-gateway paths, independent trust decisions and cleanup.
- Checked the corresponding narrow N-002 security checklist item and added WP-07M result/plan entry. F-003/P-03 and F-011/P-22 remain partial due open key/agent/OpenSSH and routing/interoperability scope.
- Current changes are docs/evidence only on `dev-1`; source test evidence was already present and passed. `session-context.md` remains untracked.
### WP-07M promoted; SFTP security evidence collected (2026-10-25)

- Re-ran host trust/controller unit suites: 22/22 passed. The SSH saved-profile one-/two-gateway Windows E2E passed 1/1.
- Updated the security checklist narrowly for the unit changed-host-key blocker plus gateway E2E. Spec review required clarifying that the separate host-key-rotation E2E from the threat table remains open and keeping packaged native credential prompting listed as an F-003/P-03 gap. Standards review asked to verify the recorded commands; root ran both and reviewer cleared the issue. Both axes approved.
- WP-07M commits were `38f15ef`, `707407e`, and review record `8597b9f`, pushed to `dev-1`, merged to `main` with regular merge commit `3f162535fb67fba5dfa01637f134985698db0110`, remotely verified; default `HEAD` still points to `main`; returned to `dev-1`.
- `origin/dev-1=8597b9fba7ec3a172419d18da712d21430a48baa`; `origin/main=3f162535fb67fba5dfa01637f134985698db0110`.
- Next slice WP-07N: finish targeted evidence for SFTP path traversal, cancellation, symlink and overwrite. Unit tests passed 15/15 (`remote-files.test.ts`, `sftp-file-transfers.test.ts`); Windows loopback SFTP E2E passed 1/1. Preserve open limitations for 100 MB transfer, network loss and broader server interop.
- Keep this file untracked and out of commits.
### WP-07N SFTP security gate recorded locally (not yet reviewed or promoted)

- Targeted commands already passed before the docs update: `node --test tests/unit/remote-files.test.ts tests/unit/sftp-file-transfers.test.ts` 15/15; Windows `corepack pnpm exec playwright test tests/e2e/foundation.test.ts --grep "SFTP sessions verify trust and transfers" --reporter=line` 1/1.
- Updated SECURITY checklist and implementation plan; added WP-07N evidence covering traversal, cancellation cleanup, symlink rejection, collision/overwrite and actual loopback transfer bytes. Large-file throughput, network-loss cleanup and broad server interop remain open; F-005/P-14 remain partial.
- Documentation-only changes are in the worktree on `dev-1`; run `git diff --check`, commit only the docs/result files, get Spec and Standards reviews, push, regular-merge main and verify. Keep `session-context.md` untracked.
### WP-07N promoted; WP-07O SSH forwarding evidence collected (2026-10-25)

- WP-07N reviews passed. The Spec reviewer confirmed the checklist evidence is scoped to the unit traversal/cancel/symlink/overwrite tests and actual loopback transfer E2E. Standards found no violations or smells.
- WP-07N commits `1b5de79` and `47617aa` were pushed to `dev-1`, merged with regular merge commit `6bcd9311c89a81bf9354893c19b50517ff1dfd9d`, pushed and remotely verified. `origin/HEAD` remains main; returned to `dev-1`.
- `origin/dev-1=47617aa36d851008c33a55e5bacf41f09a229130`; `origin/main=6bcd9311c89a81bf9354893c19b50517ff1dfd9d`.
- Next WP-07O candidate: N-002 local/remote/dynamic SSH forwarding policy checklist. Before any docs update, targeted tests already passed: `node --test tests/unit/ssh-tunnels.test.ts tests/unit/ssh-transport-provider.test.ts` 31/31 and Windows Playwright `--grep "saved SSH profiles start loopback forwards"` 1/1. The E2E covers local loopback, remote loopback request and GatewayPorts warning, dynamic SOCKS5 domain CONNECT, exact payload relay, stop/restart cleanup. Keep non-loopback policy, public binds, UDP/BIND, local-process access and broader SSH interop limitations open.
- Keep `session-context.md` untracked.
## WP-07O - SSH forwarding security evidence (2026-10-25)

- Continued on `dev-1`; before work, `origin/dev-1` was `47617aa36d851008c33a55e5bacf41f09a229130`, `origin/main` was `6bcd9311c89a81bf9354893c19b50517ff1dfd9d`, and `origin/HEAD` pointed to `main`.
- Re-ran `node --test tests/unit/ssh-tunnels.test.ts tests/unit/ssh-transport-provider.test.ts`: 31/31 passed.
- Re-ran `corepack pnpm exec playwright test tests/e2e/foundation.test.ts --grep "saved SSH profiles start loopback forwards" --reporter=line`: 1/1 passed on Windows. The case verifies local/remote/dynamic loopback forwarding, relay, warning, no-shell behavior, shutdown cleanup and stopped tunnel restoration.
- Added result record `docs/results/WP-07O-ssh-forwarding-security-acceptance-2026-10-25.md`; checked the matching forwarding test item in `docs/SECURITY.md`; recorded WP-07O in `docs/IMPLEMENTATION-PLAN.md`. Feature statuses remain partial for public bind consent, remote GatewayPorts policy, SOCKS UDP/BIND/auth and wider interoperability.
- `git diff --check` passed before review. Awaiting independent Spec and Standards reviews, then commit/push `dev-1`, merge to `main` with history, verify remote refs, and return to `dev-1`.
- Keep this file untracked and never include it in commits.
## WP-07O promotion complete (2026-10-25)

- Spec and Standards reviews of `47617aa..043eccf` found no findings, standard violations, baseline smells or evidence overstatement. Review outcomes are recorded in the WP-07O result.
- WP-07O evidence commits: `ad31642` (test evidence), `043eccf` (20-tunnel coverage detail), `deee3b9` (review outcome).
- Pushed `dev-1`; verified remote `origin/dev-1=deee3b9e62202757d44c60915927f0fb85f77ea4`.
- Merged `origin/dev-1` into `main` with a no-ff merge and pushed; verified `origin/main=012139b729d21d9aefef0ecda573ca40f6d42f22` and `origin/HEAD` points to `main`.
- Returning to `dev-1` to continue the next independent security slice. Preserve `session-context.md` as untracked; do not commit it.
## WP-07P - Credential boundary acceptance (in progress, 2026-10-25)

- On `dev-1` based on current `origin/main=012139b729d21d9aefef0ecda573ca40f6d42f22`; `origin/dev-1=deee3b9e62202757d44c60915927f0fb85f77ea4` before WP-07P commit.
- Added a Windows SSH credential canary E2E that verifies successful auth, absent canary in renderer UI and renderer/main console, credential-free SQLite profile and exported folder JSON, and no canary in any user-data file after shutdown.
- Added an explicit SSH controller assertion that the password is absent from session result and host-trust challenge. Existing focused IPC/broker/catalog/bundle/controller suites pass 75/75.
- Windows SSH canary E2E passed 1/1; existing FTP credential E2E passed 1/1 and confirms no credential in page or saved DB row.
- `corepack pnpm typecheck` passed. Targeted ESLint for changed tests passed. `git diff --check` passed.
- Security gate stays unchecked for all credential flows; main-to-utility-worker authentication IPC intentionally includes credential data, native prompt and other protocol evidence remain open.
- Await Spec/Standards review of fixed range from `origin/main` after commit; then push `dev-1`, merge no-ff into `main`, verify remote, return to `dev-1`.
- Keep `session-context.md` untracked and never commit it.
## WP-07P promotion complete (2026-10-25)

- Final Spec/Standards review of `012139b..54744af` passed with no findings. Main-console canary assertion runs after app shutdown.
- `dev-1` evidence commits `0ae901f` (credential boundary checks), `54744af` (post-shutdown console check), `3d91c2d` (review record).
- Pushed `origin/dev-1=3d91c2dd6297c08fd82e34d60683c63e76e86949` and verified via `git ls-remote`.
- Merged to `main` with no-ff history, pushed, and verified `origin/main=1f2cc1304f5f9f42bfd8c03a8f12870e12e3a0bd`; `origin/HEAD` still points to `main`.
- Return to `dev-1` and proceed with the next open release concern: SECURITY.md currently still says hostile SSH terminal-output privilege-injection evidence is missing, although WP-07I has accepted scoped evidence. Correct that stale wording, then continue into user-facing vault/saved-credential integration per ADR-0003 and F-010.
- Preserve `session-context.md` untracked; do not commit.
## WP-07Q - Security release-gate wording correction (in progress)

- On `dev-1` at `3d91c2d` after WP-07P promotion, with `origin/main=1f2cc1304f5f9f42bfd8c03a8f12870e12e3a0bd`.
- Updated `docs/SECURITY.md` to credit the bounded WP-07I hostile SSH-output test and retain broader privilege-injection/security packaging gates as open. Added matching implementation-plan and result records; no feature status changed.
- `git diff --check` passed. Documentation only; no tests rerun.
- Next: commit; review full range from origin/main; push dev-1; merge no-ff to main; verify remote; return to dev-1. Then design and implement the unfinished F-010 user-facing credential vault integration according to ADR-0003.
- Keep this session context file untracked and never commit.
## WP-07Q promotion complete (2026-10-25)

- Spec/Standards review of `1f2cc130..c0886eb` passed with no findings; result record updated in `2e9c33c`.
- Pushed `origin/dev-1=2e9c33ce94cc6cea194bb7834c701f95948aed79` and merged no-ff to main.
- Verified `origin/main=dc4acc7f4a1b49380b5fcb5e1b376dfa69ef97df` and `origin/HEAD` points to main.
- Continue user-facing credential-vault work on `dev-1` according to ADR-0003 and F-010. Security gate remains open; next design must keep plaintext in main/utility worker only and omit credential references from exports.
- Keep `session-context.md` untracked and never commit.
## WP-07R checkpoint â€” 2026-10-25

- Implemented saved SSH credential save/replace/forget, exact saved-profile endpoint resolution, Windows `safeStorage` lock/unlock Settings controls, private SQLite-worker credential references, compare-and-set reference updates, replacement cleanup, and one retry when a profile reference changes during a connect.
- Added focused tests for reference races and updated F-010/P-29, security and implementation-plan evidence. F-010/P-29 remain partial: optional master-password mode, physical Windows session-lock, account/profile migration, and other credential protocols are still open.
- Validation: 79/79 focused unit tests; 2/2 focused Windows loopback E2Es; typecheck, lint/import-boundary check, Windows x64 build and `git diff --check` passed. Build emitted the existing large renderer chunk warning.
- Fixed a Playwright strict-mode failure by filtering the success alert by its text. An earlier `ECONNRESET` did not reproduce in the isolated test.
- Commit `c54064f5c855bdc3e13f8531cbe05baa006a65c9` was pushed to `origin/dev-1` and verified with `git ls-remote`. `origin/main` remains `dc4acc7f4a1b49380b5fcb5e1b376dfa69ef97df`; default branch is `main`.
- Independent Spec and Standards reviewers are reviewing `origin/main...HEAD`; their results are pending. Next: resolve any Important findings, record review, merge dev-1 into main with `--no-ff`, push and verify both refs, return to dev-1, then continue the remaining security/product phases. Do not commit `session-context.md`.
## WP-07R promotion â€” 2026-10-26

- Independent Spec and Standards reviews completed against the candidate range. The Spec reviewer confirmed the same-user malware limitation is disclosed and saved-SSH messaging no longer says â€œsaved securelyâ€; no other mismatch/scope creep was found. F-010/P-29 remain partial for master-password mode and remaining platform acceptance.
- The Standards reviewer confirmed the ambiguous method name was fixed (`forgetSshCredential`) and duplicate storage-error mapping was centralized; no remaining documented-standard breach or smell was found.
- Review findings were committed in `319304b`; review evidence was recorded in `cd9763b`.
- Promoted to `main` with no-fast-forward merge `b6fee00c203893851d72254ad02cd7b19d7c06c0`, pushed and verified. Remote default remains `main`; remote refs: `main=b6fee00`, `dev-1=cd9763b`.
- Returned the worktree to `dev-1`. `session-context.md` is still the only untracked file and must not be committed.
- Validation for WP-07R: 79/79 focused unit tests, 2/2 focused Windows loopback E2Es, typecheck, lint/import-boundary checks, Windows x64 build, and `git diff --check` passed. The build reported the existing large-renderer chunk warning. During one debugging run, TypeScript/E2E collided with concurrent build output; rerunning sequentially passed. The intermittent Playwright `ECONNRESET` also stopped reproducing; a final uninstrumented two-test run passed.
- Next documented F-010/P-29 gap: optional master-password vault mode. `libsodium-wrappers-sumo@0.8.4` is already pinned and reviewed in `docs/dependencies/WP-02.md`; follow ADR-0003's exact Argon2id/XChaCha profile, dedicated bounded derivation utility process, failure cooldown, lock-generation, and atomic vault-conversion requirements. Physical Windows lock/resume, profile/account migration and non-SSH credential coverage remain later acceptance gaps. Continue with a separately validated/committed `WP-07S` phase on `dev-1`.
## WP-07S - Optional master-password vault (review in progress, 2026-10-26)

- Implemented optional master-password protection for saved SSH credentials using version-2 vault documents, fixed Argon2id 1.3 profile (opslimit 2, 64 MiB, 16-byte salt, 32-byte key) and XChaCha20-Poly1305-IETF per-entry envelopes with authenticated version/profile/reference metadata.
- Added a one-shot Electron utility process for KDF work, 30-second timeout, lock/abort termination, stale-key zeroing, locked-after-restart semantics, persisted exponential cooldown, atomic conversion with staged ciphertext verification, main-process native prompt flows, Settings controls, and explicit reset.
- Reset clears SQLite credential references while preserving session definitions. Added explicit partial-error reporting and status refresh if vault deletion succeeds but SQLite cleanup fails; stale refs are detached on profile resolution.
- Updated ADR-0003, ARCHITECTURE, SECURITY, SPEC, FEATURE-MATRIX, IMPLEMENTATION-PLAN and docs/results/WP-07S-master-password-vault-2026-10-26.md. F-010/P-29 remain PARTIAL for physical Windows session lock/resume, profile/account migration, other protocol credential flows and broader security acceptance.
- Validation on Windows x64 / Node 24.14.1 / Electron 45: focused vault/credential suite 95/95; typecheck, lint/import-boundaries and Windows build passed; the Windows KDF/UI E2E passed 1/1 (convert, restart locked, unlock, lock, explicit reset); git diff --check passed. Existing Vite large-renderer-chunk warning remains.
- Settings screenshot: test-results/master-password-vault-settings.png (locked master-password state).
- Commit 6ed32434042620a2456c482c3f4c406abcbdad14 pushed and confirmed on origin/dev-1; review fixed point origin/main=b6fee00c203893851d72254ad02cd7b19d7c06c0. Spec and Standards reviewers are pending. After review, fix findings if needed, record review, no-ff merge to main, push and verify, return to dev-1, then continue the next open vertical slice. Do not commit this context file.

## WP-07S promotion complete; WP-07T review in progress (2026-10-26)

- WP-07S Spec re-review confirmed the derived-key lock-race finding was fixed; Standards found no hard breach and tracked two non-blocking cleanup judgements (repeated vault-mode branches, repeated prompt-result mapping).
- WP-07S commits: 6ed3243 implementation, 0f1c1be key-buffer race fix with red/green regression tests, 013b9b9 review record. Promoted to main with no-ff merge 539a1a4ce6652785e12da71dbd60f5d4b34aedbc; pushed and remotely verified. origin/main=539a1a4; origin/dev-1=013b9b9; origin/HEAD points to main. Returned to dev-1.
- WP-07T adds Windows E2E copying only encrypted credentials.json to a distinct userData path under the same Windows account. It verifies locked startup, blocked pre-unlock resolution, explicit unlock and secret resolution. This does not verify full userData, cross-account or DPAPI migration.
- WP-07T validations: Windows E2E 1/1 specific test and combined master-vault E2Es 2/2; typecheck and lint/import-boundary passed; git diff --check passed. No runtime/dependency changes.
- WP-07T commit 4039341 pushed to origin/dev-1. Independent Spec/Standards review against origin/main 539a1a4 is pending. After review, record outcome, push, no-ff merge to main, verify refs and return to dev-1. Continue to next remaining acceptance gap.
- Preserve session-context.md as untracked; never commit it.

## Pause update - WP-08D review follow-up (2026-10-26)

The user asked to pause all work and record the current state. Stop implementation, validation, commits, pushes, merges, and other project actions until the user explicitly resumes. This context file is untracked and must not be committed.

### Current repository state

- Workspace: `E:\This is my year\MultiRemoteTerminal`.
- Current branch: `dev-1`.
- Current committed HEAD: `334bfe3 fix: share local editor shutdown promise`.
- Recent local WP-08D commits: `f7a629a feat: add bounded local text editor (WP-08D)`, `69bd378 fix: await local editor worker shutdown`, and `334bfe3 fix: share local editor shutdown promise`.
- Dirty tracked files: `apps/desktop/src/renderer/LocalTextEditorDialog.tsx`, `apps/desktop/src/renderer/RemoteTextEditorDialog.tsx`, and `apps/desktop/src/renderer/text-editor-format.ts`.
- Untracked files: `apps/desktop/src/renderer/text-editor-errors.ts` and this `session-context.md`.
- No source or documentation edits were made in the pause turn. The renderer changes listed above are pending review fixes already present when the pause request arrived.
- The last known remote baseline before WP-08D was `origin/main=9bb7df1ffe91df359a390ae9a0ff6db35358d4f7` and `origin/dev-1=d3a423391a5b233c810d5f87b798433c7a5a966b`. Remote refs have not been checked since local WP-08D work began; fetch and verify before any push or merge after resume.

### WP-08D implementation already committed

- Added bounded local text editing after native file selection. Main keeps the absolute path behind a UUID selection; renderer receives only the handle, basename and bounded UTF-8 content.
- File I/O runs in a one-shot Electron utility worker. It accepts regular UTF-8 files up to 512 KiB, rejects NUL and invalid UTF-8, checks identity and SHA-256 revision, stages a sibling file and uses no-replace hard-link commit/restore behavior.
- Save, reload and close are explicit; drafts survive revision conflicts; dirty-draft discard requires confirmation. Selected file paths/drafts are not persisted or logged.
- Shutdown cleanup now awaits the utility worker. `closeAll` callers share one shutdown promise.
- Known limitations recorded so far: Windows ACL preservation is unverified; filesystems without hard-link support fail closed; forced worker termination during replacement can leave `.partial`/`.backup` recovery files.
- Main files changed/added by the committed slice include domain/application local editor modules, worker protocol/provider/host, typed IPC contracts/preload/broker wiring, renderer UI, tests, ADR-0022, and architecture/spec/feature-matrix/implementation-plan documentation. See the WP-08D commits for the exact file list.

### Current uncommitted reviewer follow-up

- Added `text-editor-errors.ts`, a shared local/remote editor error-code-to-message map, replacing duplicated error cascades in both dialogs.
- Added `hasMixedLineEndings` and `lineEndingLabel` in `text-editor-format.ts`.
- Both local and remote editor dialogs now display an accessible note that mixed line endings normalize to the first detected style when saving. This policy follows ADR-0017 for remote editing and makes the behavior visible.
- These uncommitted renderer changes have not been typechecked, linted, built, unit tested, or E2E tested yet.

### Review findings and disposition still required

Independent Spec and Standards reviews were run against an earlier WP-08D head (`69bd378`), not the current `334bfe3` plus dirty changes.

- Standards: `docs/SECURITY.md` does not document local editing although AGENTS.md requires security docs to track behavior. Add a dedicated local-editing section describing selection/path boundary, worker, limits, revision checks, staged replacement, no persistence/logging, shutdown cleanup and recovery/ACL/hard-link limits. Update the remote editor section's stale claim that local editing is not implemented.
- Standards: duplicated local/remote error mapping. The shared `text-editor-errors.ts` change is intended to fix this but remains unvalidated and uncommitted.
- Spec: mixed line endings were silently normalized to first style. The new accessible note addresses this only after it is tested/documented. Update ADR-0022, architecture/plan/results and add mixed-ending assertions to the relevant E2E(s).
- Spec: the Windows local editor E2E uses the guarded `--mrt-e2e-local-text-file=...` hook and does not exercise Electron's actual native file picker. Document this evidence limit accurately. The controller unit test covers picker cancellation; native selection/cancel still lacks UI automation evidence.
- Get fresh independent Standards and Spec reviews after all fixes, against a freshly fetched merge-base/current range. Record both review outcomes in the result document; fix material findings before promotion.

### Validation evidence and limits

The following passed before the latest dirty renderer changes:

- `node --test tests/unit/local-text-editor.test.ts tests/unit/local-text-file-provider.test.ts tests/unit/broker.test.ts`: 32 passed, 0 failed.
- `corepack pnpm typecheck`: passed.
- `corepack pnpm lint`: passed, including import-boundary checks.
- `corepack pnpm build`: passed on Windows x64; Vite emitted the existing renderer chunk-size warning.
- `corepack pnpm setup:electron`: passed.
- `corepack pnpm exec playwright test tests/e2e/foundation.test.ts -g "Windows local text editor"`: 1 passed before the latest dirty UI edits. It uses the test-only selected-file path hook, not the native OS dialog.
- `git diff --check`: passed before the latest dirty patch.

Re-run focused validation after resuming and after completing the EOL test/docs updates. Respect the user's preference for essential tests only; do not run the entire broad suite without a need.

### Next steps after explicit resume

1. Recheck `git status --short --branch`, the current branch, and local/remote refs. Preserve all dirty files and never stage `session-context.md`.
2. Finish the mixed-line-ending behavior coverage, including an E2E assertion that the accessible note appears and the saved file uses the disclosed first style. Keep the native-picker automation limitation explicit.
3. Update `docs/SECURITY.md`, `docs/adr/ADR-0022-local-text-editing.md`, `docs/results/WP-08D-local-text-editor-2026-10-26.md`, and relevant architecture/implementation-plan/feature-matrix wording. Correct the result record so it does not claim the E2E used the real native picker.
4. Run focused unit tests, typecheck, lint, build, the local-editor Windows E2E, and `git diff --check` on the exact final source. Record actual output and limitations.
5. Commit the source/docs/tests on `dev-1` in reviewable phases, excluding this context file. Request fresh independent Standards and Spec reviews, fix material issues, and record dispositions.
6. Fetch/verify remote state, push `dev-1` only after review, verify with `git ls-remote`, merge into `main` with a normal no-fast-forward merge, push and verify `main`/default branch, then return to `dev-1`.
7. Resume the next documented product/release slice. The overall application is not finished; keep partial acceptance states honest and continue until the user pauses again or the complete documented definition of done is met.


## Resume update - WP-08E syntax profiles (2026-10-26)

The user resumed the paused goal. Continue autonomously on dev-1; do not stop unless the user pauses. This file remains untracked and must never be committed.

### Current branch and remote state

- Workspace: E:\This is my year\MultiRemoteTerminal; current branch dev-1.
- WP-08D was promoted earlier in this session; its merge commit is 994b943ae4e15d1730c736a4081c9308f572051e.
- After git fetch origin, GitHub reported origin/HEAD -> main, origin/main=994b943..., and origin/dev-1=994b943....
- Current local dev-1 includes WP-08E commits d6b4163 (implementation), ee337f4 (accurate bound wording and remote E2E), and 374c9ff (bounded malformed shell expansion scanning). No WP-08E push or merge has happened yet.
- Do not stage this context file. Before push, fetch and verify remote refs again.

### WP-08E implementation

- Added a pure domain lexical tokenizer for Shell and JSON text, with Auto/Plain/Shell/JSON selection shared by the local and SFTP text editors.
- The textarea remains the input/accessibility surface; the color preview is aria-hidden and renders source slices as JSX text. No package or file-content mutation was added.
- Preview limits are 64,000 UTF-16 code units and 4,096 tokens. Shell expansion scanning is forward-only; a malformed ${... stops at the next $ rather than searching the remaining file repeatedly.
- Profile inference covers .sh, .bash, .zsh, .ksh, and .json. This does not complete P-30 terminal shell grammar or zsh terminal integration.
- Docs added/updated: ADR-0023, WP-08E results, architecture, security, feature matrix, implementation plan, spec.

### Validation and diagnosis

- node --test tests/unit/text-syntax.test.ts: 6 passed after fix. Tests cover auto-profile choice, Shell/JSON token categories, code-unit/token limits, malformed nested-variable recovery, and timing scaling.
- corepack pnpm typecheck: passed; corepack pnpm lint: passed including import-boundary checks; corepack pnpm build: passed on Windows x64, renderer bundle 925.00 kB minified with Vite's existing >500 kB advisory.
- Focused Electron E2E: corepack pnpm exec playwright test tests/e2e/foundation.test.ts --grep "local text editor auto-detects shell syntax|SFTP sessions verify trust" --reporter=line: 2 passed. Local editor covers profiles/unchanged bytes/scroll; loopback SFTP editor opens remote.zsh and verifies remote basename detection and Shell tokens.
- git diff --check: passed.
- Standards review initially found the ${...} suffix search. Before the fix, the red regression run measured 64,000 code units at 58.9 ms vs 16,000 at 5.5 ms; malformed outer expansion swallowed a later valid ${HOME} token. After replacing indexOf with the bounded forward scan, all six focused unit tests pass.

### Review and next actions

- Final two-axis review of base 994b943 through current 374c9ff is pending. Prior Spec review found no issues; Standards follow-ups on copy and remote coverage were fixed, then its final pass identified the performance issue now fixed.
- After final Spec and Standards re-review: update the result record with final verdicts, validate git diff --check, commit that review record, push dev-1, verify with git ls-remote, merge to local main using --no-ff, push/verify main and default HEAD, and return to dev-1.
- Continue with the open P-30 terminal shell grammar/readability gap and remaining documented product/release requirements. The app is not finished; do not mark overall release gates complete without required Windows acceptance.
### WP-08E final promotion (2026-10-26)

- Final post-fix Spec and Standards reviews found no findings. The final HEAD check confirmed only the review-result documentation commit followed the already-reviewed source range.
- Pushed WP-08E commits to origin/dev-1 and verified the remote hash before promotion.
- Created no-fast-forward promotion merge `10a288753bca028bede77e45f9302d75702bb39b` on main and pushed it. Verified origin/HEAD points to main and both origin/main and origin/dev-1 equal `10a288753bca028bede77e45f9302d75702bb39b`.
- Fast-forwarded and pushed dev-1 to the same merge commit. Returned to dev-1; only session-context.md is untracked.
- Next slice: continue the open P-30 terminal syntax/readability work, then keep resolving remaining spec and Windows release acceptance gaps.
## WP-01G terminal shell prompt coloring (2026-10-26)

- Resumed on `dev-1` at `10a2887` after WP-08E promotion. Added opt-in, default-off shell token coloring on the active xterm prompt row for local/SSH/Telnet panes, using the shared Shell tokenizer. Serial is excluded. Preference schema moved from v3 to v4; schemas v1-v3 migrate with shell coloring disabled.
- Kept rendering transient and bounded: common prompt endings `$`, `#`, `%`, `>`; current physical row only; 2,048 UTF-16 code-unit extraction cap; at most 64 decorations per refresh. No shell hooks, protocol commands, terminal byte rewriting, command logging or persistence.
- Added ADR-0024 and updated architecture, security, implementation plan, feature matrix, and WP-01G acceptance results. P-30 remains PARTIAL. Dedicated UI E2E covers local Git Bash only; SSH/Telnet share the pane path but remain unverified by dedicated WP-01G E2E.
- Review initially found missing cleanup assertions and duplicated xterm row extraction. Follow-up added idempotent marker disposal coverage, a Ctrl+C E2E assertion, anchor clearing when disabled, and one shared bounded row extraction helper. Final Spec review found no blockers; final Standards review found no documented-standard breaches or remaining smell findings.
- Validation on Windows x64 / Node 24.14.1: focused unit suite 17/17; focused Electron E2Es 2/2; `corepack pnpm typecheck`, `corepack pnpm lint`, `corepack pnpm build`, and `git diff --check` passed. Build emitted the existing Vite >500 kB warning (928.18 kB minified / 254.33 kB gzip). Screenshot `test-results/bash-shell-syntax-prompt.png` visually inspected.
- Commits on `dev-1`: `a528fce` implementation; `ed6528e` acceptance docs; `5c74e64` cleanup/test follow-up; `c15cc3d` review evidence; `6fb23b6` independent review record. No generated `session-context.md` content was staged.
- Promoted by merge commit `c3cffc11500abdb04d85ef36ccdac366c9837f6c`. Verified `origin/HEAD -> main`, `origin/main` and `origin/dev-1` all at `c3cffc1`; returned to `dev-1`.

Resumed work on 2026-10-26 (Windows, dev-1)

WP-05E follow-up and review
- Starting refs: dev-1 at f6f8e7c, origin/main and origin/dev-1 at c3cffc1. session-context.md stayed untracked.
- Read repository start brief, SPEC-001, ARCHITECTURE, SECURITY, FEATURE-MATRIX, IMPLEMENTATION-PLAN, GLOSSARY, WP-05E result, ADR-0008, ADR-0025, plus code-review, requesting-code-review and diagnosing-bugs skills.
- Fixed review findings: busy/failed/cancelled drop batches and queue completion now discard unused context-bound handles; bridge projects exact payload fields; preparing copy names the dropped file; P-15 remains PARTIAL because the real Explorer drag gesture is not verified.
- Fixed a deferred-registration race: preload event listeners acknowledge only an active pane matching session/protocol/folder, and preload discards successful registrations when no pane accepts them. Main discard still checks sender/session/protocol/directory.
- Added bridge serialization and deferred-registration tests; updated architecture, security, ADR, plan, feature matrix and WP-05E result evidence.
- Regression was reproduced twice: node --test --test-name-pattern "preload discard sends only context fields" tests/unit/bridge.test.ts failed because success-event fields ok/result made exact IPC validation reject the command. After exact field projection it passed.
- Regression was reproduced: node --test --test-name-pattern "no live subscriber accepts" tests/unit/remote-file-drop.test.ts failed with no discard callback. After listener acknowledgement/cleanup it passed.
- Final validation passed: node --test tests/unit/bridge.test.ts tests/unit/remote-file-drop.test.ts tests/unit/broker.test.ts (66/66); corepack pnpm lint; corepack pnpm typecheck; corepack pnpm build (Windows x64, Vite bundle advisory 930.90 kB minified / 255.03 kB gzip); focused SFTP loopback Playwright E2E (1/1); git diff --check.
- Independent General review: ready to merge, no Critical/Important/Minor findings. Spec review: no remaining gaps/scope creep in this partial slice. Standards review: no documented breaches; one intentional duplicate exact-field projection at separate preload boundaries.
- Commit f6f8e7c: feat(sftp): add bounded file drag and drop uploads.
- Commit 875cd75: fix(sftp): reclaim unused dropped-file handles.
- Pushed dev-1; verified origin/dev-1 at 875cd75c6430855bd7015779b7c9238067d3e9fa.
- Promoted with a regular no-ff merge; pushed main merge ac5f4e834dacdaba73a9986d5d7e739bc3f93260. Verified origin/main at that SHA.
- Returned to dev-1. session-context.md remains untracked and must not be committed.

Current status / next slice
- WP-05E delivers bounded SFTP/FTP drop uploads but P-15 and F-005/P-14 remain PARTIAL pending actual Explorer gesture, multi-file/FTP E2E coverage, large-file/disconnect acceptance and interoperability/configuration work.
- Next candidate: extend focused Windows acceptance to verify serial multi-file SFTP drops and FTP drops using the E2E preload hook, then review/commit/push/promote the phase. Keep the actual OS gesture and other uncovered acceptance limits explicit.
## Resumed work: WP-05E multi-file SFTP and FTP acceptance (2026-10-26)
- Continued on dev-1 after the bounded drop-handle cleanup had been pushed and merged.
- Extended the focused Windows loopback SFTP E2E to drop two native-backed files, assert both remote payloads, and record staged upload start and commit order.
- Extended the FTP loopback E2E to enable the guarded drop hook, model server-assigned STOU filenames, delay the first STOU completion, assert serial start/commit order, and verify both uploaded byte payloads.
- Updated FEATURE-MATRIX.md, IMPLEMENTATION-PLAN.md, and the WP-05E evidence to report two-file serial coverage for SFTP and FTP. P-15 and F-005/P-14 remain PARTIAL because Explorer gesture behavior, large-file/disconnect behavior, configurability, and broader interoperability remain open.
- Validation: corepack pnpm typecheck passed; corepack pnpm lint passed; git diff --check passed; focused Playwright SFTP+FTP tests passed 2/2 on Windows.
- Independent Spec and Standards review agents reported no findings and marked the changes ready to merge.
- Commit baa8e437ae7228586393f86dccb1aeac848326d0 (test(sftp): verify multi-file SFTP and FTP drops) was pushed to origin/dev-1.
- Regular no-ff merge d450ea0618c3b31ee0d51df5cee6598e6b915c88 promoted the phase to main and was pushed. git ls-remote verified origin/dev-1 at baa8e43 and origin/main at d450ea0.
- Returned to dev-1. The working tree is clean except for this untracked session-context.md; do not commit this file.
- Next: select and implement the next independent, evidence-backed open acceptance slice from docs/IMPLEMENTATION-PLAN.md; continue review, validation, commit, push, merge to main, and return to dev-1.
## Resumed work: WP-05F representative transfer-size acceptance (2026-10-26)
- Started on dev-1 at baa8e43 with origin/main at d450ea0; session-context.md remained untracked.
- Added Windows loopback E2E acceptance for exact 1 KiB SFTP and FTP drops, a 100 MiB SFTP download, and a 100 MiB FTP upload/download. Validated sizes and SHA-256 digests; FTP upload hashes received network chunks. Large fixtures use deterministic per-1 MiB seeded pseudorandom data and setup is guarded by test cleanup.
- Updated SPEC-001, FEATURE-MATRIX, IMPLEMENTATION-PLAN, SECURITY, and the WP-05F result record. P-14, P-15, F-005 remain PARTIAL. Open: 100 MiB SFTP upload, throughput, network-loss recovery, actual Explorer gesture, configurable browser behavior, and broader interoperability.
- Review found and resolved: short-period fixture bytes; FTP upload hashing after buffer concatenation; fixture setup cleanup gaps; missing F-005 evidence link; stale security wording about all 100 MB transfers remaining open. Final General, Spec, and Standards reviews reported no remaining findings.
- Validation on Windows: corepack pnpm typecheck passed; corepack pnpm lint and import-boundary checks passed; git diff --check passed; focused SFTP/FTP Playwright E2Es passed 2/2.
- Commits on dev-1: 3564459, 604ac45, 225046c, 4dce1cd, c05e01d, a9abbb4, 3fb0f57, f59992d.
- Pushed dev-1 and verified origin/dev-1 at f59992da0091b13b0253892ac16bb4ea0d94f4a9. Promoted with no-ff merge 2289cff6e68e2358f66b9b6feb6ac81c2e6377bf and pushed main. Verified origin/main at 2289cff and that it contains origin/dev-1.
- Returned to dev-1. session-context.md remains untracked and must not be committed.
- Next candidate: implement a focused 100 MiB SFTP upload acceptance check, then address remaining WP-05 recovery/interoperability gates in independent reviewed phases.
## Resumed work: WP-05G 100 MiB SFTP drop-upload acceptance (2026-10-26)
- Started on dev-1 at f59992d after WP-05F promotion. Added a third, 100 MiB seeded file after two small files in the Windows loopback SFTP drop batch; asserted exact serial start/commit sequence and compared committed remote size and SHA-256 with the local source.
- The E2E fixture disables synthetic write latency only for the third drop upload, then restores the delay for later uploads. The E2E-only drop hook is still a simulated dispatch, not Explorer gesture automation.
- Updated SPEC-001, FEATURE-MATRIX, IMPLEMENTATION-PLAN, SECURITY, and added docs/results/WP-05G-sftp-large-upload-2026-10-26.md. P-14/P-15/F-005 remain PARTIAL; throughput, disconnect/recovery, native Explorer gesture, configurable browser behavior, and broader SFTP interoperability remain open.
- Validation: corepack pnpm typecheck passed; corepack pnpm lint and import-boundary checks passed; git diff --check passed; focused Windows SFTP E2E passed 1/1 in the final run (32.3 seconds).
- Reviews: General, Spec, and Standards found no remaining issues after a follow-up narrowed the fixture delay scope.
- Commits on dev-1: 4ad71d0 (test(sftp): verify 100 MiB drop upload), 6cb020d (test(sftp): scope large transfer fixture delay).
- Pushed and verified origin/dev-1 at 6cb020d54a141aeb0a58adc79110407871ef5cc4. Promoted by no-ff merge 6a428501640126d1ec872b06f9fa4f375263394b and pushed main. Verified origin/main at 6a42850 and that it contains origin/dev-1.
- Returned to dev-1. session-context.md remains untracked and must not be committed.
- Next: continue the WP-05 disconnect/recovery acceptance gap, then address native Explorer gesture and broader interoperability gates in separate reviewed phases.## WP-05H interrupted SFTP download recovery (2026-10-26)
- Resumed on dev-1 at 6cb020d. Added Windows loopback E2E coverage for a 4 MiB SFTP download interrupted after a partial local staging file exists. The test resets only the files-only SSH socket, checks destination and staging cleanup, explicitly reconnects, retries, and verifies final size and SHA-256.
- No production behavior changed; the existing reconnect flow handled the tested loss. Added bounded fixture-delay cancellation/resolution on SFTP close so delayed READ/WRITE/RENAME callbacks settle and do not reply after closure. The test requires an empty staging baseline and exactly one nonzero incomplete staging file before reset.
- Updated SPEC-001, FEATURE-MATRIX, IMPLEMENTATION-PLAN, SECURITY, ARCHITECTURE, and added docs/results/WP-05H-sftp-download-recovery-2026-10-26.md. Clarified that SFTP download recovery is covered while interrupted upload cleanup, FTP recovery, actual Explorer gestures, broad interoperability, and throughput remain open. P-14/P-15/F-005 remain PARTIAL.
- Review found and resolved: the original staging assertion could match a stale .mrt-* file; delayed fixture timers were not cancelled on close; architecture prose was stale about all transfer sizes and recovery being unverified. Final General, Spec, and Standards reviews reported no remaining findings.
- Validation on Windows: focused SFTP E2E passed 1/1 in 32.2 seconds; corepack pnpm typecheck passed; corepack pnpm lint and import-boundary checks passed; git diff --check passed.
- Commits on dev-1: 70d0a72 (test(sftp): verify interrupted download recovery), 92f6b8d (test(sftp): tighten interrupted recovery evidence).
- Pushed and verified origin/dev-1 at 92f6b8d88effa1cdd37d98fe64907132b4254054. Promoted with no-ff merge 56089aadf392ca060bebbc91ffb20dbe1a3ea523 and pushed main. Verified origin/main at 56089aa and that it contains origin/dev-1.
- Returned to dev-1. session-context.md remains untracked and must not be committed.
- Next: continue with remaining protocol recovery and interoperability gates according to IMPLEMENTATION-PLAN, keeping each slice evidence-based and statuses PARTIAL until acceptance passes.## WP-05I interrupted FTP download recovery (2026-10-26)
- Started on dev-1 at 92f6b8d. Extended the existing Windows FTP loopback E2E with a seeded 4 MiB file; the fixture sends a 1 MiB prefix and keeps its passive data socket open until the test resets both that socket and the matching FTP control socket.
- The test requires an empty local staging baseline, observes one nonzero/incomplete .mrt-* staging file before reset, waits for failure, verifies staging and destination cleanup, refreshes to expose explicit reconnect, reconnects to the saved FTP endpoint, retries, and compares size/SHA-256. The same E2E still verifies saved-profile reopen after application restart. No production behavior changed.
- Two early focused E2E failures were in test setup: adding the fixture at initial setup shifted a virtualization row-count assertion, so it was added only at the recovery point; the next assertion looked for a virtualized row before scrolling, so the list is scrolled before asserting. The final focused run passed.
- Review findings fixed: repeated .mrt-* scans now use one test-local helper; destination absence checks the directory listing rather than treating every stat error as ENOENT; the matching FTP control socket is captured alongside the interrupted data socket. Final General, Spec and Standards reviews found no remaining issues.
- The local testing\SKILL.md file is unavailable under C:\Users\Beasty\.agents\skills\; the configured skill directory has no testing skill. The installed diagnosing-bugs skill was used for the initial red E2E setup failures, and requesting-code-review/code-review were used for the final review.
- Updated SPEC-001, FEATURE-MATRIX, IMPLEMENTATION-PLAN, SECURITY, ARCHITECTURE, and added docs/results/WP-05I-ftp-download-recovery-2026-10-26.md. FTP download recovery is covered; SFTP/FTP interrupted-upload cleanup, FTPS certificates, sustained throughput, native Explorer gesture and broad interoperability remain open. F-005/P-10/P-14/P-15 stay PARTIAL.
- Validation: focused FTP Windows E2E passed 1/1 (8.5 seconds); corepack pnpm typecheck passed; corepack pnpm lint and import-boundary checks passed; git diff --check passed.
- Commits on dev-1: d10c96e (test(ftp): verify interrupted download recovery), c962769 (test(ftp): harden recovery fixture assertions).
- Pushed and verified origin/dev-1 at c962769ee7f44f4bcca45c389aaf41e8c73e64dc. Promoted with no-ff merge 6c5c4e32e30edd2b5d5d1ed5a31c8d4b2352e857 and pushed main. Verified origin/main at 6c5c4e3, that it contains origin/dev-1, and origin/HEAD points to main.
- Returned to dev-1. session-context.md remains untracked and must not be committed.
- Next: continue the remaining F-005 gates; choose the next evidence-backed slice from interrupted SFTP/FTP upload cleanup, sustained throughput, configurable browser behavior or interoperability.
## Resumed work: WP-05J configurable contextual SFTP pane (2026-10-26)
- Started on dev-1 at c962769 with origin/main at 6c5c4e3. Added persistent setting showSftpBrowserBesideSsh to Settings and workbench preferences schema v5; default is enabled, and v1-v4 records migrate with the contextual pane enabled.
- When disabled, running SSH terminals use the full layout. Standalone SFTP/FTP files-only sessions remain available. Review caught that unmounting the contextual pane would cancel an active transfer; fixed this by keeping it mounted but hidden and inactive, so it preserves transfer state and stops accepting file drops.
- Added domain and SQLite migration/persistence tests, plus a Windows loopback E2E that toggles off/on during a deliberately stalled SFTP download, confirms transfer state survives, cancels explicitly, verifies staging cleanup, and confirms standalone SFTP remains mounted.
- Updated SPEC-001, FEATURE-MATRIX, IMPLEMENTATION-PLAN, ARCHITECTURE, SECURITY, and added docs/results/WP-05J-configurable-sftp-side-pane-2026-10-26.md. F-005/P-14 remain PARTIAL for native Explorer drag automation, interrupted SFTP/FTP upload cleanup, sustained throughput and interoperability.
- Review: initial general review found and fixed pane-unmount transfer cancellation plus two evidence-record issues; follow-up general review reported no remaining findings. Spec review found no missing or incorrect behavior. Standards review found no violations; it noted an optional possible-duplication judgment call for the contextual-pane eligibility predicate in main.tsx and repeated legacy normalizer object construction.
- Validation on Windows: focused preference tests 13/13 passed; focused SFTP Windows loopback E2E 1/1 passed (32.0 seconds final run); corepack pnpm typecheck, lint/import-boundary, build, and git diff --check passed. Build emitted the existing Vite large-renderer-chunk advisory; native addon compilation succeeded. A parallel typecheck/build attempt raced on dist/types, then typecheck passed when rerun after build.
- Commits on dev-1: 77bdadb (feat(settings): configure contextual SFTP pane), 60bb484 (fix(sftp): preserve transfers when hiding pane).
- Pushed dev-1 and verified origin/dev-1 at 60bb48451eb5e5e69d213d381fc743d4f5f6b935. Promoted with no-ff merge ed74329a0401b09214c22e368cbec98fd23baa7e and pushed main. Verified origin/main at ed74329, it contains origin/dev-1, and origin/HEAD points to main.
- Returned to dev-1. session-context.md remains untracked and must not be committed.
- Next: continue remaining WP-05 upload-recovery gates, starting with interrupted SFTP upload cleanup/recovery, then FTP, native Explorer gesture and interoperability in separate evidence-backed slices.
## Resumed work: WP-05K interrupted SFTP upload recovery (2026-10-26)

- Started on `dev-1` at `60bb484` with `origin/main` at `ed74329`. Scope: SFTP interrupted-upload recovery only; FTP upload recovery and the remaining F-005/P-14 acceptance gates stay open.
- Reproduced the issue with a Windows loopback E2E: a 512 KiB upload was interrupted after a generated remote `.partial` stage had bytes, and the original implementation left the stage. A temporary E2E-only worker-liveness diagnostic showed the SSH utility worker was killed during cleanup. Root cause was ssh2 write-stream destruction waiting indefinitely for the remote handle-close callback after transport loss.
- Fixed streaming cancellation to settle independently of the hung ssh2 close callback. Upload cleanup is bounded to two seconds; only a stage opened exclusively by this worker can be recorded. Orphan records are private and in-memory, keyed by a SHA-256 digest of canonical route, usernames and accepted host-key fingerprints, excluding credentials. They are capped at 128 records, a seven-day TTL and four attempts per SFTP channel. Recovery validates the generated UUID `.partial` name and canonical parent before unlinking, and runs before the first SFTP operation after same-route reconnect.
- Unit coverage simulates a write-stream destroy callback that never returns, verifies scope isolation and retry cleanup, and verifies cancelled cleanup retains its record. Full suite passed **407/407**. Focused SSH-provider/cancellation tests passed **23/23**.
- Initial final typecheck raced against the build, which removes/recreates `dist/`; the concurrent and immediate retry attempts reported missing TypeScript project-reference outputs. Ran `corepack pnpm exec tsc -b --clean` then `corepack pnpm typecheck` serially; the clean typecheck passed. ESLint and boundary checks passed. The final Windows x64 build passed; Vite emitted the existing >500 kB renderer-chunk advisory. The final focused Windows SFTP loopback E2E passed **1/1** in 36.2 seconds, covering socket reset, reconnect cleanup before listing, explicit retry and exact-byte equality.
- Standards review initially found that the new request's wait for the disconnected upload ignored its cancellation signal. Added `awaitWithCancellation` and a regression proving the waiter cancels promptly while the earlier upload barrier remains active. The initial test run failed because the helper export did not yet exist; after implementation, the regression and provider suite passed. Both Spec and Standards reviewers re-reviewed the final three-commit diff and found no remaining issues.
- Updated `docs/SPEC-001-MultiRemoteTerminal.md`, `docs/ARCHITECTURE.md`, `docs/SECURITY.md`, `docs/FEATURE-MATRIX.md`, `docs/IMPLEMENTATION-PLAN.md`, ADR-0007 and the WP-05K evidence record. P-14/F-005 remain **PARTIAL**. Worker termination or app restart can leave a stage; FTP upload cleanup, native Explorer drag automation, sustained throughput and broader SFTP interoperability remain open.
- Commits on `dev-1`: `edb1800` (fix interrupted upload stages), `0deed0d` (record recovery limits in spec/architecture), and `b4d2cd9` (make the recovery barrier cancellable).
- Pushed and verified `origin/dev-1` at `b4d2cd9aeb0089bfd46a2e745664afa025b41cb7`. Promoted with no-fast-forward merge `3c9d7789ffc78c95bd4e8df829fd26a88d31a249`, pushed and verified `origin/main` at that hash. Returned to `dev-1`; worktree is clean except for this untracked file.
- Next: continue the next evidence-backed WP-05 gap, likely interrupted FTP upload cleanup, then remaining native Explorer gesture, sustained throughput and interoperability gates in separate reviewed phases. Keep the feature partial until its full documented exit criteria pass.

## Resumed work: WP-05L interrupted FTP upload recovery (2026-10-26)

- Resumed on dev-1 at b4d2cd9 after WP-05K. Added a Windows loopback FTP upload interruption case: the fixture resets both passive data and control sockets during a 100 MiB STOU upload, exposes the partial server file, and checks behavior after explicit reconnect.
- Before implementation, the new E2E failed because the partial server file remained after reconnect. Implemented a bounded in-memory recovery registry in the FTP transport provider. It stores only a validated stage path and expected byte count, scoped by a SHA-256 digest of endpoint host, port, TLS mode and username (no password). On same-scope reconnect, at most one record is checked with SIZE; DELE runs only when actual size is smaller than source size. Full-size/larger files are preserved as possibly committed. Records cap at 128, expire after seven days and stop after four attempts.
- A Standards review identified that FTP SIZE does not prove remote object identity: another client could replace the captured path with a smaller file before reconnect, and cleanup would delete that replacement. This limitation is explicitly recorded in SPEC, SECURITY, ARCHITECTURE, FEATURE-MATRIX, IMPLEMENTATION-PLAN, ADR-0006 and WP-05L results; a unit regression simulates it. F-005/P-14 remain PARTIAL. Worker termination/restart may leave residue, and FTP/FTPS interoperability, throughput and native Explorer gestures remain open.
- The E2E retries after cleanup and compares exact size and SHA-256. First test run failed at the residual-file assertion; final focused Windows FTP Playwright run passed 1/1 in 11.0 seconds. FTP focused unit tests passed 14/14; full unit suite passed 407/407 before the final same-path-race assertion was added, then focused FTP tests passed 14/14; lint/import-boundary, typecheck, Windows x64 build and git diff --check passed. Build reports the existing Vite chunk-size advisory.
- Independent Spec and Standards reviews found no remaining actionable findings after the path-identity limitation was documented and tested.
- Commit 843679d737b1df30d378a0ab3371b1e24fd0794c was pushed to origin/dev-1 and verified. Promoted with no-fast-forward merge 5abb9be3f29a83dbebb85c2e7a749479b9cc1ae8; pushed and verified origin/main at that SHA and confirmed it contains origin/dev-1.
- Returned to dev-1. This file remains untracked and must not be committed.

Next: continue an evidence-backed open slice. WP-05 still lacks actual Explorer gesture automation, throughput measurement, FTP/FTPS interoperability and cleanup after worker termination. Review the project plan/matrix before choosing; keep all incomplete requirements marked PARTIAL.

## Resumed work: WP-09F explicit FTPS certificate and data-channel acceptance (2026-10-26)

- Resumed on `dev-1` at `843679d` after WP-05L. The native Explorer gesture acceptance remains open: the installed computer-use skill could not connect to its Windows native pipe, so no gesture was claimed.
- Added `tests/e2e/ftps.test.ts` with an explicit FTPS loopback fixture. The first app run proves the untrusted certificate is rejected after `AUTH TLS`, before `USER`/`PASS`, and before the server records a completed TLS handshake. The second run explicitly trusts the local test CA through a development-only flag and completes a protected listing and upload with exact byte comparison.
- The test CA is passed only to the FTP utility worker and applied as per-connection TLS `ca` options. The production network-worker environment still excludes arbitrary parent variables; no production certificate-validation bypass was added. Test fixtures contain only the public root CA and a test-server PFX with a test-only passphrase in the E2E source; no CA private key is checked in.
- Updated the feature matrix, spec, implementation plan, security and architecture records; added `docs/results/WP-09F-ftps-tls-acceptance-2026-10-26.md`. P-10 and F-016 remain PARTIAL because public certificate chains, data-channel TLS session reuse and broad server interoperability are still unverified.
- Review initially found that any generic connection failure could satisfy the untrusted-certificate negative assertion. Added checks for `AUTH TLS`, no server-side `secure` completion and no account commands; Standards reviewer re-reviewed the fix and found no remaining issue. Spec review found no actionable findings.
- Validation passed: `corepack pnpm typecheck`; `corepack pnpm lint`; `corepack pnpm test` (408/408); Windows x64 `corepack pnpm build` (existing Vite chunk-size advisory); focused FTPS Playwright E2E (1/1); focused worker-environment unit suite (3/3); and staged `git diff --check`.
- Commit `a7b2740e1357b3983d055667400427e607d7c489` was pushed to `origin/dev-1`. Promoted with no-fast-forward merge `69e77533ae6fb679b156f1b19fca8827ad482644`; pushed and verified `origin/main` at that SHA, and verified it contains `origin/dev-1`.
- Returned to `dev-1`. `session-context.md` remains untracked and must not be committed.

Next: WP-09G should test whether FTPS data-channel TLS sessions are resumed from the authenticated control channel. Keep public-server interoperability, the Explorer gesture and other uncovered P-10/F-005 acceptance gates explicit.

## Resumed work: WP-10A read-only loopback TFTP (2026-10-26)

- Resumed on `dev-1` at `b33f2a1`. Read the existing project context and continued the WP-10 daemon slice.
- Implemented a domain port/status contract, application controller, supervised Electron utility worker, typed main/preload IPC, native folder selection held behind an opaque main-process token, trusted one-shot start gestures, and a local TFTP dialog with explicit folder/start/stop controls. The listener and transfer sockets bind to `127.0.0.1`; the service supports read-only octet RRQ for top-level regular files only, rejects WRQ/traversal/links, and caps files at 16 MiB. It uses built-in Node APIs; no package was added.
- UI and docs disclose that TFTP is unauthenticated and any local process can download top-level files in the selected folder while the server runs. The UI now shows the 16 MiB limit. The transfer handler returns ERROR 5 to unexpected transfer IDs without ending the transfer and ERROR 4 for malformed packets from the expected peer. Transfer startup awaits bind success, rejects on pre-listen errors/close, and awaits resource cleanup before propagating failure.
- Repeated Windows Playwright E2E runs received DATA block 1 but timed out before DATA block 2 after the client ACK. This also occurred with listener port 69, and a Python standard-library UDP loopback probe reproduced the missing ACK delivery. Windows Firewall profiles are enabled and the current profile reports `BlockInbound,AllowOutbound`; packet logging was disabled, so the firewall is not confirmed as the cause. No firewall rule or security policy was changed. RFC 1350 transfer TID behavior and loopback-only binding remain intact.
- `corepack pnpm typecheck`: passed. `corepack pnpm lint`: passed, including import boundaries. Focused unit suite: **99/99 passed**. `corepack pnpm build`: passed on Windows x64 with the existing Vite >500 kB renderer chunk warning. `git diff --check`: passed. The focused TFTP E2E fails at read block 2, so full transfer, active-stop, unauthorized-local-access and >360-second lifetime are unverified.
- Independent code, standards and spec reviews found the path/UI/worker boundaries sound; they prompted sync/async socket startup cleanup, TFTP ERROR 4/5 behavior and disclosure of the file-size cap. The startup cleanup and protocol responses were re-reviewed. All reviewers advise holding promotion until a full-transfer Windows E2E passes. Focused packet-state tests for the new error paths remain a follow-up.
- Updated SPEC, ARCHITECTURE, SECURITY, FEATURE-MATRIX, IMPLEMENTATION-PLAN, ADR-0026 and WP-10A results. P-20/F-022 remain **PARTIAL**; P-41 remains unverified. No claim of successful TFTP transfer is made.
- Committed `af68a9587f8c62287972424a715bb3e89d5d6783` (`feat(tftp): add partial loopback read-only server`) and pushed to `origin/dev-1`; `git ls-remote` verified `origin/dev-1` at that hash. `origin/main` remains `b2aa34d84dba72e4e8865de6a30a19fd49b725a1` and `origin/HEAD` still points to `main`. Did not merge because the essential transfer E2E fails and all reviewers recommend holding this partial feature from `main`.
- Returned on `dev-1`. This file remains untracked and must not be committed.

Next: isolate the Windows loopback ACK path under a permitted network policy without broadening listener exposure, add focused packet-state tests if they can be exercised independently, and require a successful full-transfer Windows E2E before merging WP-10A. Continue the next independent project slice on `dev-1` while keeping the TFTP acceptance gate visible.

## Resumed work: WP-10A TFTP initial-error TID correction (2026-10-26)

- Reproduced why `curl.exe` timed out on WRQ/traversal denials: an isolated Node UDP server sending ERROR 2 from its listener port was ignored, while sending the same response from a newly bound loopback transfer port was accepted. Per RFC 1350 initial TID behavior, changed `ReadOnlyTftpServer` to send initial-request errors from dedicated ephemeral loopback sockets. Concurrent responses are capped at eight and closed after send, on a two-second bound, or on service stop.
- Reworked the Windows E2E to preflight System32 `curl.exe` TFTP support and invoke it with `--disable` first, so `.curlrc` cannot change the test. The worker/network path now verifies WRQ and traversal return ERROR 2 (curl status 69 and expected message), explicit Stop releases the original listener port, restart succeeds, and application shutdown produces no reply and releases its listener port.
- The required full RRQ still fails: Windows curl receives DATA block 1 (512 bytes), then status 28 before block 2. A separate minimal Node loopback TFTP responder reproduces the missing ACK event outside Electron. The earlier Python stdlib probe has the same timeout. Packet capture via PktMon was not available to this non-elevated process (`Access is denied`); firewall profile is inbound-block, but no packet-filter evidence establishes causality. No firewall policy was changed, and no TFTP success claim is made.
- Validation: `corepack pnpm typecheck`, `corepack pnpm lint`/boundary checks, focused unit suite **99/99**, Windows x64 build, and `git diff --check` passed. The focused Windows Playwright E2E remains red only at the final status-0/full-byte RRQ assertion; preceding runtime rejection, stop/restart, shutdown and port-release assertions pass. Build retains the existing Vite large-renderer-chunk advisory.
- Reviews: Spec reviewer found no scope creep or incorrect TID behavior, and accepted the curl status/message as behavior-based regression evidence. Standards reviewer found no documented-standard violations; it noted only an optional possible-duplication judgement call for the test socket helpers. Code reviewer found no Critical issue, confirmed the explicit-stop probe, withdrew its initial direct-source-port assertion request after reviewing the pre-fix timeout/post-fix acceptance, and keeps the full RRQ gate blocking promotion.
- Commits: `c811bd13ae76a3b50b6c7f3a2632ddcd1f66e257` (`fix(tftp): send request errors from transfer IDs`) and `13d458161f14fe49e24b9b0b15f182b5273e29be` (`test(tftp): verify explicit stop releases listener`). Initial combined pushes were rejected with GitHub `Internal Server Error`; pushing the two commits separately then succeeded. `git ls-remote` verifies `origin/dev-1` at `13d458161f14fe49e24b9b0b15f182b5273e29be`, `origin/main` at `b2aa34d84dba72e4e8865de6a30a19fd49b725a1`, and `origin/HEAD` points to `main`. Do not merge while the RRQ gate fails.
- This file remains untracked and must not be committed.

## WP-01L PowerShell backtick continuation coloring (2026-10-27, review/promotion pending)

- Continued on `dev` from WP-01K. Added a pure-domain PowerShell input-preview API that returns only `commandExpected` and `previousTokenIsBareWord` when complete input ends in an unquoted odd trailing backtick run. Strings, here-strings, comments, even runs, trailing whitespace and truncated previews do not carry state.
- The renderer stores continuation state per terminal, keeps Shell and PowerShell state types separate, and carries PowerShell flags only to an exact visible `>>` prompt. Existing preference, buffer/row/decoration bounds, marker cleanup and serial exclusion remain; no submitted text is retained/logged/persisted or separately sent for highlighting.
- Added unit coverage for lexical state, token colors across the continuation, opaque suffixes, truncation and exact PowerShell `>>` prompt classification. Windows E2E now covers primary prompt colors, backtick continuation, parameter/variable colors at `>>`, and Ctrl+C cleanup.
- Diagnosis loop: the initial E2E repeatedly failed because it submitted Enter before ConPTY had echoed the entire fast-typed test line into xterm's parsed normal buffer. Tagged, temporary logs showed 12 code units ending before the final backtick; they were removed. The E2E now waits for visible full-line echo before Enter, matching the feature's parsed-buffer-only input contract; the clean run passes 1/1.
- Updated ARCHITECTURE, SECURITY, FEATURE-MATRIX, IMPLEMENTATION-PLAN, USER-GUIDE, ADR-0047 and results/WP-01L. P-30 stays PARTIAL; natural PowerShell continuation forms, quoted backticks, custom secondary prompt forms and full parsing remain unsupported. No dependencies added.
- Final Windows checks so far: domain/renderer unit tests 49/49; `corepack pnpm typecheck`; `corepack pnpm lint` including import boundaries; `corepack pnpm build` passed (existing Vite renderer advisory: 1,003.46 kB minified / 275.22 kB gzip); focused PowerShell E2E 1/1; `git diff --check` passed. Independent review/promotion not yet complete.
- Keep this `session-context.md` untracked and never stage/commit it. User's latest workflow authorizes continuing autonomously, committing/pushing the finished phase on `dev`, and merging reviewed changes into `main`.

Next: continue gathering evidence for the ACK path without widening the loopback bind or changing firewall policy, then choose the next independent open slice from the implementation plan. Keep F-022/P-20 partial and P-41 unverified until full transfer, active-stop, exposure and lifetime gates pass.


## WP-09G FTPS data-channel session resumption (2026-10-26)
- Resumed on dev-1 from WP-09F. The pinned basic-ftp 6.2.3 source supplies the stored TLS session to data sockets and records renewed session tickets; no production code or dependency change was required.
- Extended the existing Windows loopback FTPS E2E to record TLSSocket.isSessionReused() for every protected data-channel handshake and require at least two observed connections with all sessions reused. The listing/upload flow produced four protected connections and all four resumed.
- Updated SPEC-001, ARCHITECTURE, FEATURE-MATRIX, IMPLEMENTATION-PLAN, the basic-ftp dependency review, and WP-09F/WP-09G result notes. P-10/F-016 remain PARTIAL because public-server behavior, public CA chains/revocation, serial physical devices, and wider interoperability remain uncovered.
- Validation: focused FTPS Playwright E2E 1/1 passed; corepack pnpm typecheck passed; targeted ESLint and git diff --check passed. An initial too-strict assertion expected exactly two connections; the run showed four all reused, so acceptance now requires two or more and checks all observed results.
- Independent general reviewer approved; Standards and Spec reviewers found no issues. No test suite rerun was needed during review.
- Commit b33f2a11d214440fb778861965aea1325b2dab2e was pushed and verified on origin/dev-1. Promoted with no-fast-forward merge b2aa34d84dba72e4e8865de6a30a19fd49b725a; pushed and verified origin/main contains origin/dev-1 and origin/HEAD points to main. Returned to dev-1.
- session-context.md remains untracked and must not be committed.
- Next: WP-10 begins X11/XDMCP and local daemons; assess a narrow, security-reviewed server slice under the documented loopback-default and explicit-stop requirements.

## Resumed work: Git Bash Unicode and TFTP transfer follow-ups (2026-10-26)

- Resumed on `dev-1` at `13d458161f14fe49e24b9b0b15f182b5273e29be`, synced with `origin/dev-1`; `origin/main` remains at `b2aa34d84dba72e4e8865de6a30a19fd49b725a1`. The only pre-existing untracked file is this context file.
- WP-01E Bash regression probe: the Git Bash E2E was temporarily expanded to paste `Ð–é›ªðŸ™‚`; it failed with `Ð–é›ªï¿½`. Git Bash reported `LANG=C.UTF-8`, `LC_CTYPE=C.UTF-8`, and `locale charmap=UTF-8`. Direct `writeTerminal` input produced the same replacement; the shell's own `printf` output of ðŸ™‚ worked. A bracketed-paste probe, `MSYS=enable_pcon`, and input through Bash's non-Readline `read` builtin did not fix it. PowerShell's existing same-ConPTY supplementary-character E2E passes. Temporary diagnostics were removed and the tracked test file has no diff. No code change or claim of F-002 completion was made. Upstream reports of MSYS2/Cygwin supplementary-character handling are related evidence, not proof of this interactive input path's exact root cause.
- WP-10A TFTP diagnosis: a temporary native `node:dgram` E2E client against the app received DATA block 1, its ACK send callback succeeded, but it timed out waiting for DATA block 2. A standalone Node server/client probe on `127.0.0.1` reproduced this outside Electron: the client received data from the separately bound transfer socket and sent ACK 1 successfully, but the server socket received no message. The temporary test code was removed. Existing Windows Firewall profile is `BlockInbound,AllowOutbound`; packet-filter logs are unavailable. No firewall rules/policies, bind address, or RFC transfer-ID behavior were changed. Do not attribute causality to the firewall without evidence.
- Updated only WP-10A evidence in `docs/results/WP-10A-loopback-tftp-2026-10-26.md`, ADR-0026, `docs/IMPLEMENTATION-PLAN.md`, and `docs/FEATURE-MATRIX.md`. P-20/F-022 remain PARTIAL; P-41 remains unverified. `git diff --check` passed. No code tests were rerun after these documentation-only changes. The user-requested context file remains untracked and must not be committed.
- No commits or pushes were made for these two investigations. Current staged state must be rechecked before any new work; expected tracked diff is those four documentation files only, plus untracked `session-context.md`.

Next: commit/push the TFTP evidence update on `dev-1`, then continue with the next implementable WP-11 tool-discovery/management slice after reading the relevant requirements, architecture notes and local skills. Keep TFTP and Bash Unicode limitations explicit; do not merge to `main` until documented release gates pass.

## Resumed work: WP-11A local shell registry (2026-10-26)

- Started from `dev-1` at `8e330da` with `origin/dev-1` verified at that commit and `origin/main` at `b2aa34d`. The worktree initially contained only this untracked context file.
- Read the WP-11 requirements and relevant domain, workbench preference, SQLite, settings, command-palette, security, and local-terminal architecture. Applied local `codebase-design`, `frontend-design`, `diagnosing-bugs`, `ui-taste`, `web-design-guidelines`, `vercel-react-best-practices`, `requesting-code-review`, and `code-review` instructions. The web interface rules were fetched fresh from their configured guideline source. No external reference binary or new package was needed.
- Implemented WP-11A as a fixed registry of existing local shell IDs (PowerShell, cmd, Bash), a version-6 workbench-preference migration, Settings controls to show/hide shell palette actions, command-palette filtering, and matching offline help. This is UI visibility only: it accepts no executable paths and does not install, uninstall, or disable shell providers. P-21/P-37 are documented PARTIAL; F-023, WSL, toolpacks, and broader provider discovery remain open.
- Added focused domain validation and SQLite v5 migration tests, plus a Windows E2E that hides PowerShell, confirms its palette entry disappears, restarts the app, restores it, and launches the shell. The first E2E run failed on an ambiguous `role=status` locator, not application behavior; it was narrowed to the exact save-status text. Final focused E2E passes. The screenshot `test-results/local-shell-tools-settings.png` was visually inspected at 1164Ã—734 in the dark theme; it is generated locally and is not part of source control.
- Validation after the feature edits: `corepack pnpm typecheck` passed; `corepack pnpm lint` passed including boundary checks; focused workbench/SQLite tests 6/6 passed; `corepack pnpm build` passed on Windows x64 with existing Vite chunk-size advisory; focused Windows E2E passed 1/1; `git diff --check` passed.
- Updated `docs/FEATURE-MATRIX.md`, `docs/IMPLEMENTATION-PLAN.md`, `docs/SECURITY.md`, and added `docs/results/WP-11A-local-shell-tool-registry-2026-10-26.md`. `main` remains untouched. The WP-11A implementation/doc diff is not committed or pushed yet; latest inspected worktree is those tracked changes plus this untracked session-context file.

Next: finish the UI and security pass, request independent review plus Standards/Spec review of the WP-11A commit, address any important findings, then commit/push on `dev-1` and verify `git ls-remote`. Keep `session-context.md` untracked. Do not merge this partial slice to `main` while TFTP and other release acceptance gates remain open.

## WP-11A review fixes (2026-10-26)

- Committed the first implementation as `76d92573b4bb6cd09d7a8bcc4b3db82d53b9abae` (`feat(tools): add persisted local shell visibility registry`) on `dev-1`, not yet pushed.
- The independent Standards and general reviews found that `docs/ARCHITECTURE.md` still documented workbench schema v3 and said tool visibility was planned. Updated the canonical schema table to v6, described v1-v5 migration defaults, clarified the partial local-shell visibility feature, and updated the glossary.
- General review found a startup race: the renderer initialized shell visibility to all visible while persisted preferences loaded asynchronously. Added a test-only first-read delay (available only when unpackaged, `MRT_E2E=1`, and the dedicated CLI flag are present), wrote the E2E assertion first, and observed it fail because cmd appeared before saved preferences returned. Added a renderer readiness gate; the same E2E now verifies no shell actions before the read settles, cmd visibility afterward, PowerShell remaining hidden, then restoring it and opening one additional terminal tab.
- Updated WP-11A evidence, feature matrix, and implementation plan to record startup-gate behavior and the review corrections. The main branch remains untouched; existing TFTP/P-20 and broader release gates still block promotion.
- Final current-source checks: typecheck passed; full lint and import-boundary checks passed; focused workbench/SQLite tests 6/6 passed; Windows x64 build passed with the existing large-renderer chunk advisory; delayed-read focused Playwright E2E passed 1/1; `git diff --check` passed.
- Current work is unpushed: commit `76d9257` plus an uncommitted follow-up for the review fixes and this untracked context file. Re-run independent review of the combined diff before pushing. Keep `session-context.md` untracked.

Next: commit the review-fix follow-up, request fresh general and Standards/Spec review against `origin/dev-1`, resolve any important findings, push the combined WP-11A commits to `dev-1`, and verify the remote SHA. Do not merge to `main` while full release/acceptance gates remain open.

Correction after commit: the review-fix follow-up is committed as `1464a65cca7258d449a0388349c576a91132778f`. The combined WP-11A work is unpushed; `dev-1` is two commits ahead of `origin/dev-1` at `8e330da`, and `origin/main` remains `b2aa34d`. Fresh general and Standards/Spec reviews are running. Keep this context file untracked.

Next: finish reviews, resolve any remaining findings, push both WP-11A commits to `dev-1`, verify the remote SHA, and continue on `dev-1`. Do not merge to `main` while full release/acceptance gates remain open.


## Resumed WP-11A command-palette review fix (2026-10-26)

- Resumed from `dev-1` with the two WP-11A commits local and unpushed (`76d9257`, `1464a65`); `session-context.md` remains untracked. The original independent review had completed: Spec review found no overclaim, Standards review found no hard boundary breach (the test-only preference-delay seam was noted), and general review found an important selection-index race when shell actions are inserted at the top of the palette after preferences load.
- Changed palette selection from a numeric index to a `CommandName` ID. The palette pins its initial selected command ID, arrow keys and mouse hover update that ID, and Enter resolves the selected command after the list changes. Empty results are handled without indexing an undefined command.
- Extended the Windows delayed-preference E2E: before the preference response, it moves selection to ?Connect to SFTP files?; after local shell commands appear, it asserts SFTP remains selected, presses Enter, and verifies the SFTP dialog opens. It cancels the dialog before continuing the existing saved-visibility and PowerShell-launch checks.
- Corrected WP-11A plan wording for pending preference reads and default fallback after a read failure. Updated result evidence to describe command-ID selection and the regression assertion.
- Validation of current source: `corepack pnpm typecheck` passed; `corepack pnpm lint` and import boundaries passed; focused workbench preference/SQLite tests passed 6/6; `corepack pnpm build` passed on Windows x64 with the known large-renderer-chunk advisory; focused delayed-read Playwright E2E passed 1/1; `git diff --check` passed. The first typecheck attempt caught strict-index `undefined` errors in the new arrow-key handlers; optional ID access fixed them before the passing rerun.
- The follow-up diff currently contains only renderer selection handling, its E2E regression coverage, and WP-11A plan/result wording. It is not yet committed or pushed. Remote state must be fetched/verified before push. Do not stage or commit this context file. `main` is untouched, and promotion remains blocked by TFTP/full acceptance gates.

Next: complete a final diff review, commit the follow-up on `dev-1`, push the three WP-11A commits together, verify `origin/dev-1` with `git ls-remote`, and continue work on `dev-1`. Do not merge to `main` until the documented review and Windows acceptance gates are met.


- Follow-up review fix was committed as `330fbbc` (`fix(tools): preserve palette selection during preference load`) and pushed to `origin/dev-1`; `git ls-remote` verified SHA `330fbbce978f5fef91d3e7a5b7c61f26ed822d82`. `origin/main` remains `b2aa34d84dba72e4e8865de6a30a19fd49b725a1`. Local `dev-1` is synced. `session-context.md` remains the only untracked path and was not staged.
- Continuing to the next independent slice: inspect the WP-11 WSL/tool-provider requirements and current local shell boundaries; no implementation decision has been made yet.


## WP-01G prompt-glyph follow-up (2026-10-26)

- After pushing WP-11A, reviewed the open WP-01G partial for zsh-style terminal coloring. Added recognition for two common prompt glyphs (U+276F and U+279C) to the existing opt-in, explicit-keystroke, transient Shell-token coloring path. Updated the Settings help, Architecture, Feature Matrix, Implementation Plan, WP-01G evidence and ADR-0024. Full zsh grammar/theme support remains out of scope; P-30 remains PARTIAL.
- Added unit coverage for both prompt markers and changed the Git Bash Windows E2E to emit a U+276F prompt through Bash's ASCII ANSI-C escape, then verify `if`/`true` token colors. Direct Playwright keyboard typing of the Unicode marker was dropped by its keyboard layout; the ASCII escape fixture passed. Screenshot `test-results/bash-shell-syntax-prompt.png` was inspected and shows the glyph prompt and colors.
- Validation passed: typecheck; lint and import-boundary checks; 21 focused unit tests; Windows build (941.37 kB renderer chunk / 257.45 kB gzip, existing >500 kB advisory); both related Windows E2Es (2/2); `git diff --check`.
- Independent general, Standards and Spec reviewers checked the pinned range. General and Spec found no remaining issue. Standards' ADR wording conflict was fixed in a separate docs commit. A remaining process timing note said the glyph code commit preceded the ADR text update; assessed as non-blocking because the change is a small prompt-marker extension within the existing architecture, not a material architectural departure.
- Commits `2228d4a` (behavior/tests/evidence) and `2d4688e` (ADR correction) were pushed and `git ls-remote` verified `origin/dev-1=2d4688ef8e273908f70894f03ad2106f80b2261d`. `origin/main` remains `b2aa34d84dba72e4e8865de6a30a19fd49b725a1`; main was not modified. `session-context.md` is still untracked and was not committed.

## WSL capability assessment

- Read `docs/SKILLS-PLAYBOOK.md` and current local `codebase-design` and `frontend-design` skill files before assessing WP-11. Microsoft Learn documents `wsl --list --quiet` for installed distro names and `--distribution` for explicit distro selection; see https://learn.microsoft.com/en-us/windows/wsl/basic-commands. A real read-only query on this workstation returned only `docker-desktop`. No WSL launch was attempted because that is Docker-managed infrastructure, not a user distro. No WSL code change was made; implement only a user-selected, validated distribution flow with proper Windows E2E, or choose another independent open slice.

## Resumed work: WP-11B explicit WSL distribution terminals (2026-10-26)

- Resumed with `dev-1` at `2d4688e`, synced with `origin/dev-1`; `origin/main` remains `b2aa34d`. The current `AGENTS.md` says to use `dev`, while `docs/CODEX-START-HERE.md`, SPEC-001, the WP-11 plan, and prior explicit user workflow name `dev-1`. Remote heads currently contain only `dev-1` and `main`. Do not switch, create, or push a `dev` branch without reconciling this mismatch; current work remains on `dev-1` pending that decision.
- Read current `AGENTS.md`, CODEX start brief, spec, architecture, security, feature matrix, implementation plan, glossary, ADR-0027, and skills playbook. Applied `frontend-design`, `ui-taste`, `web-design-guidelines`, `vercel-react-best-practices`, `diagnosing-bugs`, and later `requesting-code-review`/`code-review` remain to be applied after final diff is ready. Fresh Web Interface Guidelines were fetched from the skill's official source. No dependency or REA binary work was needed.
- Implemented WP-11B: explicit bounded read-only WSL distribution discovery in the terminal utility worker; fixed absolute `wsl.exe` System32 path; exact `--distribution <name> --exec bash --login` argv; explicit chooser with no default selection; fresh list revalidation before PTY creation; cancellation and time/output bounds; typed preload/broker/worker path; persisted `shell: wsl` plus exact distro; session bundle v7 while accepting v1-v6; workbench preference schema v7 migration; WSL palette visibility by default.
- Added guarded unpackaged WSL fake-harness E2E. It verifies no initial selection, disabled primary action, Escape cancellation/focus restore, exact path and argv for `Debian Dev`, saved profile persistence across app restart, and reopen to the same target. It does not invoke WSL or start Docker-managed `docker-desktop`. Added focused worker discovery and provider tests, including stale distro rejection before PTY creation and bounded UTF-16LE output parsing; rejected unpaired Unicode surrogates.
- The first focused unit run found an outdated bundle idempotency count (7 expected vs 8 actual after adding the WSL fixture); assertion now expects 8. One subsequent test caught a bug in the new unpaired-surrogate validator (`NaN` from a terminal high surrogate passed comparisons); fixed by requiring a low-surrogate range match and verified.
- An initial WSL E2E run failed only because it searched for the exact accessible name `Command palette`, while the button name includes keyboard hint text. Changed to a prefix regex; final Windows Playwright run passed 1/1. The test writes screenshots `test-results/wsl-distribution-picker.png` and `test-results/wsl-distribution-terminal.png`; both were visually inspected at 1164Ã—734 dark theme.
- Current completed checks: typecheck passed after a sequential rerun (the parallel build/typecheck attempt raced on generated `dist/types` files); lint and static import boundaries passed; 133 focused WSL-related cross-layer unit tests passed; Windows x64 build/native system-directory bridge passed; `setup:electron` passed; targeted WSL Windows E2E passed 1/1 with Tab/Shift+Tab focus-boundary assertions; `git diff --check` passed. Vite keeps emitting the existing >500 KiB renderer chunk advisory.
- Updated `docs/FEATURE-MATRIX.md`, `docs/IMPLEMENTATION-PLAN.md`, and ADR-0027. Created `docs/results/WP-11B-wsl-distribution-terminals-2026-10-26.md`. P-02/P-21/F-023 remain PARTIAL because actual user-distro interoperability is not tested; the earlier host inventory found only Docker-managed `docker-desktop`.
- The implementation, E2E/test updates, ADR, result record, plan/matrix docs, and this `session-context.md` are currently uncommitted. Stage only tracked code/docs/test paths; keep `session-context.md` untracked. Next: rerun the final focused suite and checks, inspect the entire diff, request independent General plus Standards/Spec reviews, fix important findings, then commit/push only after resolving the `dev` vs `dev-1` policy mismatch. `main` remains untouched; do not merge this partial slice while release gates remain open.

### WP-11B commit and review follow-up

- Committed the WSL implementation and evidence as `0e3051c` (`feat(terminal): add explicit WSL distribution sessions`) on `dev-1`. The only untracked path remained this context file.
- Independent General, Standards, and Spec reviewers checked `2d4688e..0e3051c`. Standards and Spec found a compatibility bug: legacy bundle versions 1â€“5 could accept the new WSL record through the common validator, despite WSL support starting at v7. General found no other issue.
- Fixed the legacy validators to exclude WSL from v1â€“v6, added a regression covering each old bundle version, and documented the review follow-up. Committed as `1bd8e3d` (`fix(sessions): reject WSL entries in legacy bundles`).
- Follow-up validation: `corepack pnpm exec node --test tests/unit/session-folder-bundle.test.ts` passed 9/9; `corepack pnpm typecheck` passed. The previous WP-11B full validation remains recorded above (133 focused tests, lint, build, Electron setup, targeted Windows E2E 1/1). No live user-managed WSL distro was available, so acceptance stays partial.
- General, Standards, and Spec reviewers confirmed no remaining findings on `2d4688e..1bd8e3d` after the legacy-bundle fix.
- Local `dev-1` is two commits ahead of `origin/dev-1`; latest commit is `1bd8e3d`. A fresh pre-push `git ls-remote` is still required. `origin/main` remains `b2aa34d84dba72e4e8865de6a30a19fd49b725a1` and is unchanged. Keep this file untracked; do not merge WP-11B into `main` while real user-distro and broader release gates are open.

## Resumed work: WP-07U custom workbench logo (2026-10-26)

- Resumed from local `dev-1` at `1bd8e3d` after the WP-11B WSL review fixes. The current workspace `AGENTS.md` says to use `dev`, while older canonical docs/history say `dev-1`; I created local `dev` at the same commit without changing or deleting `dev-1`. Remote still has only `dev-1` and `main`; the first `git ls-remote --heads origin` found no `dev`. Local work is now on `dev`; push a new `origin/dev` only after review. Do not rewrite remote history.
- Implemented bounded PNG-only custom workbench logo selection, typed IPC, main-process validation, preference schema v8, restart persistence, Settings preview/reset, and docs. Initial commit: `65f853d` (`feat(settings): add bounded custom workbench logo`).
- Independent review found the preference IPC could bypass picker normalization by submitting a forged PNG data URL; it also noted an unclear previous-schema helper name. Applied `diagnosing-bugs`: wrote/reran the regression red first, then added strict domain PNG validation and a main-process preference gate that accepts only unchanged persisted data, reset-to-null, or the exact normalized image selected in the current run. Added broker regression coverage. Follow-up commit: `01241fc` (`fix(settings): authorize persisted custom logos`).
- Current acceptance remains honest: P-35 is PARTIAL because the Windows E2E uses the guarded picker hook. Native dialog interaction/cancellation could not be automated: the installed Computer Use skill's native pipe was unavailable after its documented recovery retries. No OS dialog interaction was claimed. F-009 also remains open because P-36 profile-script behavior is not implemented.
- Final WP-07U checks recorded: focused cross-layer unit set 113/113; typecheck and lint/import-boundaries passed; Windows x64 build passed with the existing Vite chunk-size advisory; targeted Windows Playwright E2E passed 1/1; `git diff --check` passed. The actual native-dialog acceptance gate is still partial.
- Final General, Standards and Spec reviews passed on `1bd8e3d..9c4e0f1`. They confirmed no remaining code/spec findings; the follow-up corrected Architecture's stale preferences schema table and added a WAL backup/restore test for schema v8. A Standards review of the first pass also identified that persistent schema changes require backup/restore per Architecture Â§11; this was handled before final review.
- Follow-up validation: focused custom-logo cross-layer suite passed **114/114**; `corepack pnpm typecheck`, `corepack pnpm lint`/import boundaries and `git diff --check` passed. Earlier Windows x64 build and guarded-picker E2E (1/1) still cover unchanged production code. Native Windows dialog interaction/cancellation remains unverified; P-35 remains PARTIAL.
- Commits: `65f853d` bounded custom logo, `01241fc` persisted-logo authorization, `9c4e0f1` schema documentation and backup/restore regression. `git push -u origin dev` succeeded; `git ls-remote --heads origin` verified `origin/dev=9c4e0f1a3973582ca744cd64a82d14969ccf7895`. Remote `dev-1` remains `2d4688ef8e273908f70894f03ad2106f80b2261d`; `main` is unchanged at `b2aa34d84dba72e4e8865de6a30a19fd49b725a1`. The remote printed a rename notice during push, but the refs confirmed `dev`, `dev-1`, and `main` coexist. No merge to main occurred because documented release gates remain open.
- `session-context.md` remains the only untracked file; never stage or commit it. Keep main unchanged while release gates (including P-35 native dialog, P-36, WSL user-distro interoperability and TFTP full-transfer E2E) remain open.

Next: see the current continuation state below; earlier next-step notes are historical. Do not merge partial work into `main`.

## Current continuation state â€” WP-07V (2026-10-26)

- Follow the user's branch answer and repository `AGENTS.md`: work on `dev`. At resume, `dev` and `origin/dev` were both `9c4e0f1`; remote `main` was `b2aa34d84dba72e4e8865de6a30a19fd49b725a1`. Do not merge to `main` while release gates remain open. The user selected `dev` in response to the branch clarification.
- WP-07V implements P-36 and the PowerShell profile-script portion of F-009. It stores an app-managed PowerShell script as bounded plain text in preferences schema v9, keeps startup at `-NoProfile`, and does not modify the normal `$PROFILE`. Settings preview returns exact saved text with a one-use, session-bound token. Running requires a fresh trusted Run action and is restricted to the same already-running local PowerShell session. Apply IPC carries only session and opaque preview IDs; scripts do not run during app startup or terminal creation. See ADR-0029.
- UI refinements block save/close during preview/apply, disable the editor during these operations, prevent apply while the field has unsaved edits, show a clearer expired-authorization message, disable spellcheck, and make the long script preview keyboard-scrollable. The Windows E2E activates Run with Enter and passes.
- Current code commits: `ec042c5 feat(settings): add guarded PowerShell profile script` and `df6dad4 fix(settings): prevent deceptive PowerShell profile previews`, on `dev`. Reviewers found bidi controls could disguise preview text, profile requests counted user activity twice, and the idle-prompt limitation needed explicit warning. The follow-up added red/green regressions, rejects control/bidi/Unicode line separators, records activity once after authorization, and warns users to run only at an idle PowerShell prompt.
- Follow-up validation: the focused cross-layer suite passed **93/93**; Windows Playwright E2E passed **1/1**; `corepack pnpm typecheck`, `corepack pnpm lint` (including import boundaries), `corepack pnpm build` for Windows x64, and `git diff --check` passed. The regression command first failed on both bidi acceptance and unauthorized activity accounting, then passed after the fix. The build retains the existing Vite large-chunk advisory.
- General, Standards and Spec reviews rechecked `9c4e0f1..df6dad4`: no remaining Critical/Important/Minor findings and no documented standards breaches. Standards noted a possible duplicated gesture-store pattern as a judgement-call smell; policies differ and the existing stores remain separate.
- `git push origin dev` succeeded. `git ls-remote --heads origin dev main` verified `origin/dev=df6dad40d60288f64dc517227725e3c9a71e6128`; `origin/main` remains unchanged at `b2aa34d84dba72e4e8865de6a30a19fd49b725a1`. Worktree is clean except this untracked, uncommitted `session-context.md` file. Do not merge to `main`.
- P-36 is documented VERIFIED for the app-managed workflow. F-009 remains incomplete; P-35 native picker interaction/cancellation and broader P-37 provider/tool controls are open. Product/release completion is not reached. Continue with the next independent open work package from `docs/IMPLEMENTATION-PLAN.md` after WP-07V review/push.


## Resumed work: WP-01E supplementary Unicode input follow-up (2026-10-26)

- Resumed on `dev` at `df6dad4`, tracking `origin/dev`; remote `main` remains `b2aa34d`. This matches the user's explicit branch answer and current AGENTS.md. Main was not changed.
- Read the project instructions/docs and relevant Bash/ConPTY ADR and evidence; read the installed diagnosing-bugs and codebase-design skills. The bug loop began with a Windows Git Bash E2E asserting exact clipboard paste text. It reproduced U+FFFD replacing U+1F642 after an exact clipboard read.
- Ranked and tested input-path hypotheses: MSYS pseudo-console setting, node-pty string vs UTF-8 Buffer write, direct typed bridge write, bracketed paste, Bash `--noediting`, and WinPTY for Bash. None was a safe fix; WinPTY also broke shell-generated emoji output, so system ConPTY was restored. Running the pasted command confirmed the replacement reaches Bash output, not only the visual echo. Microsoft docs specify UTF-8 ConPTY streams; MSYS2 terminal guidance warns about interactive compatibility when mixing MSYS and Windows console paths. The exact upstream component remains unconfirmed.
- Added a separate Playwright expected-failure test for supplementary clipboard input. Kept the existing full Bash acceptance E2E passing for BMP input, commands, resize, saved-session reopen and Ctrl+W. Updated FEATURE-MATRIX, IMPLEMENTATION-PLAN, the original WP-01E result, and added `docs/results/WP-01E-bash-supplementary-input-2026-10-26.md`. F-002 remains incomplete.
- Latest validation: Windows x64 build passed with existing Vite chunk advisory; `corepack pnpm exec playwright test tests/e2e/foundation.test.ts --grep "Git Bash"` passed 2/2 (the supplementary test was an expected failure); `corepack pnpm lint` including import-boundary checks passed; `corepack pnpm typecheck` passed; `git diff --check` passed.
- Current tracked diff is the test plus canonical plan/matrix and Bash evidence docs. The new result record is untracked and intended for the next commit. This file remains untracked and must not be committed. Independent review and commit/push to `dev` are pending. Verify refs with `git ls-remote`; do not merge partial work to `main`.
- Next: review the full diff, request General + Standards/Spec review for the evidence/test slice, handle any findings, commit and push to `dev`, verify the remote SHA, then continue with the next independent open work package. Do not claim full product completion; release gates remain open.


### WP-01E review, commit, and push follow-up

- The first independent Spec/Standards/General reviews found the expected-failure assertion too broad and cleanup incomplete. Fixed the regression to run the pasted command, wait for a marker absent from the echoed command, set expected-failure status only after observing U+FFFD in executed output, then assert the exact emoji output. Profile cleanup now runs after Electron launch failure and even if app shutdown rejects.
- Follow-up reviews: Spec found no remaining issue; General found no remaining findings; Standards found no hard breaches and noted possible duplicated Electron setup as a judgement-call smell, retained for test isolation.
- Final checks after the review fixes: `corepack pnpm exec playwright test tests/e2e/foundation.test.ts --grep 'Git Bash'` passed 2/2 (normal Bash E2E plus conditional expected failure); `corepack pnpm typecheck`, `corepack pnpm lint` with import boundaries, and `git diff --cached --check` passed. The prior Windows x64 build passed; production app code did not change in the final review fixes.
- Commit `0844de8` (`test(terminal): track Git Bash supplementary input failure`) was pushed to `origin/dev`. Fresh `git ls-remote --heads origin dev main` verified `origin/dev=0844de812cb901fe9a59dc147dd221c57ef07168`; `origin/main` remains `b2aa34d84dba72e4e8865de6a30a19fd49b725a1`. Worktree is clean except `session-context.md`; it remains untracked and uncommitted. No merge to `main` because F-002 and release gates remain open.
## Resumed work: WP-10A TFTP acceptance follow-up (2026-10-26)

### Branch and remote state

- Work continued on `dev`, per the user's latest branch choice and AGENTS.md.
- Final local/remote `dev` HEAD: `9366b1f164b42b83d966f04b26586f47ce75f9dc` (`test(tftp): retain filtered packet listener`).
- `git ls-remote --heads origin dev main` after push verified `origin/dev=9366b1f164b42b83d966f04b26586f47ce75f9dc` and `origin/main=b2aa34d84dba72e4e8865de6a30a19fd49b725a1`.
- Seven reviewed commits were pushed in normal fast-forward order: `4d1a42f`, `cd49023`, `67f88f8`, `18d9fc6`, `80fae0d`, `c745d52`, and `9366b1f`.
- Worktree is clean except for this untracked `session-context.md`; do not add or commit it. No merge to `main` was made because F-022/P-20 and release gates remain partial.

### WP-10A diagnosis and implementation evidence

- The earlier TFTP ACK timeout did not reproduce during this resumed audit. The original full-download Windows E2E passed 6/6 consecutive runs with `curl.exe` output byte-for-byte equal to the 1,024-byte fixture. The earlier Node/Python ACK failures remain historical observations; no root cause is established.
- Expanded `tests/e2e/tftp-server.test.ts` to verify exact-byte RRQ, WRQ/traversal errors, a 16 MiB + 1 byte rejection (TFTP ERROR 3), loopback transfer IDs distinct from the listener, active transfer stop before ACK 2, no packets through stop and a 1.5-second quiet period, and release/rebind of listener and transfer-ID ports.
- The capacity acceptance now sequentially opens eight active RRQs and withholds ACKs, then verifies the ninth receives a bounded `Server is busy` ERROR from its own loopback TID. It stops the server and rebinds all eight transfer ports. Pending-queue saturation is not separately tested.
- The test deliberately waits through the first transfer's retry interval while filtering unrelated TID packets before accepting the next slot. `receivePacket` uses a persistent listener so unmatched datagrams do not discard the listener; the listener is removed on match, error, or timeout.
- The E2E attempts to create a file symlink to an outside fixture. This account returns `EPERM`, so the test records an `environment-limit` annotation and skips only that request. Runtime symlink rejection remains unverified; no privilege, Developer Mode, or firewall changes were made.
- Cleanup uses nested `finally` blocks so temporary profile/folder removal still runs if Electron shutdown fails. Transfer failure diagnostics include partial stdout byte count.
- The final expanded Windows E2E passed 3/3 consecutive runs after the final listener fix. `corepack pnpm typecheck`, `corepack pnpm lint` (including import boundaries), and `git diff --check` passed. No production source changed in this slice, so the Windows build was not rerun.

### Reviews and documentation

- The General, Spec, and Standards review skills were run against the changed commits. Initial findings were fixed: retry-window flakiness, duplicate firewall text, stale F-022 acceptance summaries, untested active/size rejection, missing loopback/TID assertions, temp cleanup on shutdown failure, partial-byte diagnostics, duplicate-packet filtering, and busy-error TID checks.
- Final reviews found no blocking or remaining findings. They confirmed no completion overclaim and recommended keeping pending-queue saturation, symlink rejection, interoperability, machine-to-machine exposure/isolation, and >360-second lifetime visible as open.
- Updated `docs/SPEC-001-MultiRemoteTerminal.md`, `docs/SECURITY.md`, `docs/FEATURE-MATRIX.md`, `docs/IMPLEMENTATION-PLAN.md`, `docs/adr/ADR-0026-wp10a-loopback-tftp.md`, and `docs/results/WP-10A-loopback-tftp-2026-10-26.md`. F-022/P-20 remain PARTIAL; P-41 remains unverified. WP-10A covers TFTP only; NFS/Cron/helpers remain open.
- Effective `netsh advfirewall` policy is `BlockInbound,AllowOutbound` on all profiles and dropped-packet logging is disabled. No policy was changed; firewall responsibility for the earlier ACK timeout remains unknown.

### Next independent work

- Continue the open daemon acceptance work: verify TFTP lifetime beyond 360 seconds, assess a deterministic pending-queue saturation test, seek a Windows profile that permits file-symlink creation for runtime rejection, and continue broader interoperability/isolation assessment. Keep F-022/P-20/P-41 partial until their applicable gates pass.
- Then continue remaining independent planned work packages and requirements; do not merge partial work to `main`.

## TFTP lifetime acceptance completion (2026-10-26)

- The opt-in `MRT_TFTP_LIFETIME_ACCEPTANCE=1` Windows E2E now waits 360.5 seconds using monotonic `performance.now()`, confirms the listener remains running, transfers the fixture, and performs explicit stop/cleanup checks. Final long acceptance passed 1/1 in 6.1 minutes; prior standard TFTP E2E runs and typecheck/lint/import-boundary checks are recorded above.
- Follow-up General, Spec, and Standards review of the last corrections found no remaining findings. P-41 is verified for TFTP only. P-20/F-022 remain partial; pending-queue saturation, runtime symlink rejection, interoperability/isolation, and other daemon providers are open.
- Commit `b056bea` contains the opt-in runtime acceptance. Commit `b9c74fa` changes the elapsed timer to monotonic and clarifies that the remaining P-20 lifetime gap concerns other daemon providers. Both are pushed on `origin/dev`.
- Fresh remote verification: `origin/dev=b9c74fadab9d623798d2885c8c97542acee94f18`; `origin/main=b2aa34d84dba72e4e8865de6a30a19fd49b725a1`. `git fetch origin` completed; main was not changed. The only worktree item should be this untracked `session-context.md`; do not commit it.
- Next daemon task: assess whether the TFTP pending-transfer admission cap can be verified deterministically without a production-only timing hook; otherwise improve bounded-request behavior or continue another explicitly open acceptance item. Keep the project and P-20/F-022 partial until evidence supports wider completion.

## Resumed work: WP-10A pending-transfer admission (2026-10-26)

- Continued on `dev`. After the prior TFTP lifetime push, `origin/dev` was `b9c74fadab9d623798d2885c8c97542acee94f18`; remote `main` remains `b2aa34d84dba72e4e8865de6a30a19fd49b725a1`.
- Read the installed `reverse-engineer-anything` skill and its connection-recovery guide because the original task referenced the MobaXterm ZIP. No REA MCP tools or `rea` CLI are registered/installed in this environment, and the specified `C:\Users\Beasty\Downloads\MobaXterm_Portable_v26.5.zip` path does not exist here. No package was installed and no MobaXterm archive/runtime was inspected. Continue from repo documentation; REA investigation remains unavailable until the target/tooling is provided.
- Read `codebase-design` and added a narrow internal file-opener dependency to `ReadOnlyTftpServer`. The normal runtime still defaults to the existing safe `openRootFile` implementation. A real loopback UDP unit test gates eight unique pending file opens and verifies request nine receives `Server is busy`; it now also asserts the ninth request never enters the opener and bounds each wait at 2 seconds. Test cleanup releases gates, stops the server, closes the client and removes the temp folder.
- Updated `ARCHITECTURE.md`, `SPEC-001`, `SECURITY.md`, `FEATURE-MATRIX.md`, `IMPLEMENTATION-PLAN.md`, ADR-0026 and WP-10A results to record the verified pending-file-open admission cap while explicitly disclaiming general packet-storm coverage. P-20/F-022 remain partial; symlink runtime acceptance, broader interoperability/isolation, and non-TFTP daemons remain open.
- Validation: `tests/unit/tftp-server.test.ts` passed 4/4 for four consecutive runs before the last assertion change, then 4/4 for three consecutive runs after the assertion/timeout fix; `corepack pnpm typecheck`, `corepack pnpm lint` including import boundaries, `git diff --check`, Windows x64 `corepack pnpm build`, and standard TFTP Playwright E2E (1/1) passed. Build reports the existing Vite chunk-size advisory.
- Local commits: `fd0dafb test(tftp): verify pending transfer admission cap` and `4e01af0 test(tftp): assert pending request admission`. The full slice review from `b9c74fa` found one evidence gap (missing opener-count assertion and wait timeout); both were fixed. General and Spec follow-up reviews report no remaining findings; Standards review is pending. Push only after review completes and fresh `git ls-remote` check. The current remote dev is still expected at `b9c74fa`; verify before pushing.
- Keep `session-context.md` untracked and uncommitted. Do not merge to `main` because product/release acceptance remains partial.

## WP-10A mixed active/pending transfer cap race (2026-10-26)

- Standards review discovered an active-transfer overrun not covered by the isolated pending-cap test: with 7 active transfers and 8 asynchronous file opens pending, all 8 could later promote, producing 15 active transfers. This contradicted the documented 8-active limit.
- Read and followed `diagnosing-bugs`. Ranked hypotheses were shown before testing. Added the mixed-load regression first and observed the exact red failure: 8 DATA responses where only 1 promotion was valid. The test then passed after `ReadOnlyTftpServer` rechecked `transfers.size` immediately after each awaited file open and before registration. When active capacity is full, it closes that just-opened handle and returns `Server is busy`. JavaScript's synchronous check-and-registration section makes promotion ordered across completions.
- The final regression starts 7 active transfers, gates 8 pending opens, verifies the 9th RRQ is rejected without entering the opener, releases all 8, then expects one DATA response and 7 exact `Server is busy` responses. It ignores retry datagrams from the 7 held active transfer TIDs and uses bounded waits.
- Final code/docs commits on dev: `fd0dafb` pending admission test, `4e01af0` opener-count/timeouts review fix, `a3925d6` active-cap promotion fix and synchronized docs, `214aa45` exact busy-message assertion. Current HEAD is `214aa45`; remote `origin/dev` is still `b9c74fadab9d623798d2885c8c97542acee94f18` until the final review/push. Remote main is unchanged at `b2aa34d84dba72e4e8865de6a30a19fd49b725a1`.
- After the final code fix: the four focused TFTP unit tests passed five consecutive runs, then three more after the final response-text assertion; typecheck, lint/import-boundary checks and `git diff --check` passed; Windows x64 build passed; standard TFTP Playwright E2E passed 1/1. Build retains the Vite large-chunk advisory.
- Full-range General/Spec/Standards review found the mixed-cap logic correct and docs aligned; one final General note requested exact message assertion, now fixed. Final review of `b9c74fa..214aa45` is pending. Push only after all final reviewers clear and fresh `git ls-remote` check. Keep this session file untracked.

### WP-10A mixed-cap final review and push (2026-10-26)

- Final General, Spec, and Standards review of `b9c74fa..214aa45` found no remaining findings. General's final exact-message assertion was added; Standards noted only an optional duplicate UDP test-helper smell, with differing filter/diagnostic needs.
- Commits `fd0dafb`, `4e01af0`, `a3925d6`, and `214aa45` were pushed to `origin/dev`. Fresh post-push `git ls-remote --heads origin dev main` verified `origin/dev=214aa457601d57f93d7a2fa0d3972ef5966abe38`; `origin/main=b2aa34d84dba72e4e8865de6a30a19fd49b725a1` is unchanged. The only untracked file is `session-context.md`; do not commit it. No merge to main.
- P-41 stays verified for TFTP only. P-20/F-022 remain partial. Next possible independent work should target a documented open acceptance gap or another incomplete requirement; avoid claiming full product completion.

## Resumed work: WP-02A direct SSH private-key authentication (2026-10-26)

### Branch and goal state

- Resumed on `dev` at `62c7a41b60607982c31ddcea2b5f2a87b122d2b0`, tracking `origin/dev`, per the user's explicit branch answer. `main` remains untouched. The goal continues; do not call the product complete or merge partial work to `main`.
- `session-context.md` is user-requested, remains untracked, and must not be committed.
- The original requested MobaXterm ZIP/REA inspection is still unavailable: no REA runtime/tool is installed and the named archive was absent in earlier checks. No proprietary runtime was inspected.

### WP-02A implementation

- Added explicit private-key auth selection for direct SSH terminal and standalone SFTP quick connects. Renderer IPC carries only the enum (`password` or `private-key`); main uses the native file picker and reads a regular key file bounded at 1 MiB. The worker protocol passes key bytes for one auth attempt. No key path/content is saved or logged.
- Username and optional passphrase flow through the existing protected Windows credential prompt. Mutable key buffers are zeroed at main/controller/worker/provider ownership boundaries; references to username and passphrase strings are cleared as work completes.
- Extracted bounded key-file handling to `apps/desktop/src/main/ssh-private-key-reader.ts`; validates picker path, file type, size, opened-file metadata and changed size/mtime. E2E-only test hooks are disabled in packaged builds.
- Updated the typed contracts, preload, UI, broker, application controller, worker adapter/protocol and ssh2 transport provider. Existing pinned `ssh2@1.17.0` supports private-key buffers and key parsing; no dependency change.
- Windows loopback Electron E2E generates an encrypted Ed25519 OpenSSH key, verifies the server-side public-key signature and trusted host handshake, checks terminal output and confirms key path/body/passphrase do not appear in renderer text. Key-file picker and credential prompt are test-hooked in that E2E; the real native picker/prompt and packaged flow remain unverified.
- Focused unit tests cover key file success/failure/bounds, broker secrecy, protocol validation, SSH controller auth/cleanup including invalid-request early exits, SFTP controller key path and provider auth cleanup.
- Docs updated: spec, feature matrix, implementation plan, security rules and `docs/results/WP-02A-ssh-private-key-auth-2026-10-26.md`. P-03/F-003 stays PARTIAL. SFTP key auth is wired and has controller unit coverage, but no SFTP key-auth E2E yet. SSH agent auth, gateway key-auth acceptance, real OpenSSH interoperability and packaged native prompting remain open.

### Validation and review

- `corepack pnpm typecheck` â€” passed.
- `corepack pnpm lint` including static/dynamic/export/type import-boundary checks â€” passed.
- Focused SSH, broker, contract and key-reader unit suite â€” 100/100 passed.
- Windows x64 `corepack pnpm build` â€” passed, including native addon; existing Vite renderer chunk (>500 kB) advisory remains.
- `corepack pnpm exec playwright test tests/e2e/foundation.test.ts --grep "SSH private-key mode" --workers=1` â€” 1/1 passed after final production-code edits.
- `git diff --cached --check` â€” passed.
- Spec review's initial documentation mismatch (SFTP E2E claimed without E2E) was fixed; final Spec review found no remaining findings. Standards review found no hard violations. It noted only an optional duplicated cleanup helper; process-local cleanup is justified because the copies are separate. The early-return cleanup issue found during review was fixed and tested.
- Candidate changes are staged against local `HEAD=62c7a41`; push not yet done. Next: fetch and inspect remote state, commit coherent WP-02A slice, push fast-forward to `origin/dev`, verify `git ls-remote`, and keep this context file untracked.

### Next independent work

- Continue the next open SSH acceptance slice, likely SSH agent auth or disposable Windows OpenSSH interoperability after checking available OpenSSH tooling and current official `ssh2`/Windows agent documentation. Keep P-03/F-003 partial until all required Windows release evidence passes.

### WP-02A commit and push

- Commit `930bc6e0f9218883ec1c9d43bf59ef706925d1f4` (`feat(ssh): add private-key authentication`) was pushed normally to `origin/dev` after fetching and confirming no remote advance.
- Fresh `git ls-remote --heads origin dev main` verified `origin/dev=930bc6e0f9218883ec1c9d43bf59ef706925d1f4`; `origin/main=b2aa34d84dba72e4e8865de6a30a19fd49b725a1` is unchanged. Worktree is clean except the user-requested untracked `session-context.md`; do not commit it.
## Resume update - WP-02B SSH agent authentication (2026-10-26)

- User selected branch dev for this resumed work. The active local branch is dev, tracking origin/dev; prior dev-1 notes above are historical and not the branch for this turn.
- Added Windows OpenSSH agent authentication for SSH terminal and standalone SFTP. The renderer sends only the agent enum; main supplies the OS pipe \\.\pipe\openssh-ssh-agent, asks for a username with an empty password, and disables agent forwarding. Validation allows only local Windows named pipes. The test-only pipe override requires unpackaged mode and exact MRT_E2E=1.
- Added focused unit coverage, loopback SSH-agent E2E with a mock named-pipe agent and ssh2 server, and updated canonical spec/matrix/security/dependency/plan/evidence docs. Genuine Windows OpenSSH-agent acceptance remains open because the local service is disabled; P-03/F-003 remain PARTIAL.
- Final-source validation: typecheck passed; lint and import boundaries passed; focused SSH/broker/contracts/credential suite passed 108/108; private-key and agent SSH E2Es passed 2/2; Windows x64 build passed with Vite's existing renderer-chunk-size advisory; git diff --check passed.
- Local commit: 3d638a1b55ce80c3f8d53f536b759b9b0a957eb4 (feat(ssh): support Windows OpenSSH agent auth), based on 930bc6e0f9218883ec1c9d43bf59ef706925d1f4. Independent general, Standards, and Spec reviews are pending. Push only after reviews and fresh fetch/remote verification. Do not merge to main while Windows acceptance and release gates remain open.
- Keep session-context.md untracked; never stage or commit it.


## Review-gap fixes and validation (2026-10-26)

- On `dev` at the WP-02B commits, closed review findings before promotion. The SSH agent pipe path is no longer part of application authentication credentials or the SSH worker request; the main composition root configures the validated local named pipe only in the supervised worker environment.
- TFTP RRQ filename parsing now uses strict UTF-8 and accepts Windows-legal names up to 255 UTF-16 code units within the existing 1,024-byte request bound. A real Windows UDP/filesystem unit integration transfers exact bytes for a long Unicode filename.
- Added a renderer-crash TFTP E2E. It first failed with `EADDRINUSE`; renderer teardown now closes the TFTP worker, and the test passes with the port rebound while Electron main remains ready.
- Startup preference IPC now uses a separate validated projection without `powerShellProfileScript`. The Settings command reads the complete schema. Docs corrected workbench schema v9 and the serialized preference bound (748,768 characters).
- Verification after final source edits: `corepack pnpm typecheck` and `corepack pnpm lint` passed; focused 12-file unit suite **172/172**; Windows x64 build passed with the existing Vite large-chunk advisory; TFTP renderer-crash, SSH-agent, and PowerShell profile Settings/preview E2Es passed **1/1 each**; `git diff --check` passed.
- The fixes are local/uncommitted at this note's creation. `session-context.md` remains untracked and must not be staged or committed. P-03/F-003 and P-20/F-022 remain PARTIAL; product/release completion is not established.
- Review-gap commit created on local `dev`: `15b1a498b95e508e8990129ccddce0572d6f7ba3` (`fix(review): close SSH and TFTP architecture gaps`). It includes 40 files and excludes this untracked session file.
- After `git fetch origin`, remote refs were verified with `git ls-remote`: `origin/dev=930bc6e0f9218883ec1c9d43bf59ef706925d1f4`, `origin/main=b2aa34d84dba72e4e8865de6a30a19fd49b725a1`, and `origin/dev-1=2d4688ef8e273908f70894f03ad2106f80b2261d`. Local `dev` is four commits ahead of `origin/dev`; remote `main` has not advanced. `git merge-tree --write-tree origin/main HEAD` reports no textual conflicts and produced tree `c1e8dbf91c1b934c9a646911ec2b57a7b3e7e8b9`.
- Fresh General, Standards and Spec reviews of `origin/main...15b1a49` are in progress. Do not push or merge until their findings are received and any Important items are resolved.

## Resumed phase: private-key standalone SFTP acceptance (2026-10-26)

- Active branch is `dev` at local commit `cd81a8f680798338b70131b658a4cf8107aea4c9` (`test(ssh): cover private-key SFTP sessions`), one commit ahead of `origin/dev` while review is pending. `session-context.md` remains untracked and must not be committed.
- Extended the encrypted Ed25519 SSH private-key Windows loopback E2E to open a second, standalone SFTP files-only connection using the same private key. It verifies a real fixture listing, two authenticated connections and passphrase prompts, and exactly one shell request (from the SSH terminal). Existing renderer checks still ensure key path, key body and passphrase are not visible.
- Updated SPEC F-003, FEATURE-MATRIX P-03, SECURITY, WP-02A/WP-02B evidence, and WP-02A implementation plan so no documentation claims standalone SFTP private-key E2E is missing. P-03/F-003 remains PARTIAL for the actual Windows OpenSSH agent service, disposable OpenSSH interoperability and packaged credential prompt acceptance.
- Verification after edits: `corepack pnpm exec playwright test tests/e2e/foundation.test.ts --grep "SSH private-key mode" --workers=1 --reporter=list` passed 1/1 on Windows Electron; `corepack pnpm typecheck` passed; `corepack pnpm lint` passed including import boundaries; `git diff --check` passed. No production source changed, so no rebuild was required.
- Local commit `cd81a8f` contains the seven scoped test/doc files; `session-context.md` was excluded. Independent requesting-code-review plus Standards and Spec axis reviews are in progress. Push and merge only after review, fresh remote inspection, and fast-forward/merge checks.
- Next independent acceptance work after this phase: choose another requirement still open in SPEC/FEATURE-MATRIX; do not mark P-03 complete based on the same-library loopback fixture, and do not claim the product/release is complete.

### WP-02A standalone SFTP private-key review, push and promotion (2026-10-26)

- Independent review of `15b1a498..cd81a8f` passed on Spec and Standards with no findings. General/requesting review approved with one minor stale phrase in WP-02A evidence; it was corrected in follow-up commit `b6e1ebb` to say installed Windows OpenSSH agent interoperability remains open.
- Commits `cd81a8f` (Windows E2E plus aligned acceptance docs) and `b6e1ebb` (review wording fix) were pushed normally to `origin/dev`. Fresh `git ls-remote` verified `origin/dev=b6e1ebb95a1d91f8d4cc9dc0c0443c7d46a030cd`.
- The reviewed `dev` was merged into `main` preserving merge history in `693a1b4e9bd80804a0955440d3cfff5c8555119b`; push succeeded and fresh `git ls-remote` verified `origin/main=693a1b4e9bd80804a0955440d3cfff5c8555119b`. Returned to `dev`, which tracks `origin/dev` and is clean except this untracked context file.
- Next task selected: diagnose the recorded Git Bash supplementary-character paste failure under ConPTY. The expected-failure regression and earlier attempted mitigations are recorded in WP-01E evidence. Apply the local diagnosing-bugs skill, inspect the exact reproducer and current environment, and do not claim a fix unless the expected failure becomes a passing Windows E2E.

## Resumed Git Bash Unicode diagnostic follow-up (2026-10-26)

- Confirmed `dev` is the active branch at `b6e1ebb`, tracking `origin/dev`. `origin/main` is `693a1b4`; `dev-1` remains untouched. The working tree initially contained only a stale E2E bridge API expectation plus this untracked context file.
- Updated `tests/e2e/foundation.test.ts` isolation assertion to match the actual typed preload API after legitimate features were added. It still asserts `require`, `process`, and `Buffer` are unavailable and checks the entire exposed bridge list.
- Re-ran focused Windows Electron E2Es: PowerShell local-terminal flow passed; Git Bash supplementary paste reproduced U+FFFD in the expected-failure case. Previous 3-repeat run reproduced 3/3. Prior control runs established that PowerShell clipboard paste with U+1F642 passes, noninteractive `bash -c` preserves it, and direct typed `writeTerminal` input still reproduces replacement.
- Host: Windows 11 Pro `10.0.26200.0`, Git for Windows `2.53.0.windows.2`, Bash `5.2.37`, Node `24.14.1`, Electron `45.0.0`.
- Attempted a standalone `node-pty` reproduction; it failed outside Electron because its Windows console-list helper raised `AttachConsole failed`. Temporary probe file was removed. Treat that run as invalid and do not infer a cause from it.
- Updated `docs/results/WP-01E-bash-supplementary-input-2026-10-26.md` with the controls, environment, inconclusive boundary, and exact current validation. No production workaround is safe; Git Bash interactive U+1F642 input remains an open F-002 acceptance issue. P-02 remains partial.
- Validation passed: `corepack pnpm typecheck`; `corepack pnpm lint` including import boundaries; focused E2E `--grep "Windows local terminal workbench|Git Bash supplementary Unicode paste"` (2 passed, one is marked expected failure after U+FFFD); `git diff --check`.
- Review skills `requesting-code-review` and `code-review` were read. The latter mandates two parallel review axes; both have now returned with no blocking findings. Push only to `dev` after fresh remote verification. Do not merge this unresolved diagnostic into `main`; the spec's full M4 release gate remains open.
- `session-context.md` stays untracked and must not be staged or committed.

### Diagnostic review outcome

- Scoped commit `3358c14721b5f91380e8138e559df82aa99269a3` (`test(terminal): refresh bridge isolation evidence`) was reviewed against `b6e1ebb95a1d91f8d4cc9dc0c0443c7d46a030cd`.
- Code-review Standards axis: no findings. Spec axis: F-002 still fails the U+1F642 interactive Git Bash paste criterion; the change only documents the open failure and refreshes the preload bridge expectation. No scope creep or incorrect behavior found.
- The code-review skill's linked `code-reviewer.md` template is missing from its installed folder; the two explicit standards/spec prompts in the skill were used instead.
- Before publishing, fetch and verify current `origin/dev`, push the scoped commit, and confirm it with `git ls-remote`. Do not merge to `main` for this unresolved diagnostic; continue with the next independent release/acceptance gap on `dev`.
- Published commit `3358c14721b5f91380e8138e559df82aa99269a3` to `origin/dev` after fresh fetch and the two-axis review. `git ls-remote --heads origin dev main` confirmed `dev=3358c14721b5f91380e8138e559df82aa99269a3` and left `main=693a1b4e9bd80804a0955440d3cfff5c8555119b` unchanged.
- Read-only environment check found only the `docker-desktop` WSL distribution; it is not suitable evidence of a user-managed distro. The Windows OpenSSH agent service is stopped and disabled, so do not enable it or claim native service interoperability.
- The Windows package smoke candidate has now been run; see the follow-up below. M4 remains open for Windows 10, signing, and independent release/security gates.

## WP-07W packaged smoke revalidation (2026-10-26)

- Ran documented `corepack pnpm package:win:smoke` on Windows 11 Pro 10.0.26200.0. It rebuilt the native addon and renderer, generated NSIS and portable x64 executables, per-artifact CycloneDX SBOMs for 31 runtime components, and the SHA-256 manifest. It skipped Authenticode signing because no certificate was configured.
- Initial integrated package E2E reached NSIS validation but failed because `getByRole('status')` matched both `Status: Unlocked` and `Settings saved.`. The exact save message was present; no application defect was indicated.
- Fixed only the E2E locator to assert exact `Settings saved.` text. Re-ran the complete package smoke E2E against the freshly built outputs with `MRT_PACKAGE_E2E=1`; all four tests passed (fuses/ASAR, SBOM/hash, NSIS install/offline/200%/persistence/tamper/uninstall, portable startup/profile placement). The focused NSIS E2E also passed 1/1.
- After that test edit, `corepack pnpm typecheck`, `corepack pnpm lint` including import boundaries, and `git diff --check` passed. No production source changed.
- Updated WP-07W evidence plus package status in the implementation plan, feature matrix and Windows release guide. Windows 10, signed packages, OS-level offline, native credential/live SSH flows and M4 remain open. The generated current artifacts are unsigned `0.0.0` previews, not a release.
- Current tracked changes for the next reviewed commit are `tests/e2e/package-smoke.test.ts`, `docs/results/WP-07W-package-smoke-revalidation-2026-10-26.md`, `docs/IMPLEMENTATION-PLAN.md`, `docs/FEATURE-MATRIX.md` and `docs/release/WINDOWS-RELEASE.md`. `session-context.md` remains untracked and excluded.
- Scoped package acceptance commit: `2bbecba3c303e1a21eb14d5f9713180f5a027431` (`test(release): revalidate packaged smoke flow`), directly after `3358c14`.
- Review outcome against `3358c14..2bbecba`: Standards found no violations or smells. Spec found no scope creep or incorrect behavior and confirmed the missing Windows 10 evidence is correctly left partial. Both axes are clear to proceed.
- Published `2bbecba3c303e1a21eb14d5f9713180f5a027431` to `origin/dev`; `git ls-remote` verified it.
- Merged `dev` into `main` with regular merge commit `fc5e7e34cdedcff7fcf32dcf03de41d4296c23ba` (`Merge reviewed development work into main`), pushed it, and verified `origin/main=fc5e7e34cdedcff7fcf32dcf03de41d4296c23ba` and `origin/dev=2bbecba3c303e1a21eb14d5f9713180f5a027431`.
- Returned to `dev`. Check the final worktree status before proceeding; keep this session-context file untracked. Product and M4 release completion are not established.

## Resumed Git Bash ConPTY investigation (2026-10-26)

- User resumed the active goal and selected `dev` as the work branch. `dev` is tracking `origin/dev`; preserve this untracked context file and never include it in commits.
- Added an interactive `cat` stdin probe before the existing Bash printf round trip in `tests/e2e/foundation.test.ts`. Pasting `MRT-RAW:` + U+1F642 and Enter displays U+FFFD in both the console echo and `cat` output. This narrows the loss to before Bash Readline; it does not identify ConPTY/Windows input processing versus Git Bash/MSYS translation. Renamed variables and wording to avoid implying terminal raw mode.
- Updated `docs/results/WP-01E-bash-supplementary-input-2026-10-26.md`, `docs/FEATURE-MATRIX.md`, and `docs/IMPLEMENTATION-PLAN.md`. F-002 remains incomplete; no production workaround was added.
- On Windows 11 Pro 10.0.26200.0 / Git for Windows 2.53.0.windows.2 / Bash 5.2.37, focused E2E reproduced the expected failure 3/3 with `corepack pnpm exec playwright test tests/e2e/foundation.test.ts --grep "Git Bash supplementary Unicode paste" --repeat-each=3 --workers=1 --reporter=list`. The normal Bash launch/reopen flow passed; PowerShell Unicode control passed. `corepack pnpm typecheck`, `corepack pnpm lint` including import boundaries, and `git diff --check` passed.
- A temporary direct native `CreatePseudoConsole` C# harness wrote UTF-8 through the ConPTY input pipe and captured output without Electron, `node-pty`, clipboard handling, or xterm. It reproduced two U+FFFD occurrences and zero U+1F642 for both `C:\Program Files\Git\bin\bash.exe --login -i` and `C:\Program Files\Git\usr\bin\bash.exe --login -i`. This shows the app-specific components and the `bin` launcher are not required to reproduce the symptom; exact upstream attribution remains unknown. An earlier draft of the harness was invalid (wrong pseudoconsole startup details) and is discarded; the corrected run used the native pseudoconsole attribute and STARTF_USESTDHANDLES.
- Inspected `reverse-engineer-anything/SKILL.md`, but there are no REA MCP tools and no `rea` CLI in this session. Did not install REA; the direct Windows API harness is ordinary local evidence, not REA evidence. Consulted the official Microsoft Terminal ConPTY sample to correct the temporary harness.
- Diagnostic commits `925daf6` (test/control), `8cb06b9` (evidence wording), and `8f918dd` (review terminology fix) were reviewed, pushed to `origin/dev`, and merged into `main` through `66f8430`; fresh `git ls-remote` confirmed `origin/dev=8f918dd74b7356dfc51b94b17c372ef9dd8383fd` and `origin/main=66f8430201e4a25c8d8854fdc4b500b1349646a3`.
- Additional docs-only commits `ac9662a` (independent ConPTY result) and `ef09b48` (wording fix) record the direct-input probe and 3/3 E2E repeat. General/Standards/Spec reviews passed; a minor finding was fixed before merge. The temporary native harness is not saved in the repo, but the checked-in Windows E2E remains rerunnable.
- After fresh fetch, pushed the reviewed commits to `origin/dev`; `git ls-remote` confirmed `origin/dev=ef09b48153c4b8364a00d87c9d3d708fbb2e7189`. Merged `dev` into `main` with regular merge commit `ea48f487a0e592cdbd5445f0b8da5d0977fbc5b8`, pushed, and verified `origin/main=ea48f487a0e592cdbd5445f0b8da5d0977fbc5b8`. Returned to `dev`, tracking `origin/dev`; worktree is clean except `session-context.md`.
- No full product or release completion claim. Continue with a safe root-cause/fix investigation or the next acceptance gap on `dev`; keep F-002 and the M4 gate partial until their required Windows acceptance passes.

## WP-01E supplementary clipboard fix (2026-10-26)

- Implemented a distinct `paste` operation for local terminals. The main-process broker still owns clipboard access, one-use gesture authorization, multiline confirmation and cancellation; worker requests validate the same 16,384-character bound as terminal writes.
- Added `Win32InputModeTracker` in the local PTY adapter. It tracks ConPTY `CSI ? 9001 h/l` across output chunks and resets with each session. For authorized local clipboard paste only, valid supplementary UTF-16 pairs become Win32 key-down records while other characters remain unchanged. Keyboard writes and remote protocol paths are unchanged.
- Added ADR-0030 and updated the feature matrix, implementation plan and WP-01E evidence. F-002 remains PARTIAL pending Windows 10 and packaged shell lifecycle acceptance; the raw ConPTY echo artifact remains documented.
- Validation on Windows 11 x64: `corepack pnpm build` passed (existing renderer chunk-size advisory); `corepack pnpm typecheck` passed; `corepack pnpm lint` passed including import-boundary checks; focused unit suite passed 45/45; targeted Playwright suite passed 3/3 (supplementary Bash paste, saved Bash reopen, and PowerShell/10-tab shell lifecycle). The supplementary Git Bash test also passed three consecutive runs in a separate `--repeat-each=3` run. `git diff --check` passed.
- Review range `origin/main...HEAD` was reviewed before publication. Standards: no documented-rule violations; possible duplicated request validation branches in `apps/desktop/src/workers/protocol.ts` are a minor judgement call. Spec: no scope creep or incorrect claims; F-002 appropriately remains partial.
- Commit `aca7d8ef84ed2ebba8c58e792b344ba8f11db04a` (`fix(terminal): preserve supplementary clipboard input in Bash`) was pushed to `origin/dev`. Regular merge commit `1b664d3c65f2c3b5f638e5fb2dfa6be0b9eba7ad` was pushed to `origin/main`; `git ls-remote` verified `origin/dev=aca7d8e` and `origin/main=1b664d3`. Returned to local `dev` tracking `origin/dev`.
- Keep `session-context.md` untracked and out of all commits. The product is not declared complete; release gates remain open.

## WP-07W packaged Git Bash acceptance (2026-10-26)

- Added one package E2E helper that opens `New Bash terminal`, types a `printf` command whose output differs from its echoed source, and checks actual Git Bash output. Ran it for both the NSIS-installed and portable packaged apps.
- Rebuilt packages with `corepack pnpm package:win:smoke`: unsigned x64 installer and portable executable generated; all 4 package E2Es passed, including PowerShell and Git Bash execution in both launch paths. The package build emitted the existing Vite chunk-size advisory and skipped signing because there is no certificate.
- `corepack pnpm typecheck`, `corepack pnpm lint` including import-boundary checks, and `git diff --check` passed. Package evidence, feature matrix, implementation plan and release guide now record the Windows 11 Bash package coverage. Windows 10, signing, and other M4 gates remain open; F-002 remains PARTIAL.
- Review range `origin/main...HEAD`: Standards found no documented-standard violations; possible repeated shell setup steps in `tests/e2e/package-smoke.test.ts` are a minor judgment call. Spec found no scope creep or incorrect implementation; Windows 10 and the documented ConPTY echo artifact remain open.
- Commit `d864d3ebed1ddd09ddd3b3af7bfe19f9558b41c7` (`test(release): exercise Git Bash in packaged builds`) was pushed to `origin/dev`. Regular merge commit `eeea6438377402d181eba6fe20f3d128ae06c46e` was pushed to `origin/main`; `git ls-remote` verified both refs. Returned to `dev` tracking `origin/dev`.
- Keep `session-context.md` untracked and out of all commits.

## WP-07X renderer accessibility and copy audit (2026-10-26)

- Read the local `web-design-guidelines` skill and fetched its current rules from the linked repository source. Reviewed all 26 renderer source paths using static searches and targeted component inspection; no axe/JSX accessibility package was installed or added.
- Corrected ASCII `...` status copy to the ellipsis glyph, standardized Telnet/FTP/tunnel host example placeholders, and changed the macro command placeholder to an example command.
- The audit found an unrelated ambiguous macro E2E selector that matched both the macro row and its “Set shortcut” control. The original test invocation reproduced the strict-mode failure; the locator is now scoped to `.macro-list-item`, and the focused macro persistence E2E passes. Help keyboard/focus E2E also passes.
- Build, typecheck and lint passed on Windows x64; the build emitted the known chunk-size advisory. N-006 remains partial: this is static source review, not a WCAG or screen-reader certification; physical DPI, NVDA/JAWS, Windows 10 and remaining M4 acceptance are open.
- Commit `9060d65788e2a7b6e5041c877dfaded39ba7fd85` (`fix(ui): polish accessibility copy and audit evidence`) was reviewed against `origin/main` by Standards and Spec, pushed to `origin/dev`, and merged with regular merge commit `957c0febea9ff0946144ca3e318cd5f4a48d0c93` on `origin/main`. `git ls-remote` verified both refs; returned to `dev` tracking `origin/dev`.
- Keep `session-context.md` untracked and uncommitted.

## WP-04F saved tunnels through SSH gateways (2026-10-26)

- User resumed active goal on `dev`; no further branch clarification is needed. Current local commit: `c6f3769b9b2934a3a695f970452bad740fa068f5`. Do not use `dev-1`.
- Added per-start selection of up to two saved SSH gateway profiles for local, remote and dynamic tunnel definitions. Direct start remains available. Typed IPC sends profile IDs only; main resolves saved SSH profiles and checks endpoint overlap against the tunnel's saved SSH target; the controller independently normalizes and validates before opening the existing files-only SSH runtime. Tunnel definitions and folder exports are unchanged. Identical route starts coalesce; a different route for the same starting tunnel returns `BUSY`.
- Added the tunnel route picker, route-aware IPC timeout, contract/broker/controller validation and essential tests. Updated architecture, security, feature matrix, implementation plan and spec. Added ADR-0033 and `docs/results/WP-04F-tunnels-through-ssh-gateways-2026-10-26.md`.
- Windows E2E uses dedicated SSH fixtures for an independent two-gateway tunnel route. It approves every host key, verifies relay order, compares the complete TCP response buffer, records no PTY/shell/SFTP request at the tunnel target, waits for all three fixture clients and forwarding sockets to close, and confirms the stopped listener refuses connections. The E2E caught a renderer callback that discarded selected gateway IDs; `main.tsx` now forwards both callback values. Final targeted E2E passed 1/1.
- Follow-up fixed acceptance observability gaps found by independent review and reconciled stale current-state summaries in architecture, feature matrix, implementation plan, ADR-0032 and the WP-04F result record. The F-006 spec row now explicitly says routed remote-forward and dynamic SOCKS roundtrips remain open.
- Final checks on Windows 11 Pro x64 build 26200 / Node 24.14.1 / Electron 45.0.0: typecheck passed; lint and import boundaries passed; focused unit suites passed 110/110; `corepack pnpm build` passed with the existing Vite renderer chunk advisory (964.01 kB); Electron setup passed; `git diff --check` passed; the targeted Windows E2E passed 1/1 after the stronger assertions.
- Review: independent Standards review found no documented violations or actionable smells. Spec review found no wrong behavior or scope creep; it keeps routed remote/dynamic rounds, chains longer than two and public-server interoperability open. The implementation reviewer rechecked all prior findings and reported no critical, important or minor issues; ready to merge. Code review range was `ce341ed7b4e67316c3b9c81051c70faf90c31221..e7fff644f8c68d7714c2da846144defd61ef7838`; final documentation commit `c6f3769b9b2934a3a695f970452bad740fa068f5` was separately checked by Standards and Spec.
- Local commits on `dev`: `2cb2538` implementation, `e7fff64` E2E/documentation follow-up, and `c6f3769` final review record/spec wording. Fresh remote verification found `origin/dev=ce341ed7b4e67316c3b9c81051c70faf90c31221`, `origin/main=342d5ef06b2165bc84de482d703e69f14f16242e`, and `origin/HEAD=main`. Pushed `dev=c6f3769b9b2934a3a695f970452bad740fa068f5`; merged `dev` into `main` with regular `--no-ff` merge commit `83aec59c95f1bb3195174abb26006198dc913938`; pushed `main`; fresh `git ls-remote` verified both hashes and the default branch. Confirmed `main` and `dev` trees match and returned to `dev`, tracking `origin/dev`. Only `session-context.md` is untracked.
- Next intended slice after WP-04F promotion: WP-04G focused Windows routed remote-forward and dynamic SOCKS roundtrip acceptance, since only the routed local forward has E2E evidence. Longer chains, broader interoperability and M4 release, Windows 10 and signing gates remain open. P-22/P-23/P-24/P-25 and F-006/F-011 remain partial.
- Do not stage or commit this session-context file.

## Resumed WP-04E SFTP-only gateway routes (2026-10-26)

- User confirmed the development branch is `dev`; the prior promoted state was `dev=0e270c3db15a3fff1cba7aa39c455b7b4ce2d027`, `main=7ae261a33066a36300cd3efc308107468ac8272a`. The current `dev` commit is `c3f69ffbb5c59748390a700e49f062ae0a3fcd2a`; remote `dev` has not yet been updated for WP-04E. `session-context.md` remains untracked.
- Implemented saved SFTP-only session routes through up to two saved SSH gateways. Typed IPC carries gateway profile IDs; main resolves saved SSH profiles and validates normalized routes. Application/controller, worker host, worker protocol and SSH transport provider carry gateway credentials to the files-only SSH route. Each hop uses host trust and route-ordered credentials; SFTP requests no PTY or shell. Routed connections are excluded from auto-save because routes are not stored in session definitions.
- Renderer offers “Connect through gateways…” from both saved SSH and SFTP profiles. Added unit coverage for SFTP route ID validation, broker resolution, controller host verification/no-shell behavior, worker payload validation and temporary gateway secret cleanup. Extended the Windows Electron gateway E2E with a two-gateway SFTP-only target, independent target trust, remote listing, zero shell requests and client/relay cleanup.
- Updated `docs/ARCHITECTURE.md`, `docs/SECURITY.md`, `docs/FEATURE-MATRIX.md`, `docs/IMPLEMENTATION-PLAN.md`, `docs/SPEC-001-MultiRemoteTerminal.md`, ADR-0012, new ADR-0032 and `docs/results/WP-04E-sftp-only-ssh-gateway-routes-2026-10-26.md`. P-22/F-011 remain partial for gateway-routed tunnels, longer chains and public-server interoperability.
- Validation on Windows 11 Pro x64 build 26200: typecheck passed; lint/import boundaries passed; focused six-file unit suite passed 114/114; build passed with Vite's >500 kB renderer advisory (961.82 kB generated JS chunk); Electron setup passed; targeted gateway Electron E2E passed 1/1; diff whitespace check passed.
- The installed `reverse-engineer-anything` skill was read. The user-referenced archive `C:\Users\Beasty\Downloads\MobaXterm_Portable_v26.5.zip` was not available. No artifact inspection was done because the repository specification and ADRs define this slice; no binary-derived behavior is claimed.
- WP-04E commits: `c3f69ff` (SFTP gateway routes), `ea8ed8e` (shared gateway credential cleanup) and `ce341ed` (review record). Final two-axis review against `origin/main...ea8ed8e` passed: Standards found no documented violations or remaining actionable smells; Spec found no mismatch and confirmed P-22/F-011 limits. Validation after the cleanup fix: typecheck/lint passed, focused suite 114/114, Windows build passed with the >500 kB bundle advisory, and Windows 11 targeted gateway Electron E2E passed 1/1. Pushed `dev=ce341ed7b4e67316c3b9c81051c70faf90c31221`, merged with regular `--no-ff` merge `main=342d5ef06b2165bc84de482d703e69f14f16242e`; fresh `git ls-remote` verified both refs. Returned to `dev`, tracking `origin/dev`. `session-context.md` remains untracked and must not be committed.

## WP-11C optional provider availability (2026-10-26)

- User resumed the project and confirmed `dev` as the development branch. `dev` was fast-forwarded to `origin/main` at `a0552c29542b5e62fb4c6c3b25c7329c61255aca` before this slice. Work remains on `dev`; do not use `dev-1`.
- Added a fixed app-owned allowlist for Telnet, FTP/FTPS, serial, RDP, VNC, and TFTP. Workbench preferences schema v10 persists the allowlist; schema v9 and earlier migrate with every existing provider enabled. New entry points are gated in the renderer and main broker, and broker preference-read failures fail closed. Existing session I/O and close, plus TFTP stop, stay available.
- Added Settings toggles, provider visibility handling, documentation, ADR-0031, and focused domain/SQLite/broker tests. P-31/P-37/F-017 remain partial because signed third-party provider discovery and lifecycle management are not implemented.
- Initial review found the WP-11C evidence file had been reduced to a blank line during line-ending cleanup, and the TFTP manager button remained visible while disabled. Restored the results evidence. Gated TFTP launch actions; retained a manager route only for a running or status-unknown service, disabled folder/start controls when disabled, and centralized optional-provider visibility checks in `isOptionalConnectionEnabled`.
- Validation after the final code change: `corepack pnpm typecheck` passed; `corepack pnpm lint` passed including boundary checks; `corepack pnpm build` passed on Windows 11 x64 with the existing >500 KiB renderer chunk advisory; focused domain, SQLite and broker tests passed 62/62; targeted Windows Electron E2E `local shell tool visibility persists and controls command palette entries after restart` passed 1/1 and now covers disabling, persistence and re-enabling Telnet/TFTP; `git diff --check` passed.
- Local commits on `dev`: `a86195a` feature slice, `88171ed` TFTP cleanup and results correction, and `0e270c3` shared provider-visibility predicate. Final review range `a0552c2...0e270c3` passed both axes: Standards found no documented violations or actionable smells; Spec found no missing behavior beyond explicitly partial third-party provider lifecycle, no scope creep, and no incorrect behavior. The earlier empty evidence file and TFTP visibility findings were fixed before promotion.
- Pushed `dev`; fresh `git ls-remote` verified `origin/dev=0e270c3db15a3fff1cba7aa39c455b7b4ce2d027`. Merged with regular `--no-ff` merge commit `7ae261a33066a36300cd3efc308107468ac8272a` and pushed `main`; fresh `git ls-remote` verified that remote SHA. Returned to `dev`, tracking `origin/dev`, which is clean except this untracked context file.
- `session-context.md` is untracked and must not be staged or committed. M4 remains incomplete; Windows 10, signing, physical DPI/accessibility, device and external protocol acceptance gates remain open.

## WP-07Y Windows compatibility matrix (2026-10-26)

- Added `docs/release/WINDOWS-COMPATIBILITY.md` with verified Windows 11 Pro x64 host details, NSIS/portable and Git Bash evidence, and explicit untested rows for Windows 10, ARM64, physical OS DPI, assistive technology, external interoperability and signed distribution.
- Linked the matrix from `WINDOWS-RELEASE.md`, the P-32 feature entry and the implementation plan. Verified all nine relative evidence links resolve; `git diff --check` passed. Documentation-only; no test rerun was needed.
- Standards review found no violations or actionable smells. Spec review confirmed F-001 Windows 10 and M4 remain open and found no inaccurate compatibility claims.
- Commit `de0dd2253c1029a168d2d9562eafe26b191a140a` (`docs(release): publish Windows compatibility matrix`) was pushed to `origin/dev` and merged with regular merge commit `a0552c29542b5e62fb4c6c3b25c7329c61255aca` on `origin/main`. `git ls-remote` verified both. Returned to `dev`.
- Keep `session-context.md` untracked and uncommitted.

## Resumed WP-04G routed tunnel acceptance (2026-10-26)

- Continued on the user-selected `dev` branch from the WP-04F promoted base. WP-04G adds Windows Electron E2E acceptance for remote SSH forwarding and dynamic SOCKS5 TCP `CONNECT` through two saved SSH gateways; no production code changed.
- The tunnel target fixture accepts length-prefixed request frames, echoes the full payload, and ends the response. Each local, remote, and dynamic mode compares the complete response through TCP EOF and, after cleanup, asserts the exact raw target request byte count. The test also checks both relay hops, per-hop host trust, no target PTY/shell/SFTP, remote unbind, stopped-listener refusal, and client/channel/socket cleanup.
- Review-driven follow-ups fixed early response collection, exact request-byte accounting, repeated assertion helpers, and trailing Markdown spaces. Final code is in commits `36cc3ff`, `bf13658`, `9983175`, `665a7ad`, `3e6ed56`, `af8e669`; review outcome documentation is in `9040736`.
- Final checks on Windows 11 Pro x64 build 26200 / Node 24.14.1 / Electron 45.0.0: focused E2E `corepack pnpm exec playwright test tests/e2e/foundation.test.ts --grep "SSH saved-profile jump routes verify every hop" --reporter=line` passed 1/1; `corepack pnpm typecheck` passed; `corepack pnpm lint` and import-boundary checks passed; `git diff --check` passed.
- Final review range `83aec59c95f1bb3195174abb26006198dc913938...af8e6694d689454217ae402629cb95fafa96e1cd`: Standards found no documented violations or remaining smells; Spec found no missing or incorrect behavior/scope creep; implementation review found no issues and marked ready to merge. Remaining gaps are longer-than-two-hop routes, public-server interoperability, non-loopback consent, SOCKS UDP/BIND/authentication; F-006/F-011 and P-22/P-24/P-25 remain partial.
- Pushed `dev=9040736c424ec9bd573d30a71aa982f38cf000e7`, verified with `git ls-remote`, then merged to `main` with regular `--no-ff` commit `d14fad727cbc6ad1ede0c0cd26cb219d35b313e4` (parents `83aec59c95f1bb3195174abb26006198dc913938` and `9040736c424ec9bd573d30a71aa982f38cf000e7`). Pushed and independently verified both remote refs and `origin/HEAD=main`; returned to `dev`, tracking `origin/dev`.
- The user-supplied MobaXterm archive path `C:\Users\Beasty\Downloads\MobaXterm_Portable_v26.5.zip` is absent in this workspace, and no REA tool/CLI is registered. The reverse-engineer-anything skill was read, but no artifact analysis or binary-derived claims were made.
- `session-context.md` remains untracked and must not be committed.

## Resumed WP-04H three-gateway SSH routes (2026-10-26 to 2026-10-27)

- Worked on the user-selected `dev` branch, based at `9040736c424ec9bd573d30a71aa982f38cf000e7` after the WP-04G promotion. Implemented a maximum of three ordered saved SSH gateways for terminal, SFTP-only and local/remote/dynamic tunnel starts. The domain, typed contracts and worker boundary accept three and reject four; protocol v1 remains unchanged.
- Added shared `SshGatewayRoutePicker` for terminal/SFTP and tunnel dialogs. Routes remain operation-scoped, renderer IPC carries profile IDs only, and canonical duplicate/target endpoint choices are filtered. Consolidated host/port formatting, including IPv6 brackets, in `ssh-endpoint-label.ts`.
- Added ADR-0034 and updated architecture, security, feature matrix, implementation plan, SPEC rows and user guide. P-22/F-011 remain PARTIAL for routes above three and broad public-server interoperability. OpenSSH agent authentication through gateway routes also remains unverified.
- Review findings and fixes: the Spec review found a stale “up to two” user-guide limit and missing three-hop failure cleanup coverage; fixed both. The Standards review flagged duplicate endpoint formatting; consolidated it into one renderer helper. The implementation review noted no SFTP PTY assertion; added a fixture PTY event and zero-PTY assertion for both two- and three-gateway routes. Final Standards, Spec and implementation follow-up reviews found no remaining actionable issues and marked the work ready to merge.
- Validation: focused SSH/domain/contracts/broker tests **124/124**; `corepack pnpm typecheck` passed; `corepack pnpm lint` passed including import boundaries; `corepack pnpm build` passed on Windows x64 (native addon and renderer) with the 963.69 kB renderer chunk advisory; the targeted gateway Windows Electron E2E passed **1/1**, covering one/two/three-hop terminals, two/three-hop SFTP (no PTY or shell), and three-hop local/remote/dynamic tunnels; `git diff --check` passed. One typecheck run concurrent with build reported TS6305 for generated `dist/types`; the isolated run after build passed. Final E2E/typecheck/lint checks were rerun after review fixes; production build preceded only test/documentation-only follow-ups.
- Commits on `dev`: `97cc9c9` (three-gateway routes), `e093012` (failure cleanup and user guide), `828f05c` (shared endpoint formatting), `12d4070` (SFTP no-PTY E2E) and `8e8ade1` (review record).
- Pushed and verified `origin/dev=8e8ade115d274dc94596081226dc584f95a7cba8`. Merged into `main` with regular `--no-ff` merge `f0a6efee5f2013dd4f88a46ad4c0b5696b561bf7`, pushed and verified `origin/main` at the same SHA; `origin/HEAD` points to `main`. Returned to `dev` tracking `origin/dev`.
- Current status: `dev` is clean except for this untracked file. Keep `session-context.md` uncommitted.

## Next work after WP-04H

The product remains unfinished; continue on `dev` without treating this merge as the M4 release gate. Re-read the current FEATURE-MATRIX and IMPLEMENTATION-PLAN, then take the next implementable partial requirement with a Windows loopback or mock-backed acceptance seam. Keep external interoperability, Windows 10, signing, hardware, physical DPI and assistive-technology gaps explicitly partial where the environment cannot establish them.
## WP-04I routed SSH agent authentication acceptance (2026-10-27)

- Resumed the paused current phase on the user-selected `dev` branch. The worktree initially had the routed-agent E2E change from the prior turn plus untracked `session-context.md`; remote `origin/HEAD` was verified as `main`.
- Extended the Windows Electron gateway-route E2E with an unpackaged-only temporary named-pipe `ssh2.AgentProtocol` mock. It verifies agent identity enumeration and signature acceptance at both SSH terminal and SFTP-only destinations through three password-authenticated saved gateways. It also checks terminal output, SFTP listing with no PTY/shell, route/client/agent-socket cleanup, and that the pipe path/private key do not appear in renderer-visible text. No production behavior or protocol changed.
- Updated architecture, security, feature matrix, implementation plan, SPEC rows, and WP-02B evidence; added `docs/results/WP-04I-routed-ssh-agent-auth-2026-10-27.md`. P-03/F-003 and P-22/F-011 remain PARTIAL for actual Windows OpenSSH agent interoperability, disposable OpenSSH acceptance, private-key gateway auth, routes above three hops, and broader interoperability.
- Final validation on Windows x64: targeted route E2E passed 1/1; `corepack pnpm typecheck`, `corepack pnpm lint` including import-boundary checks, `corepack pnpm build`, and `git diff --check` passed. Build reported the existing 963.69 kB renderer chunk advisory.
- Standards review found no documented-rule violations and noted a possible low-severity duplicate named-pipe agent fixture between direct and routed E2E setup; it is tracked in the evidence record and was not a merge blocker. Spec review found no omissions, scope creep, or incorrect behavior. Both final follow-ups confirmed the review record and final diff were ready to merge.
- Commits on `dev`: `2af790e` (`test(ssh): cover agent authentication through gateways`) and `475c2b2` (`docs(ssh): record WP-04I review outcome`). Pushed and verified `origin/dev=475c2b2a97cc9abacdccbc1095c22fb99de7ae79`.
- Merged `dev` into `main` with regular merge commit `9187f1e86b0cbb1927edc3348cc649c6154cfd9c`, pushed and verified `origin/main` and `origin/HEAD=main`. `git diff --exit-code dev main` confirmed matching trees. Returned to `dev`, tracking `origin/dev`.
- The user asked the goal to pause after this phase. Leave `session-context.md` untracked and do not commit it.

## WP-11D local shell availability and saved-profile policy (2026-10-27)

- Resumed on `dev` at `475c2b2a97cc9abacdccbc1095c22fb99de7ae79`; fetched `origin` and confirmed its default branch is `main`. Requirements addressed: P-21, P-37 and F-009, all still partial for broader tool lifecycle/release acceptance.
- Added `enabledLocalShells` for the fixed PowerShell, cmd, Git Bash and WSL catalog, separate from command-palette visibility. Workbench preferences move from schema v10 to v11; older schemas migrate with all supported shells enabled. Settings toggles are persisted; disabled saved profiles stay visible but cannot be reopened, while active sessions remain usable and closable.
- The renderer waits for a successful preference read before showing shell launch actions. The main broker enforces `terminal.open` and WSL distribution listing and fails closed on preference-read failure. Default startup PowerShell is skipped when disabled and never falls back to another shell.
- Debugged a delayed-preference Windows E2E regression: automatic startup PowerShell was closing an open command palette because all `openTerminal` calls reset palette state. Added an explicit `dismissPalette` parameter and set it false only for automatic startup. The test now confirms palette/search survives delayed settings loading. The new availability E2E also waits for preferences before clicking Bash because the app intentionally hides shell actions until the initial read succeeds.
- A focused SQLite migration test initially found that v11 normalization did not preserve `enabledOptionalConnections` when converting the v11 row. Fixed normalization to accept that field in both v10 and v11 exact schemas; final focused unit suite passed 66/66.
- Added ADR-0035, WP-11D results evidence and updates to architecture, security, glossary, implementation plan, specification and feature matrix. P-21/P-37/F-009 remain partial for shell/provider installation and removal, native logo-picker acceptance, actual WSL interoperability, Windows 10, and signed release acceptance.
- Final validation on Windows x64: `node --test tests/unit/workbench-preferences.test.ts tests/unit/sqlite-workbench-preferences.test.ts tests/unit/broker.test.ts` passed 66/66; focused Windows Electron E2E for local-shell visibility and availability passed 2/2; `corepack pnpm typecheck`, `corepack pnpm lint` with import-boundary checks, `corepack pnpm build`, and `git diff --check` passed. Build retains Vite's renderer bundle advisory (967.04 kB). Inspected the Settings screenshot at 1164x734; this was scoped visual review, not an accessibility certification.
- Two-axis review against the WP-11D diff found no documented-standard breach, no missing/incorrect WP-11D behavior and no scope creep. Standards noted two low-severity judgement calls: explicit v11 field-shape checks repeat the v10 fields, and `normalizeEnabledLocalShells` delegates to the shared local-shell validator. Both were retained for exact-schema auditability and clear availability intent; follow-up reviewers confirmed the recorded disposition.
- Commits on `dev`: `3e8ec31` (`feat(settings): control local shell availability`), `16c2762` (`docs(settings): record local shell acceptance`) and `f736a55` (`docs(settings): record review outcome`). Pushed and verified `origin/dev=f736a55aa99edfd8c033c43da981543df5512670`.
- Merged `dev` into `main` with regular `--no-ff` merge commit `7a4af47db653920526d813971b15edc47025cb4a` (parents `9187f1e86b0cbb1927edc3348cc649c6154cfd9c` and `f736a55aa99edfd8c033c43da981543df5512670`). Pushed and freshly verified `origin/main=7a4af47db653920526d813971b15edc47025cb4a`, `origin/dev=f736a55aa99edfd8c033c43da981543df5512670`, and `origin/HEAD=main`; `origin/dev` is an ancestor of `origin/main` and their file trees match.
- Returned to `dev`, tracking `origin/dev`. Worktree is clean except this untracked context file. Do not stage or commit `session-context.md`. Continue the larger product goal on `dev`; WP-11D is a completed partial slice, not final product completion.

## WP-01G SSH/Telnet prompt-coloring acceptance follow-up (2026-10-27)

- Continued on `dev` after WP-11D. Filled the dedicated remote-session acceptance gap for P-30: a Windows Electron E2E enables prompt coloring, connects to a trusted loopback SSH fixture and an acknowledged loopback Telnet fixture, checks `if` and `true` token colors under a `❯` prompt, then sends Ctrl+C and verifies decoration cleanup.
- The first run showed the test Telnet fixture had been echoing terminal-type subnegotiation (`XTERM-256COLOR`) into the prompt. The production prompt detector correctly declined to anchor once the prompt row was contaminated. Updated the fixture to strip IAC options/subnegotiation across socket chunks and echo printable user input only; no production behavior changed.
- Review found duplicated token-color assertions and a cleanup path that could skip fixture teardown if Electron close failed. Shared the color/Ctrl+C helpers across Git Bash, SSH and Telnet; nested cleanup finalizers attempt each Telnet socket and SSH client independently, close both servers, and remove the temporary profile.
- Updated ADR-0024, WP-01G results, implementation plan and feature matrix. P-30 remains PARTIAL for full shell grammar, wrapped input rows and broader interoperability.
- Final Windows acceptance after fixes: focused Git Bash, SSH/Telnet and keyword-highlighting suite passed 3/3. `corepack pnpm typecheck`, `corepack pnpm lint` including import boundaries, `corepack pnpm build`, and `git diff --check` passed. Build reports the existing 967.04 kB renderer chunk advisory. Static Spec review found no issues; final Standards review found no remaining breach or smell.
- Commits on `dev`: `3789e8a` (`test(terminal): cover remote prompt coloring`), `8643876` (`test(terminal): guarantee fixture cleanup`), `1d52076` (`test(terminal): isolate remote cleanup failures`), and `dcb37fd` (`docs(terminal): record remote coloring review`).
- Pushed and verified `origin/dev=dcb37fd8f9a4ae7afb3e303579916f190eb51dae`. Merged with `--no-ff` into `main` as `70889abd3fd11f3ef9c3d12ba3cdb37b9a6e55fd`; pushed and verified remote main and `origin/HEAD=main`. `origin/dev` is an ancestor of `origin/main`; tree IDs match. Returned to `dev`, tracking `origin/dev`.
- `session-context.md` remains untracked and must not be committed. Continue the larger project on `dev`; this acceptance slice does not complete the application or M4 release gates.

## WP-01H wrapped shell input coloring (2026-10-27, review/promotion in progress)

- Resumed on `dev` from `dcb37fd8f9a4ae7afb3e303579916f190eb51dae`. User instruction for this continuation: complete the feature before running its tests; proceed without approval checkpoints. Do not commit this context file.
- Added bounded reconstruction of active Shell input across consecutive xterm buffer rows only when continuation rows have `isWrapped=true`. The renderer preserves intermediate row padding for offset mapping, splits token ranges into per-row decorations, and bounds each refresh to 2,048 UTF-16 code units, 128 rows and 64 decorations. Wrapped row markers/decorations now belong to the prompt anchor and are removed on refresh, Ctrl+C and pane cleanup. When the row cap is exceeded, overlays stop without scanning more rows; the anchor can recover after returning within the bound only if the full wrapped chain still validates.
- Added ADR-0036, updated ADR-0024, ARCHITECTURE, FEATURE-MATRIX, IMPLEMENTATION-PLAN, WP-01G evidence and new WP-01H evidence. P-30 remains PARTIAL. Git Bash Readline horizontally scrolls long unsubmitted input; Windows acceptance uses ordinary Git Bash prompt coloring and asserts a single wrapped string token's color on separate SSH/Telnet xterm rows.
- A first WP-01H acceptance run found the Git Bash Readline behavior above; the test was corrected to match the shell behavior. Final checks on Windows 11 x64 / Node 24.14.1: `corepack pnpm build` passed (Vite's existing 968.36 kB renderer warning); typecheck passed; lint/import-boundary checks passed; focused unit suite passed 8/8; final focused Git Bash + SSH/Telnet wrapped input + keyword E2E passed 3/3; `git diff --check` passed.
- Commits on `dev`: `e7c105f` (`feat(terminal): color wrapped shell input`), `5bce86f` (`fix(terminal): recover coloring within wrapped input bounds`), `4a9cf8e` (`test(terminal): verify coloring across split tokens`) and `28779c2` (`docs(terminal): record WP-01H review outcome`). Initial Standards/Spec review findings (stale architecture text, duplicate waits, overflow anchor loss, outdated ADR wording and missing split-token color evidence) were fixed. Final follow-up Standards found no remaining breaches/smells; Spec found no remaining gaps, scope creep or incorrect behavior.
- Pushed and verified `origin/dev=28779c2de801e114a386afd7ec5c864666bb9f17`. Merged `dev` into `main` with regular `--no-ff` merge `750d0ad07a816a13aacc834c841910e6ca3031b5` (parents `70889abd3fd11f3ef9c3d12ba3cdb37b9a6e55fd` and `28779c2de801e114a386afd7ec5c864666bb9f17`). Pushed and freshly verified `origin/main=750d0ad07a816a13aacc834c841910e6ca3031b5`, `origin/dev=28779c2de801e114a386afd7ec5c864666bb9f17`, and `origin/HEAD=main`; `origin/dev` is an ancestor of `origin/main` and both remote trees match. Returned to `dev`, tracking `origin/dev`.
- Keep `session-context.md` untracked/uncommitted. This slice does not finish the app or release gates.

## WP-08F PowerShell editor syntax profile (2026-10-27)

- Continued on the user-selected `dev` branch from `28779c2de801e114a386afd7ec5c864666bb9f17`. User instruction: proceed without approval checkpoints and run tests after a complete feature, not between small tasks.
- Added the pure domain `powershell` syntax profile to the shared local/SFTP text editor. Auto detection handles `.ps1`, `.psm1`, `.psd1` and `.pssc`; manual profile selection is available. The bounded lexical scanner colors common command-position words, keywords, dash parameters/operators, variables, strings/here-strings, comments, numbers and simple type literals. Existing theme colors, accessible textarea, aria-hidden overlay, and 64,000-code-unit/4,096-token limits are reused; no package or content execution/persistence was added.
- Review fixes: the first Standards review found a few token lookaheads/ends could cross the preview boundary; guarded all relevant PowerShell scanners and added boundary regression coverage. A possible duplicated line-end scan was consolidated into `scanLineEnd`. The first Spec review found `Foo#Bar`/`Foo<#Bar#>` could be colored as comments; comment recognition now checks the preceding bareword state and unit tests cover both forms. Final Standards and Spec follow-ups found no remaining issues.
- Updated ADR-0023, added ADR-0037 and WP-08F evidence/review records, and updated architecture, security, feature matrix, spec, implementation plan and user guide. P-27/F-014 remain PARTIAL for wider language support and autosave; this is a lexical readability aid, not a PowerShell parser.
- Final Windows x64 validation after fixes: `corepack pnpm build` passed with Vite's 972.76 kB renderer-chunk advisory; `node --test tests/unit/text-syntax.test.ts` passed 10/10; `corepack pnpm typecheck` passed; `corepack pnpm lint` and import boundaries passed; focused local PowerShell + SFTP PowerShell Windows E2Es passed 2/2; `git diff --check` passed. An earlier build/typecheck overlap produced TS6305 due missing generated declarations; a forced project-reference rebuild restored outputs, and the final sequential typecheck passed.
- WP-08F commits on `dev`: `fdd3d39` feature, `60f047f` bounded-token/comment fixes, and `7f04e29` review record. Pushed and verified `origin/dev=7f04e294f1685ec2448ff6a51cdb0e3ac90a1fd7`.
- Merged `dev` into `main` with regular `--no-ff` merge `0e1182c917010d676e31fa3887e9a57fda1c6a1a` (parents `750d0ad07a816a13aacc834c841910e6ca3031b5` and `7f04e294f1685ec2448ff6a51cdb0e3ac90a1fd7`). Pushed and freshly verified `origin/main=0e1182c917010d676e31fa3887e9a57fda1c6a1a`, `origin/dev=7f04e294f1685ec2448ff6a51cdb0e3ac90a1fd7`, and `origin/HEAD=main`; dev is an ancestor of main and both remote trees match. Returned to `dev`, tracking `origin/dev`.
- Continue the broader project goal on `dev`; WP-08F is a completed partial slice, not final product completion. `session-context.md` remains untracked and must not be committed.

## WP-08G Python editor syntax profile (2026-10-27)

- Continued on `dev` from WP-08F `7f04e294f1685ec2448ff6a51cdb0e3ac90a1fd7`, following the instruction to complete a feature before running its test suite.
- Added a pure bounded Python text-syntax profile to the shared local/SFTP editor: automatic `.py`, `.pyw`, `.pyi` detection; manual profile selection; keyword and function/class declaration colors; documented Python built-in function/type colors; prefixed and triple-quoted strings; comments; numbers; operators. It uses the existing accessible textarea, aria-hidden token preview and semantic theme colors, bounded at 64,000 UTF-16 units and 4,096 tokens. No package, execution path, or persistence path was added.
- Python documentation used: official lexical reference and built-in functions reference. This is a lexical aid, not a parser; identifiers are ASCII-oriented, soft-keyword contexts are not parsed, and f-string contents stay opaque.
- Updated ADR-0023/0038, architecture, security, feature matrix, spec, implementation plan, user guide, and WP-08G result/review docs. The first review found a stale security statement about SFTP syntax highlighting and missing documented built-ins `complex`/`dir`; both were fixed. Final Standards review: zero violations and no smell findings. Final Spec review: no missing WP-08G behavior, scope creep or incorrect behavior. General review: no Critical/Important/Minor issues; ready to merge.
- Final Windows validation after review fixes: `corepack pnpm build` passed (Vite warns on 976.00 kB renderer JS chunk vs 500 kB threshold); `corepack pnpm typecheck` passed; `corepack pnpm lint` and import boundaries passed; `node --test tests/unit/text-syntax.test.ts` passed 13/13; focused local Python and SFTP Python Windows E2Es passed 2/2 in 40.1 sec; `git diff --check` passed.
- Commits on `dev`: `4f1e4ca3ae42d305e26f5a5e14ab6d87499a0fc4` (feature), `f58ae69f3f08b998b4154443fb8fa3be54e72c20` (review fixes and result) and `36829673af7b0da9950f88b976f8003e3e339bd0` (final review record). Pushed and verified `origin/dev=36829673af7b0da9950f88b976f8003e3e339bd0`.
- Merged `dev` to `main` with regular `--no-ff` commit `74d3501b07e27b74a1f370d21ae4ee8d87c845cf`, parents `0e1182c917010d676e31fa3887e9a57fda1c6a1a` and `36829673af7b0da9950f88b976f8003e3e339bd0`. Pushed and freshly verified `origin/main=74d3501b07e27b74a1f370d21ae4ee8d87c845cf`, `origin/dev=36829673af7b0da9950f88b976f8003e3e339bd0`, and `origin/HEAD=main`; dev is contained in main and remote file trees match. Returned to `dev`, tracking `origin/dev`.
- WP-08G remains one partial F-014/P-27 slice; broader language support, full parsing, and autosave remain open. Continue on `dev`. Keep this context file untracked and uncommitted.

## WP-08H JavaScript/TypeScript editor syntax profile (2026-10-27, promoted)

- Implemented and reviewed the bounded JavaScript/TypeScript lexical profile on `dev`: auto detection for `.js`, `.jsx`, `.mjs`, `.cjs`, `.ts`, `.tsx`, `.mts`, `.cts`; manual profile selection; token colors for keywords, declarations, common globals, strings/templates, comments, numbers, and operators. The preview remains a lexical aid with documented parser/JSX/regex/Unicode limits; no dependencies or execution behavior were added.
- Updated ADR-0023/0039, architecture, security, feature matrix, spec, implementation plan, user guide, and WP-08H evidence/review records. F-014/P-27 remain PARTIAL for broader language support, full parsing, and autosave.
- Final Windows x64 validation: `corepack pnpm build`, `corepack pnpm typecheck`, `corepack pnpm lint` with import-boundary checks, `node --test tests/unit/text-syntax.test.ts` (15/15), focused Windows Electron E2E (2/2), and `git diff --check` passed. Build retains the Vite renderer chunk size advisory. Standards, Spec, and general reviews reported no remaining actionable findings.
- `dev` commits: `7d6d03065337036afd1f137dac7022a053e0a4fd` (feature) and `8cbdec32b1c0b35bdf20ac972d9486a6b9f0121e` (review record). Pushed and verified `origin/dev=8cbdec32b1c0b35bdf20ac972d9486a6b9f0121e`.
- Promoted to `main` with regular `--no-ff` merge commit `2b6e4ace511905186d74e842f3019609e841c5dd`, parents `74d3501b07e27b74a1f370d21ae4ee8d87c845cf` and `8cbdec32b1c0b35bdf20ac972d9486a6b9f0121e`. Pushed and freshly verified `origin/main=2b6e4ace511905186d74e842f3019609e841c5dd`, `origin/dev=8cbdec32b1c0b35bdf20ac972d9486a6b9f0121e`, `origin/HEAD=main`; `origin/dev` is an ancestor of `origin/main` and both remote trees match.
- Returned to `dev`. Keep `session-context.md` untracked and do not commit it. The project is still in progress; continue the next slice on `dev` when resumed.

## WP-08I PostgreSQL-oriented SQL editor syntax profile (2026-10-27, promoted)

- Implemented bounded SQL lexical highlighting in the shared domain tokenizer and local/SFTP editor. Auto detection covers `.sql`, `.pgsql` and `.psql`; manual selection is available. Tokens cover common keywords/literals/types, a fixed common-function set, quoted identifiers, standard/E/B/X strings, dollar-quoted strings, `$n` parameters, decimal/exponent numbers, nested block comments, line comments and common operators. The profile is PostgreSQL-oriented, lexical rather than a parser, uses ASCII-oriented name scanning and limits dollar tags to 63 characters. No dependency, execution or persistence path was added.
- Updated ADR-0040, architecture, security, specification, feature matrix, implementation plan, user guide, result and review records. F-014/P-27 remain PARTIAL for broader language support and autosave.
- Final Windows x64 checks: `corepack pnpm build` passed (existing 983.48 kB renderer-chunk advisory); `corepack pnpm typecheck` and `corepack pnpm lint` with import-boundary checks passed; `node --test tests/unit/text-syntax.test.ts` passed 17/17; focused Electron E2E passed 2/2. The local editor assertions cover SQL auto-detection/colors, opaque E/dollar strings, nested comments, both UI preview bounds, and full content retention; SFTP verifies `.sql` auto-detection and token categories with no unrequested shell. `git diff --check` passed.
- Initial General review identified a missing UI assertion for opacity/nested comments/bounds. Added those assertions in `d5373dd` and reran the focused Windows E2E (2/2), typecheck and lint. Final Standards found no breaches or credible smells; final Spec found no gaps, scope creep or incorrect behavior; final General review found no remaining Critical/Important/Minor issues. See `docs/results/WP-08I-review.md`.
- `dev` commits: `0d4f4b347aec960be9d8312cf87eed1b3f8d1cf8` (profile), `d5373dd0907f511dbc799093d569d899c7312716` (E2E coverage), and `5f5e1992e69b8c6e8dcaedbce1d0b38bd226855b` (review record). Pushed and freshly verified `origin/dev=5f5e1992e69b8c6e8dcaedbce1d0b38bd226855b`.
- Merged into `main` with regular `--no-ff` merge `70d09d08e46b8d84cf52a41cbc5f9eeee0043f05` (parents `2b6e4ace511905186d74e842f3019609e841c5dd` and `5f5e1992e69b8c6e8dcaedbce1d0b38bd226855b`). Pushed and verified `origin/main=70d09d08e46b8d84cf52a41cbc5f9eeee0043f05`, `origin/dev=5f5e1992e69b8c6e8dcaedbce1d0b38bd226855b`, `origin/HEAD=main`; dev is an ancestor of main and remote tree IDs match. Returned to `dev` tracking origin/dev.
- `session-context.md` remains untracked and must not be committed. The larger product remains in progress.

## WP-08J TOML editor syntax profile (2026-10-27, review/promotion in progress)

- Resumed on `dev` at `5f5e1992e69b8c6e8dcaedbce1d0b38bd226855b`. Added a bounded pure-domain TOML lexical profile, `.toml` auto-detection and manual selection in local and SFTP editors. It colors bare/quoted and dotted/table keys, four string forms, common numbers, booleans/special floats, date/time values, comments, and table/array punctuation. No dependency, validation, execution, persistence, or content mutation was added.
- The shared scanner retains 64,000 UTF-16 code-unit and 4,096-token bounds. Bare-key classification is ASCII-oriented; dotted-key assignment lookahead is capped at 512 code units. ADR-0041 and architecture, security, specification, feature matrix, implementation plan and user guide were updated. F-014/P-27 remain PARTIAL.
- Unit coverage checks auto extension selection, strings including escaped/trailing quote cases and comment opacity, numeric/date-time/literal values, dotted/quoted/table keys and both bounds. Windows E2E covers local manual profile selection, local `.toml` auto-detection and SFTP `.toml` auto-detection.
- First full validation exposed a lint-only unused variable and a split space-separated date/time token; both were corrected before final validation. Final Windows x64 checks passed: build, typecheck, lint/import-boundary, `node --test tests/unit/text-syntax.test.ts` (19/19), focused Playwright (3/3) and `git diff --check`. Build retains a Vite advisory at 986.19 kB for the renderer JS chunk.
- Feature/evidence commit: `354ea9cff0d11d6aec1406d6ebf208f9831ca4bd`. It is local on `dev`, ahead of `origin/dev` by one. Independent General, Standards and Spec reviews are underway. Do not commit this `session-context.md` file.
- Spec review follow-up: it found missing support for the valid space-delimited Z offset datetime and no Windows UI assertion for TOML preview caps. Both are fixed in the current worktree; rerun final slice validation and review before pushing and promoting.
- Follow-up fixes from the initial review: the scanner now colors valid space-separated Z/z offset timestamps, unit coverage includes that form, and the local TOML E2E asserts the 4,096-token cap while confirming the full file remains in the textarea and preview. Follow-up Windows validation passed build (986.20 kB renderer bundle advisory), typecheck, lint/import-boundary, unit 19/19, focused local/SFTP E2E 3/3, and diff-check. Initial review findings are addressed; request final review of the complete feature before pushing.
- Standards-review cleanup: removed a redundant full-match TOML date-time regex branch because the general date-time pattern already covers it; retained the separate prefix matcher used to consume space-separated timestamps. Targeted follow-up typecheck, lint/import-boundary, domain unit 19/19 and diff-check all pass. Cleanup commit: ec392c55ce8cdd3df5a4f4b4ceb7967c2cbe4c40; pending Standards confirmation, review record, push and merge.

## WP-08J TOML editor syntax profile (2026-10-27, promoted)

- Final review found no remaining Standard or Spec findings. Initial reviews identified two Minor/Spec gaps (space-separated `Z`/`z` offset timestamps and missing TOML UI cap E2E) and a possible duplicate full datetime matcher. Commits `d6baf45` and `ec392c5` fixed these; final General/Spec reviews approved, Standards confirmed no breach or remaining smell.
- Final Windows x64 verification: build passed (986.20 kB renderer chunk; Vite's existing >500 kB advisory), typecheck, lint/import-boundary, domain unit 19/19, focused local/SFTP Playwright E2E 3/3, and diff-check passed. After the final regex cleanup, typecheck, lint/import-boundary, domain unit 19/19 and diff-check passed again. Result and review records are under `docs/results/WP-08J-*`.
- Commits pushed to `dev`: `354ea9cff0d11d6aec1406d6ebf208f9831ca4bd` (TOML profile), `d6baf45` (space-offset and UI-bound fix), `ec392c55ce8cdd3df5a4f4b4ceb7967c2cbe4c40` (datetime matcher cleanup), and `93db14dd8d9d34ec21f788b792e0a2daca7ef821` (review record). Freshly verified `origin/dev=93db14dd8d9d34ec21f788b792e0a2daca7ef821`.
- Merged `dev` into `main` with regular `--no-ff` commit `52cc20e157d2d8d971396843bb6c3389fee1426e`, parents `70d09d08e46b8d84cf52a41cbc5f9eeee0043f05` and `93db14dd8d9d34ec21f788b792e0a2daca7ef821`. Pushed and verified `origin/main=52cc20e157d2d8d971396843bb6c3389fee1426e`, `origin/dev=93db14dd8d9d34ec21f788b792e0a2daca7ef821`, `origin/HEAD=main`, dev is an ancestor of main, and both remote trees equal `70675239611daa815a26e82114cffa1e44e4d079`.
- Returned to `dev`, tracking `origin/dev`. The only untracked file is this `session-context.md`; it remains uncommitted. F-014/P-27 remain PARTIAL and broader editor syntax profiles/autosave remain future work.
- Post-promotion documentation correction: updated the Feature Matrix summary paragraph to include WP-08J TOML and link its result evidence, then committed `05a0bfb` on dev and merged to main as `15ad608adda0968799a687ff51de3c8112b5f061`. Remote ancestry/tree equality verified, returned to dev. This docs-only change required no tests.


## WP-08K YAML editor syntax profile (2026-10-27, review/promotion in progress)

- Continued on `dev` from `05a0bfba12c3bd88125d5d761ec4324518d21779`. Added a dependency-free pure-domain YAML 1.2 lexical profile, `.yaml`/`.yml` auto-detection and manual selection in local and SFTP editors. Token categories cover mapping keys, quoted/plain scalar strings, core null/boolean/numeric values, whitespace-separated comments, flow punctuation, document markers/directives, tags, anchors/aliases and opaque block-scalar text. Implicit-key lookahead is capped at 1,024 UTF-16 code units; shared preview bounds remain 64,000 code units and 4,096 tokens.
- Updated `TextEditorContent`, theme token colors, ADR-0042, architecture, security, specification, implementation plan, feature matrix and user guide. F-014/P-27 remain PARTIAL. YAML support is lexical only; it does not parse/validate, execute or persist file text. Block indentation is an approximation.
- WP-08K implementation commits: `02d84533b56cbd8c703433ac28a41b76581e682f` (YAML profile), `4493f049de46d20d70ca494ed8c29559b6db53a9` (scalar/block context fixes), `f7f87590432f54164d02ae6abe00f5f67f77c9c7` (review fixes), and `7fc010cbd1d4550a016691f526c8c77145a161ed` (quoted adjacent flow-pair key). Review record commit: `82ef939740657ee46aebc335ccfd73ecae11b552`.
- General review initially found a quadratic malformed-input scan and missing SFTP preview-cap coverage; both were fixed. Standards review also found duplicate anchor/alias scanner loops; both now share one helper. Spec review found missing flow-sequence pair keys and nested compact-sequence block-scalar indentation; both are fixed with regression coverage. A final Spec pass found quoted JSON-like flow-pair keys with adjacent values; that case is now covered in domain, local-editor and SFTP-editor E2E. Final General found no remaining correctness, performance, security or architecture risks; final Spec found no gaps; final Standards found no breaches or possible smells. Reviewers did not rerun tests.
- Final Windows x64 verification after the last code fix: `corepack pnpm build` passed (existing Vite >500 kB renderer advisory; 991.59 kB JS before gzip), sequential `corepack pnpm typecheck` passed, `corepack pnpm lint` and import-boundary check passed, `node --test tests/unit/text-syntax.test.ts` passed 24/24, focused Playwright Windows Electron E2E passed 3/3, `git diff --check` passed. An earlier concurrent build/typecheck run caused a generated-declaration race; sequential typecheck passed. No dependencies added.
- Pushed and verified `origin/dev=82ef939740657ee46aebc335ccfd73ecae11b552`. Merged `dev` into `main` with regular `--no-ff` merge `8ba2715c98146409eaa684fddee4ff3ec58e30e0` (parents `15ad608adda0968799a687ff51de3c8112b5f061` and `82ef939740657ee46aebc335ccfd73ecae11b552`). Pushed and freshly verified `origin/main=8ba2715c98146409eaa684fddee4ff3ec58e30e0`, `origin/HEAD=main`, `origin/dev` is an ancestor of `origin/main`, and both remote trees are equal. Returned to `dev`, tracking `origin/dev`.
- WP-08K is one partial F-014/P-27 slice; broader profiles/autosave and other product/release work remain. Keep `session-context.md` untracked and never commit it. Continue project work on `dev`.

## WP-08L Markdown editor syntax profile (2026-10-27, promoted)

- Started on `dev` at WP-08K `82ef939740657ee46aebc335ccfd73ecae11b552`. Added a dependency-free, pure-domain CommonMark-oriented Markdown profile with `.md`/`.markdown` automatic detection and shared manual selection in local and SFTP text editors. Colors ATX heading markers, list/quote markers, thematic breaks, fenced-code delimiters/info/body, same-line code spans, simple emphasis, direct inline links and same-line HTML comments. Markdown remains lexical text coloring, not a parser or renderer.
- Preserved the existing 64,000 UTF-16 code-unit and 4,096-token limits. Each inline lookahead is limited to 512 code units and aggregate lookahead work is capped at 256,000 probe steps per preview. Exhaustion signals truncation; the editor keeps the full source editable and explains the Markdown work limit. Emphasis matching skips recognized inline code, links and comments and emits separate token colors for nested spans.
- Added regression cases for Markdown token classes, fenced-code opacity/closing rules, delimiter precedence inside code/links/comments, an inline link beyond 512 code units but within the overall preview, malformed-link aggregate-work truncation, and token/character bounds. Windows E2Es cover local auto/manual selection, style colors, token cap, full-text retention, complex-input notice, SFTP auto-detection, colors, cap, and full-text retention.
- Updated `TextEditorContent`, semantic token colors, ADR-0043, architecture, security, specification, implementation plan, feature matrix and user guide. F-014/P-27 remain PARTIAL for broader profile coverage and autosave. No package was added.
- Initial independent review found emphasis delimiter precedence, overlapping malformed-link lookaheads, an ineffective 512-lookahead test (link exceeded the 64k preview), a duplicate matrix summary, a broken results link, and repeated YAML/Markdown line-advance code. These were corrected with opaque-span precedence/token splitting, aggregate work budget/truncation messaging, an in-preview lookahead case, one matrix summary, shared `nextLineAfter`, a `MarkdownBlockMarker` type, and a committed review record. Final General/Spec reviews found no findings. Final Standards review found no hard breaches and documented one low-impact duplicated comment/link recognition smell across the scan, lookahead, and emission passes; it is retained as those passes have different responsibilities and is tracked in `docs/results/WP-08L-review.md`. Reviewers did not rerun tests.
- Final Windows x64 verification on `9cbfaa9c8b9519f0dbfe021ae620c465fbaf618f`: `corepack pnpm build` passed (renderer bundle 997.71 kB before gzip; existing Vite >500 kB advisory); sequential `corepack pnpm typecheck` passed; `corepack pnpm lint` and static import-boundary checks passed; `node --test tests/unit/text-syntax.test.ts` passed 28/28; focused Playwright command `corepack pnpm exec playwright test tests/e2e/foundation.test.ts --grep "local text editor auto-detects SQL|local YAML text editor auto-detects|local Markdown text editor auto-detects|SFTP sessions verify trust" --reporter=line` passed 4/4 in 1.9 minutes; `git diff --check` passed.
- WP-08L commits pushed to `dev`: `95e9d1bc0d35ab9b744efe47371e819a4b1b8103` (profile/docs/tests/results), `06749391f830259508e516606901bcaa6b1a70a7` (aggregate bounds/review fixes), `9cbfaa9c8b9519f0dbfe021ae620c465fbaf618f` (inline precedence), and `56a38b827552be447be30ad7695f772a333b5155` (review record). Fresh remote verification found `origin/dev=56a38b8`.
- Merged `dev` to `main` with regular `--no-ff` merge `dc30d403bad54caa1274539511682fff1d08eb9a` (parents WP-08K `8ba2715c98146409eaa684fddee4ff3ec58e30e0` and dev `56a38b827552be447be30ad7695f772a333b5155`). Pushed and verified `origin/main=dc30d40`, `origin/dev=56a38b8`, `origin/HEAD=main`, dev is an ancestor of main, and trees match. Returned checkout to `dev`, tracking `origin/dev`.
- `session-context.md` remains untracked and must never be committed. WP-08L is a partial F-014/P-27 slice; continue the next documented slice on `dev` and keep release/feature statuses evidence-based.

## WP-01I Shell command grammar coloring (2026-10-27, reviewed; promotion in progress)

- Worked on `dev` after WP-08L. Added a fixed, bounded common Bash/Zsh builtin list and separate green token color, plus lexical handling for `[[`, contextual `]]`, `!`, `time`, and selected command wrappers (`sudo`, `doas`, `env`, `nice`, `nohup`, `command`, `builtin`, `exec`) with known option arguments. Shared pure-domain tokenizer powers the local/SFTP editor preview and terminal prompt decorations. No shell/PATH probing, command execution, dependencies or terminal-byte changes. P-30/F-014 remain PARTIAL.
- Independent reviews found issues during follow-up: `[[` expression state, `]]` context including isolated `]]`, and wrapper assignment values including quoted/expanded values. Fixed each and added token regressions. Consolidated duplicate wrapper reset state and E2E glyph/color assertions. Final General, Spec and Standards reviews found no remaining findings or smells.
- Final Windows checks on `e58ed7298239f9d4055d18a4ecd149088f0299d1`: `corepack pnpm build` passed (renderer 999.10 kB minified / 274.16 kB gzip; existing Vite >500 kB advisory); forced project-reference rebuild and sequential `corepack pnpm typecheck` passed; `corepack pnpm lint` and import-boundary checks passed; `node --test tests/unit/text-syntax.test.ts` passed 33/33; focused Electron Playwright cases passed 4/4 for local/SFTP editor previews, Git Bash, and SSH/Telnet; `git diff --check` passed. Reviewers did not rerun tests.
- WP-01I commits on `dev`: `f76c19d` feature, `bedb782` conditional test state, `f2f8b51` assignment preservation, `e58ed72` closing-marker context guard, `3d6c0b3` review outcome/docs. See `docs/results/WP-01I-shell-command-grammar-coloring-2026-10-27.md`, `docs/results/WP-01I-review.md`, and ADR-0044.
- Still open: full Shell parsing, explicit continuation prompts, shell-specific aliases/functions, heredocs, broad interoperability and other P-30/F-014 scope. Keep `session-context.md` untracked and never commit it.
- WP-01I was pushed and verified: `origin/dev=3d6c0b3d2db87d4504cb39d781b20c3749ce2bd4`. Merged with regular `--no-ff` commit `6cb34abd5be3902982d9dfc0cd7e64cc89773d20` (parents `dc30d403bad54caa1274539511682fff1d08eb9a` and `3d6c0b3d2db87d4504cb39d781b20c3749ce2bd4`), pushed and verified `origin/main=6cb34ab`; `origin/HEAD` points to main, dev is an ancestor, and remote trees match. Returned to `dev`, tracking `origin/dev`. The only untracked file remains this session context; do not commit it.

## WP-01J Shell backslash continuation coloring (2026-10-27, promoted)

- Added a bounded pure-domain Shell tokenizer state for unquoted odd trailing backslashes and carried only lexical flags across a visible prompt ending in `>`. State is per TerminalPane and cleared on completed/empty PS2 submission, Ctrl+C/D/L, failed input/paste, disabled preference, read-only/disconnected state, prompt mismatch or teardown. No command text is carried, persisted, logged or executed. Existing bounds and serial exclusion remain; quoted/multiline Shell forms remain unsupported. P-30/F-014 remain PARTIAL.
- Review follow-up fixed an even-backslash suffix-rescan error and stale state on anchorless Enter. Prompt suffix ambiguity with a custom primary prompt ending in `>` is documented. Added Git Bash PS2 E2E for token colors, command execution, empty PS2 cleanup and next builtin color; prompt input is explicitly refocused after Ctrl+C.
- Final Windows x64 validation: unit tests 45/45; forced TS project-reference rebuild and sequential typecheck; lint/import boundaries; build; focused Git Bash E2E 1/1; `git diff --check` all passed. Existing Vite renderer chunk advisory remains.
- General review initially found empty PS2 state retained; fixed before final review. Final General found no Critical/Important findings; Spec found no gaps or scope creep. Standards found no hard breaches; one minor duplicated preview setup smell is tracked and retained to avoid a helper for two distinct result shapes.
- Commits: `34a74d3` feature, `6ba91fd` empty-PS2 lifecycle fix, `fbe84d2` review record. Pushed `dev` and verified `origin/dev=fbe84d2fe587038b7d1c9884249a25a76fa6213f`.
- Promoted to `main` with regular `--no-ff` merge `6f51af07c10e649ca6c3b4f339348f36414fdce2` (parents WP-01I `6cb34abd5be3902982d9dfc0cd7e64cc89773d20` and WP-01J `fbe84d2fe587038b7d1c9884249a25a76fa6213f`). Fresh verification: `origin/HEAD=main`, dev is ancestor of main, both trees `5c9449439989a0324610d2b2d9d2e06859cbd5fb`. Returned to dev.
- `session-context.md` remains untracked/uncommitted. Continue with WP-01K: reuse the existing bounded PowerShell tokenizer for opt-in terminal prompt coloring.
## WP-01K PowerShell terminal prompt coloring (2026-10-27, reviewed and promoted)

- On `dev`, reused the existing bounded pure PowerShell tokenizer for active input at the common `PS <path>>` prompt. The existing opt-in preference/schema remains compatible. Added theme mapping for PowerShell command, keyword, parameter, string, variable, comment, operator, number and type tokens. PowerShell prompt anchors do not inherit Shell backslash-continuation state; bare `PS>` and secondary `>>` prompts are excluded. Work stays within the existing 2,048-code-unit, 128-row, 64-decoration bounds and transient xterm cleanup; no dependency, IPC, command probing, execution or persistence was added.
- Settings text/help, USER-GUIDE, ARCHITECTURE, SECURITY, FEATURE-MATRIX, IMPLEMENTATION-PLAN, ADR-0046 and acceptance/review records were updated. P-30 remains PARTIAL. The visible path prompt is a heuristic: custom prompts with the same shape are indistinguishable; other formats and continuation syntax are unsupported.
- Added prompt-profile unit coverage and Windows PowerShell E2E for command/parameter/variable colors and Ctrl+C cleanup. First E2E attempts typed after the process showed “running” but before xterm received its prompt; temporary tagged diagnostics confirmed the buffer was empty. The test now waits for a visible `PS …>` prompt. All temporary instrumentation was removed. A review follow-up also required a non-empty path to avoid classifying bare `PS>` as PowerShell or generic Shell, removed raw terminal text from E2E failure messages, and centralized token-color assertions.
- Final validation after the fixes: `node --test tests/unit/terminal-highlights.test.ts tests/unit/text-syntax.test.ts` 46/46; `corepack pnpm typecheck` passed; `corepack pnpm lint` passed including import-boundary checks; `corepack pnpm build` passed (existing Vite large-chunk advisory: 1,001.86 kB minified / 274.95 kB gzip); focused PowerShell Windows E2E passed 1/1; `git diff --check` passed. Reviewers did not rerun checks.
- Independent General review: no findings, ready to merge. Spec review: no findings after rejecting bare `PS>`. Standards review: no breaches or possible smells after removing raw terminal output and sharing assertions. See `docs/results/WP-01K-review.md`.
- Commits on `dev`: `0beea8e` feature, `c8a14db` review fixes, `9fd34a7` review documentation. Pushed and verified `origin/dev=9fd34a780a5390beb4e9c2430efc5bfc27ee2fac`.
- Promoted with regular `--no-ff` merge `014961085cb4be494b2f93e6d659bfe3dcde84e8`, pushed and verified `origin/main=014961085cb4be494b2f93e6d659bfe3dcde84e8`, `origin/HEAD=main`, dev is an ancestor of main, and both remote tree IDs are `79d92e7701729c59042aad33f4cabb0dffac6285`. Returned to `dev` for continued work.
- This file remains untracked and must not be committed.

## WP-01M natural PowerShell continuation coloring (2026-10-27, reviewed and promoted)

- Continued on `dev` after WP-01L. Added bounded domain continuation flags after selected natural trailing pipeline, binary, assignment, logical and array-separator operators. Strings/comments, escaped operators, and truncated previews do not start continuation state. The renderer continues to route only to an exact `>>` prompt at an unambiguous input end, with no command-text retention, IPC or persistence. P-30 remains PARTIAL; open-delimiter tracking, leading-pipe paste, other natural forms and full PowerShell grammar remain unsupported.
- Added regressions for natural operators and a Windows E2E for `Get-Process |`, right-row command/parameter colors and Ctrl+C cleanup. Initial independent reviews found `&&`/`||` did not set command position for the next pipeline, docs understated assignment/logical operator support, and the results date line had trailing whitespace. Fixed command-boundary state and added unit checks proving right-hand command coloring for both operators; aligned Settings, user guide, feature matrix, architecture, security and ADR wording; linked Microsoft's pipeline-chain docs; removed trailing whitespace.
- Three independent read-only reviews confirmed the fixes. General/spec reviews found no remaining code issue; standards review found no architecture/security breach. Reviewers did not run tests. Review record: `docs/results/WP-01M-review.md`.
- Final validation after fixes: focused unit tests 54/54; `corepack pnpm lint` passed; forced TypeScript project build plus `corepack pnpm typecheck` passed; Windows x64 `corepack pnpm build` passed (existing Vite advisory: 1,004.55 kB minified / 275.62 kB gzip); focused PowerShell Windows E2E 1/1 passed; full WP-01M diff passed `git diff --check`.
- Commits on `dev`: `78a481e` feature, `fcc662f` pipeline-chain review fix/docs, `4aaee8a` review and validation record. Pushed and verified `origin/dev=4aaee8a4b88ae6b4851a01d6cb9f0460a9186a62`.
- Promoted with regular `--no-ff` merge `ee082908f3ff420f1aadec25978946acbbb5a8e7` (parents WP-01L main `e1209cc878b5f2f09b3ffdd4eb0360cc721cd86b` and dev `4aaee8a4b88ae6b4851a01d6cb9f0460a9186a62`). Pushed and verified `origin/main=ee082908f3ff420f1aadec25978946acbbb5a8e7`, `origin/dev=4aaee8a4b88ae6b4851a01d6cb9f0460a9186a62`, `origin/HEAD=main`, dev is an ancestor of main, and remote tree IDs match at `5f83bd46ac6b7273a32417e50f05ac5abe0a3440`. Returned to `dev`.
- `session-context.md` remains untracked and must not be committed.

## WP-01N bounded PowerShell open-delimiter continuation coloring (2026-10-28, reviewed; promotion pending)

- Continued on `dev` after the reviewed WP-01M promotion. Applied local `codebase-design` guidance and checked Microsoft's `about_Parsing` and PowerShell 101 line-break guidance. Added a pure-domain continuation stack containing only expected closing `)`, `]`, `}` characters, copied and frozen on output, capped at 32 entries. No delimiter positions or command text are stored.
- Delimiters are tracked only as unescaped operator tokens outside strings/comments. Mismatched/unmatched closes, overflow, invalid incoming stack, incomplete quotes/here-strings and incomplete block comments fail closed. Renderer still carries the state only per terminal to exact `>>` at an unambiguous caret end; existing bounds and cleanup apply. No IPC, persistence, dependency, command execution or behavior outside coloring was added. P-30 stays PARTIAL; quoted continuation, leading-pipe paste, other prompt forms and full PowerShell grammar remain unsupported.
- Added unit coverage for parentheses, brackets, braces, nested multirow continuation, command/parameter colors, escapes, opaque text, invalid input state and depth limit. Windows E2E enters `$values = @(`, checks command/parameter colors across two `>>` prompts, closes the array expression and verifies return to the primary prompt and decoration cleanup. Updated ADR-0049, architecture/security, Settings help, user guide, implementation plan, feature matrix and result record.
- Final validation: focused unit suite 55/55; lint/import boundaries passed; forced TypeScript build plus typecheck passed; Windows x64 build passed (existing Vite advisory 1,005.32 kB minified / 275.91 kB gzip); focused PowerShell Windows E2E 1/1 passed; `git diff --check` passed. An initial typecheck caught a duplicate local variable in the new E2E; the name was fixed before the passing typecheck and E2E runs.
- Three independent read-only reviews: General found no Critical/Important/Minor issues and recommended merge; Spec found no findings or scope creep; Standards found no documented breaches or smells. Reviewers inspected results but did not rerun tests. See `docs/results/WP-01N-review.md`.
- `dev` commits: `0b62820` implementation and `93ee588` independent review record. The user explicitly authorized including this file in the current push, overriding the previous instruction to leave it uncommitted. This context update is staged and committed separately before pushing.
- User directed that after this task is committed/pushed to `dev` and merged into `main`, the goal and all further work be paused. Do not start another implementation phase after promotion.

## WP-03G Workbench settings templates (2026-10-28; resumed on dev-1)

- The user resumed the paused goal and authorized full permissions with all modifications restricted to `D:\PerigeaD\MultiRemoteTerminal`. Branches `main`, `dev-1` and `dev` were fetched/updated earlier; work is on `dev-1` at baseline `e24f2f2`. Keep commits and pushes only on `dev-1`; do not promote to `main`.
- WP-03G adds versioned, exact-schema Workbench settings template JSON through native save/open dialogs and the storage worker. Import produces an unsaved Settings draft; explicit Save changes persists it. The format excludes saved profiles and credentials, includes custom logo and PowerShell profile text, and never runs imported scripts. P-43 is VERIFIED for this workflow; F-018 remains PARTIAL until encrypted user-opt-in secret export is implemented and accepted.
- Validation: focused unit tests passed 120/120; typecheck, tools typecheck, lint, import boundaries and Windows build passed. After the Standards review fix, typecheck, lint, build and the Windows cross-profile Electron E2E passed again (E2E 1/1). The full unit run reported 530/532 passing: the package SBOM pin test cannot reach its intended pnpm assertion on installed Node 24.14.0 (repo pin 24.14.1), and the unrelated TFTP pending-open case timed out in both suite and isolated runs.
- Independent review: Standards found one Minor duplicate mapping, fixed through `loadPreferencesIntoDraft`; follow-up review found no remaining issue. Spec follow-up found no mismatch and confirmed P-43 VERIFIED/F-018 PARTIAL. Reviewers did not rerun tests. The E2E uses test hooks for native-dialog return values; direct OS picker UI/dismissal remains unverified.
- Electron E2E initially could not read the workspace Electron runtime under AppContainer. Added `ALL APPLICATION PACKAGES` read/execute permission only to the Electron `dist` directory inside this workspace; E2E then launched and passed with renderer sandbox enabled.
- Do not stage the user's pre-existing modifications in `AGENTS.md`, `pnpm-workspace.yaml` or `docs/agents/`. `.tmp/` and `.cache/` are workspace-local test/package-manager scratch and must be removed or left untracked. No WP-03G commit or push has been made yet.
