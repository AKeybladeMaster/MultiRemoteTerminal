# WP-07P - Credential boundary acceptance

**Requirements:** N-002 secret handling; supporting F-010/P-29 and F-018 profile-export behavior.

## Evidence

Focused IPC, broker, session, bundle and SSH controller suites:

- `node --test tests/unit/contracts.test.ts tests/unit/broker.test.ts tests/unit/session-folder-bundle.test.ts tests/unit/session-catalog.test.ts tests/unit/ssh-terminals.test.ts` - passed, 75/75. Coverage includes rejecting secret-bearing renderer requests and replies, preventing malformed requests from reaching the application, keeping rejected canary values out of broker audit events, rejecting secret-shaped saved session and bundle records, and opening SSH through a credential prompt without returning credentials in the session result.

Windows SSH credential E2E:

- `corepack pnpm exec playwright test tests/e2e/foundation.test.ts --grep "SSH credentials stay out of renderer" --reporter=line` - passed, 1/1. A loopback SSH fixture accepts the test-only password canary through the guarded credential prompt path. The test verifies successful authentication and terminal output, then saves a session, moves it into a folder and exports the folder. It checks the canary is absent from the renderer-visible page and renderer console during the flow, the main-process console through shutdown, the exported JSON, the saved SQLite row and every file under the temporary app profile after shutdown.

FTP credential E2E:

- `corepack pnpm exec playwright test tests/e2e/foundation.test.ts --grep "FTP shows plaintext risk, browses through the utility worker" --reporter=line` - passed, 1/1. The existing loopback FTP acceptance confirms the test password is absent from the page, the persisted saved profile has no username or credential reference, and the saved-profile reconnect succeeds against a server that requires the test password.

## Status and limits

This is scoped evidence, not closure of the broad N-002 release checklist item. Main-to-utility-worker SSH authentication IPC intentionally contains the password needed by the SSH provider; the rule verified here is that credentials do not enter renderer-facing IPC, persistence, exports or application console output. The E2E uses a fixed test-only prompt and trusted loopback server; it does not exercise the native Windows credential dialog, a real user password, crash dumps, every protocol's logging path, or all renderer event channels independently. FTP UI/database evidence is separate and does not include an FTP export/log scan. The broad all-flow gate and F-010/P-29 remain partial because saved credentials are not yet connected to the vault and the user-facing vault flow is unfinished.

## Review

Independent review of `012139b729d21d9aefef0ecda573ca40f6d42f22..54744af1bdd6d763d7cf0ff82e44f082e7d7a4a0`:

- **Spec:** No findings. The test and documentation scope match the recorded credential-boundary acceptance and leave the broad N-002, F-010 and F-018 requirements partial.
- **Standards:** No documented-standard violations, baseline smells or unsupported claims found. The main-console check runs after app shutdown.
