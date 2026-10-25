# WP-07H — N-002 Electron review follow-up

**Requirements:** N-002, P-32 and the M4 release gate. This slice closes two concrete security acceptance items; it does not complete N-002 or M4.

## Independent review findings

The independent review covered the changed fuse/package slice and the Electron security boundaries against Electron 45.0.0 guidance. It found no high or critical issue and confirmed renderer sandboxing, context isolation, disabled Node integration, custom protocol/CSP, navigation and permission denial, and typed sender/schema-validated IPC.

- **Medium, still open:** Installer and portable artifacts are unsigned. Electron fuses and ASAR integrity protect the package configuration, but publisher identity and resistance to post-build modification are not demonstrated without a valid publisher certificate and verified Authenticode signatures.
- **Low, fixed here:** Two E2E delay flags were read in packaged builds. Both now require an unpackaged app, `MRT_E2E=1`, and the exact explicit flag. The regression unit tests check both explicit opt-in and packaged denial.
- **Evidence still needed:** No hostile terminal-output test yet attempts filesystem or process access through renderer privilege injection. Windows 10, native credential-dialog/live SSH acceptance, and OS-wide offline behavior remain unverified.

## Change

- The first packaged regression run passed both delay flags to the installed executable and reproduced a saved-session operation that failed to complete within the expected window.
- Test-only delay activation now uses one shared guard. Existing cancellation E2E cases explicitly set `MRT_E2E=1`; packaged builds cannot activate these hooks even if that environment variable and the CLI flags are both present.
- The NSIS package smoke modifies a SHA-256 hash inside the installed ASAR header while keeping the archive parseable, launches the installed executable with a fresh profile, and verifies that the process exits within 15 seconds. The test then uninstalls the modified package.

## Validation

On Windows x64 with Electron 45.0.0, Node 24.14.1 and pnpm 12.15.0:

- Pre-fix regression run against the existing packaged artifact — reproduced the issue: the packaged save did not complete within 8 seconds after the session-create delay flag was supplied.
- `corepack pnpm exec node --test tests/unit/e2e-test-hooks.test.ts` — passed, 2/2.
- `corepack pnpm exec playwright test tests/e2e/foundation.test.ts --grep "timed-out saved-session write" --reporter=line` — passed, 1/1.
- `corepack pnpm typecheck` — passed.
- `corepack pnpm lint` — passed, including import-boundary checks.
- `corepack pnpm package:win:smoke` — passed, 4/4 packaged tests, including fuses, SBOM/hash verification, NSIS flow with explicit E2E delay flags, ASAR tamper termination, and portable startup.

The ASAR test follows Electron's documented Windows integrity mechanism: the executable embeds a SHA-256 hash of the ASAR header, and Electron terminates when integrity validation fails. See the official [ASAR integrity guide](https://www.electronjs.org/docs/latest/tutorial/asar-integrity), [Electron security checklist](https://www.electronjs.org/docs/latest/tutorial/security/) and [fuses guide](https://www.electronjs.org/docs/latest/tutorial/fuses/).

## Review

- Spec-axis review: no blocking requirements mismatch; P-32 and N-002 remain correctly partial.
- Standards-axis review: no documented-standard violation or actionable code smell.
- Independent Electron security audit: no high/critical boundary finding; unsigned distribution integrity remains medium and hostile terminal-output evidence remains open.

## Release status

N-002 remains partial until hostile terminal-output privilege-injection evidence is added and the medium unsigned-distribution gap is resolved. M4 also remains open for Windows 10 and other documented acceptance requirements. The current artifacts are not a signed public release.
