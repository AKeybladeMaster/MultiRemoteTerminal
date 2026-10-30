# WP-08R: HTML editor syntax profile

## Requirement coverage

- F-014/P-27: local and SFTP editors auto-detect `.html` and `.htm` and provide a manual HTML profile.
- The bounded preview colors common tags, attributes, quoted/unquoted values, comments, declarations and text entities. Raw-text element contents remain opaque.
- F-014/P-27 remain PARTIAL for broader language coverage and remaining editor acceptance.

## Architecture and security

- The shared pure-domain tokenizer owns profile detection, token generation and the existing preview limits.
- `TextEditorContent` displays source only through its accessible textarea and escaped token overlay. It does not render HTML or execute script/event-handler content.
- The profile adds no package, IPC command, persistence, logging or file-save behavior. Existing local/SFTP revision checks and save paths are untouched.
- HTML source in attribute values stays opaque; raw-text element contents are skipped, including conditional `noscript` content, so embedded markup-looking text is not misidentified as page tags.

## Validation

- Red phase: the new detection and token tests failed before the profile was implemented.
- The initial WP-08R implementation had **50 text-syntax unit tests** and **584 total unit tests**; it passed typecheck, lint/import-boundary checks, and the Windows x64 build. This count predates the later URL-slash regression test.
- The final Phase 01 candidate, including the deferred-preview input fix and the unquoted-URL slash regression test, passed `corepack pnpm check` with exit code 0. This runs typecheck, lint/import boundaries, unit tests, Windows x64 native/renderer build and the full E2E suite in sequence; the final E2E stage reported **71 passed, 6 skipped, 0 failed**. The suite includes **585 unit tests**.
- A second direct `corepack pnpm exec playwright test` run on the same candidate exited 0: **71 passed, 6 skipped, 0 failed**; the slow `foundation.test.ts` file took 9.1 minutes and the full run took 9.4 minutes.
- `corepack pnpm package:win:smoke` exited 0: **5 passed**. It validated fuses/ASAR, per-artifact SBOMs and SHA-256 manifests, offline NSIS install/uninstall at 200% scale, portable startup/data placement, and SSH-log shutdown cleanup.
- The Windows x64 build reported the renderer bundle at 1,028.64 kB minified / 282.62 kB gzip, above Vite's 500 kB advisory. Distribution signatures are `NotSigned`.
- Focused Windows Electron E2E, `playwright test tests/e2e/foundation.test.ts --grep "local text editor auto-detects HTML|SFTP sessions verify trust and transfers"`: **2 passed**. Local editor acceptance verifies inert markup, automatic/manual profiles and unchanged source; the loopback SFTP acceptance verifies the same profile behavior and exact remote bytes.
- `git diff --check`: passed.

## Independent review

The initial WP-08R spec and standards reviews caught and led to fixes for HTML's ignored trailing slash on non-void raw-text elements, conservative opacity for `noscript`, and missing HTML profile notes in the architecture/security docs. The Phase 01 follow-up reviews found stale full-suite status text and a separate unquoted-URL trailing-slash coloring edge. Those records and the edge are corrected; exact-candidate follow-up review disposition is recorded in the [Phase 01 result](PHASE-01-baseline-stabilization-2026-10-30.md).

## Remaining limits

This is a lexical preview, not an HTML parser or validator. It does not highlight CSS/JavaScript, decode attribute entities or reproduce browser error recovery. Local/sftp syntax-preview E2Es use the guarded local path hook and a loopback SFTP fixture. F-014/P-27 remain PARTIAL.
