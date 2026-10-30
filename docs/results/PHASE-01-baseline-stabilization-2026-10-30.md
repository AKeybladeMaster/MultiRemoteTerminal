# Phase 01 — Development baseline stabilization

## Scope and requirements

- Mission phase: Phase 01, development baseline stabilization.
- Requirements tracked: F-014/P-27 editor regression baseline, P-32 package regression baseline, N-001, N-004, N-007 and N-010. This phase does not upgrade broader feature statuses.
- Reconciled work: WP-08R HTML syntax profile, WP-01E resize evidence, package-smoke startup readiness stabilization, and the full-suite large-editor input timeouts.
- Branch at start: `dev-1` at `d44c909c337807ce95d5b83e44ad48f50cf113ed`, verified equal to `origin/dev-1`; `origin/main` was `67812739ba521d57007e15faa24e0b5a09d56e06`. Protected worktree changes are excluded from the intended candidate.
- Phase implementation commit on `dev-1`: `c8acdc196839958251f590bea24b323b453ff257`.

## Implementation

- Added a bounded HTML lexical profile to the existing domain tokenizer for `.html`/`.htm`, with common tags, attributes, values, declarations, comments and text entities. Raw-text element contents stay opaque. The accessible textarea remains the source of truth; markup is never rendered or executed.
- Deferred expensive syntax highlighting until its input matches the current editor value. While a deferred render is pending, the preview uses current source text without stale tokens, keeping typing responsive without displaying an older file value.
- Corrected self-closing-tag detection to recognize only a parsed tag delimiter, not a trailing slash inside an unquoted attribute value. Added a unit regression for a URL ending in `/`.
- Stabilized the package-smoke helper by waiting for the initial selected terminal and shell prompt before counting newly launched tabs.
- Kept F-014/P-27 PARTIAL. HTML highlighting is lexical, bounded and not a document validator or renderer.

## Verification

Environment: Windows 11 Pro x64, OS build 26200; pinned Node.js 24.14.1 and pnpm 12.15.0; workspace-local `TEMP`/`TMP` under `.tmp/phase01-test-temp`.

| Gate | Result |
|---|---|
| `git diff --check` | Passed; only a line-ending warning was emitted for the protected `session-context.md`. |
| `corepack pnpm check` | Exit 0. Typecheck, lint and static import-boundary checks passed; all 585 unit tests passed; Windows x64 native and renderer build passed; E2E: 71 passed, 6 skipped, 0 failed. |
| Second `corepack pnpm exec playwright test` | Exit 0; 71 passed, 6 skipped, 0 failed. The slow `foundation.test.ts` file took 9.1 minutes; the full run took 9.4 minutes. |
| `corepack pnpm package:win:smoke` | Exit 0; 5 passed in 1.3 minutes. Validated ASAR/fuses, SBOM/hash manifests, offline NSIS at 200% scale and uninstall, portable launch/profile placement, and SSH log shutdown finalization. |

The six normal-suite skips are five package-only cases, which passed in the dedicated package-smoke command, and the known first Git Bash input immediately after window resize. That resize case remains open under F-002/P-02; it is not passing evidence. The initial pre-fix full suite had 68 passes, 6 skips and 3 failures (native-dialog focus and two large-editor fill timeouts). The final candidate passed two full E2E runs after the deferred-preview and parser corrections.

The final renderer build is 1,028.64 kB minified / 282.62 kB gzip and still exceeds Vite's 500 kB advisory. The installer and portable executable were built and smoke-tested but are unsigned (`NotSigned`); signing configuration and Windows 10 acceptance remain open. Artifacts are in ignored `artifacts/windows/`:

- `MultiRemoteTerminal Setup 0.0.0.exe`
- `MultiRemoteTerminal 0.0.0.exe`
- Per-artifact CycloneDX 1.6 SBOMs and `SHA256SUMS.txt`

## Independent review disposition

The initial WP-08R specification and standards reviews approved the profile after corrections. Phase 01's independent specification and standards reviews found stale historical status text and a timing-label discrepancy; both were corrected while preserving the initial red run as history. The implementation review found the unquoted-URL slash edge, which was corrected and covered by a unit regression. All three exact-candidate review axes rechecked the final evidence/code and approved it with no remaining findings.

## Promotion ancestry audit

The verified `origin/main..origin/dev-1` range at the start of this phase contained eight commits: `0012a86` editor preview virtualization; `32b1877` SSH fixture test hardening; `d594453` security settings; `d801f04` a docs-only resume refresh; `5532fa8` host-key rotation; `e99584d` native-dialog test-helper stabilization; `1182c96` credential-boundary review; and `d44c909` terminal input ordering plus the `re2js` security update.

The promotion audit found the range mission-related and found no blocker to Phase 01 promotion; this does not clear the known F-002/P-02 release blocker. The previously documented WP-02D, WP-02E, WP-07Z, WP-01E, WP-02F and WP-01F evidence covers the security, host-trust, credential, resize, OpenSSH and dependency slices. Static implementation review explicitly covered the virtualization, SSH fixture, picker-helper and terminal-ordering changes. The virtualization standards review covered `TextEditorContent.tsx` and its E2Es for component boundaries, rendering security/accessibility and maintainability; it was not a standards review of the full eight-commit range. The full Phase 01 E2E suite exercised the inherited work. `d801f04` changes only the handoff snapshot; it closes no requirement and is not counted as acceptance evidence. The current uncommitted `docs/CODEX-RESUME.md` edit remains excluded.

## Remaining phase limits

- The known Git Bash resize/input failure, shell/provider breadth, and 200% accessibility acceptance remain open for Phase 02.
- Package smoke is a Windows 11 x64 test build, not Windows 10, signed-release, public-server, physical-device, or full hardware acceptance.
- F-014/P-27 remain PARTIAL; no broad editor feature is marked VERIFIED by this syntax-profile slice.

## Phase disposition

**ACCEPTED.** Verification and exact-candidate reviews are green. Phase 01 may be promoted through the required normal merge after the current remote refs and explicit file set are rechecked. Keep user-owned `AGENTS.md`, `pnpm-workspace.yaml`, `docs/agents/`, `session-context.md`, and ambiguous pre-existing resume edits out of the candidate.
