# WP-03G: Workbench settings templates

**Date:** 2026-10-28
**Requirements:** P-43; the non-secret settings-template portion of F-018.

## Delivered

Workbench settings can be exported and imported as versioned, exact-schema JSON through native file dialogs. Files are capped at 16 MiB; the storage worker writes exports through a sibling temporary file and atomic rename. Import returns a validated unsaved draft to Settings. The user must choose **Save changes** to persist it.

Templates omit saved sessions, credential references and vault entries. They include custom logo data and saved PowerShell profile text, which the UI warns users to review before sharing. Import does not execute the profile script.

## Windows validation

- `node_modules/.bin/tsc.cmd -b` and `node_modules/.bin/tsc.cmd -p tsconfig.tools.json` passed.
- `node_modules/.bin/eslint.cmd .` and `node scripts/check-boundaries.mjs` passed.
- Focused template, preferences, contract, broker and bridge unit tests passed: 120/120.
- `node scripts/build.mjs` passed on Windows x64. Vite emitted its existing chunk-size advisory above 500 kB.
- The settings-template Electron E2E passed: 1/1. It exported from one profile, imported to a fresh profile, saved, restarted, checked persistence, confirmed credential exclusion and verified the imported script did not run.
- The E2E stubs native-dialog return values to select its fixture file; direct operating-system picker interaction and dismissal are not independently verified.
- The complete `corepack pnpm test` unit run reported 530/532 passing. The SBOM pin test failed before reaching its pnpm assertion because this machine has Node 24.14.0 while the repository pins 24.14.1. The unrelated TFTP pending-open test timed out; it also timed out when run alone.
- `git diff --check` passed.

## Environment and status

Windows x64, Node.js 24.14.0, pnpm 12.15.0 and Electron 45.0.0. Electron initially could not read its workspace runtime under AppContainer; granting `ALL APPLICATION PACKAGES` read/execute access to the Electron `dist` directory inside this workspace allowed the E2E to launch. The renderer sandbox remained enabled.

P-43 is VERIFIED for Workbench settings-template export/import. F-018 remains PARTIAL until encrypted user-opt-in secret export is implemented and accepted. The TFTP timeout and Node version pin failure are outside this slice.

## Independent review

The Standards review found one Minor duplication: preference-to-state assignments existed in the initial load, save-success and import paths. All three now use the same draft-loading helper; the Standards follow-up found no remaining issue. The Spec review found no mismatch, confirmed P-43 VERIFIED and F-018 PARTIAL, and confirmed the native-dialog UI limitation above. Reviewers did not rerun tests.
