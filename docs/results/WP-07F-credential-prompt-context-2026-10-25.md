# WP-07F — Windows credential prompt context contract

**Date:** 2026-10-25
**Branch:** `dev-1`
**Requirements:** N-001/N-002 SSH credential prompt reliability and secret isolation; P-32 packaged resource validation.
**Status:** Partial; the prompt protocol and packaged resource checks pass, but the native dialog and a live SSH authentication remain unverified.

## Diagnosis

SSH connection requests passed an endpoint label such as `SSH destination: 127.0.0.1:2222` as part of the PowerShell helper's `-Message` value. The helper's `ValidateSet` accepted only the four fixed, context-free strings, so PowerShell rejected contextual requests before the helper emitted its JSON reply. The main adapter then returned `unavailable` without opening the credential dialog.

The minimized test failed before the change: `corepack pnpm exec node --test tests/unit/windows-credential-prompt.test.ts` reported that the expected helper JSON was empty. A direct PowerShell invocation confirmed a `ValidateSet` parameter error for the contextual message.

## Change

The adapter now passes a validated purpose (`ssh-password`, `ssh-key-passphrase`, `ftp-account`, or `master-password`) separately from optional endpoint context. The helper validates the purpose, bounds context to 256 characters, replaces control characters before display, and constructs the final user-facing message itself. Secrets remain exclusively in the native credential dialog response pipe; they are not command-line arguments or helper input.

The Windows credential prompt contract test runs the real Windows PowerShell 5.1 helper with a test-only `Get-Credential` stub. It verifies that the contextual request reaches the helper, the context is presented, and the helper returns a valid structured response. The packaged-app E2E also verifies `credential-prompt.ps1` exists in the installed app's resources directory.

## Validation

On Windows 11 x64 with Node.js 24.14.1 and pnpm 12.15.0:

- Before the fix, the focused test failed on the contextual SSH prompt path with no JSON response.
- After the fix, `corepack pnpm exec node --test tests/unit/windows-credential-prompt.test.ts` passed 6/6.
- `corepack pnpm typecheck` passed.
- `corepack pnpm lint` passed, including import-boundary checks.
- `corepack pnpm package:win:smoke` passed: installer, portable executable and SBOM checks all passed (3 packaged E2E cases). The installed app's credential helper resource was present; both release executables remain unsigned previews.

## Independent review

The Spec review found no mismatch or scope creep and confirmed the fix preserves the ADR's credential isolation requirements. It also confirmed that native-dialog, live SSH and independent security acceptance remain open. The Standards review found no documented-standard violations or baseline smells.

## Limits

The test stubs `Get-Credential`; it does not display or automate the native dialog. This phase does not establish password entry, live SSH authentication, host-key behavior against a real SSH server, Windows 10 compatibility, or a signed release. N-001/N-002 and M4 remain open.
