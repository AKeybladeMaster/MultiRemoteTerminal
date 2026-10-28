# WP-08O: Opt-in text editor autosave

## Requirement coverage

- F-014/P-27: local and SFTP editors now offer autosave for the current open file. It is off by default, waits one second after typing stops, and reuses the existing revision-checked save operation.
- On conflicts or other errors, the editor keeps the draft and stops automatic retries until another edit or explicit Save. Pending timers are cancelled on close, reload, or opt-out. The choice resets for each newly opened file and is not persisted.
- F-014/P-27 remain PARTIAL for broader syntax-profile coverage and terminal shell grammar.

## Architecture and security

- `TextEditorContent` owns the accessible checkbox; each editor dialog owns its opt-in state and timer alongside its existing local or SFTP save operation.
- No IPC command, worker interface, storage schema, app preference, logging format, dependency, or file-content path was added.
- Automatic writes occur only after the user checks the control and retain the existing local staging and SFTP revision-conflict protections.

## Validation

- `corepack pnpm typecheck`: passed, including the final E2E test changes.
- `corepack pnpm lint`: passed, including import-boundary checks.
- `corepack pnpm test`: **574 passed, 0 failed**.
- `corepack pnpm build`: passed on Windows x64. Vite reported the existing large renderer chunk advisory (1,015.41 kB minified).
- Focused local editor Windows E2E: **1 passed**; verifies autosave is off by default, explicit opt-in saves, an external replacement preserves the draft on autosave conflict, reload is explicit, and the option resets on reopen.
- SFTP loopback Windows E2E: **1 passed**; verifies explicit-save default, automatic save, conflict draft preservation, and reset on another file within the existing SFTP acceptance flow.
- `corepack pnpm package:win:smoke`: **5 passed**. ASAR checks, per-artifact SBOM and SHA-256 checks, offline NSIS install/uninstall at 200% scale, portable terminal workflow, and SSH-log shutdown passed.
- Independently recomputed every `SHA256SUMS.txt` entry: all matched. Installer and portable executable Authenticode status: `NotSigned`.
- `git diff --cached --check`: passed for the complete staged change.

## Independent review

- **Spec:** approved. The reviewer initially requested local autosave-conflict coverage; that Windows E2E case was added and re-reviewed. No remaining mismatch or scope creep was reported.
- **Standards:** no hard standards, architecture, or security breach was reported. A possible duplicated-code smell was noted for the short autosave timer effect in the local and SFTP dialogs. It remains a non-blocking judgement call: each dialog owns different save state and lifecycle gating, and a shared timer hook would add an interface for this small effect. Keep this as a low-priority cleanup candidate if the editor scheduling behavior grows.
