# WP-02B — SSH agent authentication evidence

## Implemented behavior

SSH terminal and standalone SFTP opens accept an explicit agent authentication mode. Renderer IPC and the application port carry the typed mode and username; neither includes a Windows pipe path. The composition root configures the fixed Windows OpenSSH pipe, `\\.\pipe\openssh-ssh-agent`, on the supervised SSH worker. Only the unpackaged, E2E-gated main-process hook can select a temporary pipe for its fixture.

The native credential prompt collects the account username and requires the password field to be empty. The SSH utility worker passes the validated pipe to pinned `ssh2@1.17.0` as its agent, selects public-key agent authentication explicitly, and sets `agentForward: false`. Main, application and worker clear mutable credential fields and temporary references after handoff or authentication. No private key bytes enter the app in agent mode.

The review follow-up keeps the Windows pipe endpoint out of the application authentication port and worker request. The main composition root supplies it only through the supervised utility worker environment; a bounded path validator lives with the Windows adapter. Startup preference IPC also omits the saved PowerShell script; only the explicit Settings read returns the full preference schema.

## Acceptance evidence

- Windows Electron E2E creates a temporary local named pipe implementing the OpenSSH agent protocol with `ssh2.AgentProtocol`, plus a loopback SSH server using the same pinned `ssh2` package. It verifies identity enumeration, an agent signature accepted by the SSH server, first-use host approval and terminal output. The test also confirms one username-only prompt and that the pipe path and private key do not appear in renderer-visible text.
- The same E2E then opens a standalone SFTP files-only session using the agent, lists a fixture file, observes another signed authentication request, and confirms no additional shell request was made. This covers the agent authentication route through the UI, main broker, controller, worker and SFTP subsystem.
- The E2E fixture accepts the matching unsigned public-key probe before verifying the subsequent signed request. Its first run incorrectly rejected the probe; after aligning the fixture with SSH public-key authentication, the red-capable E2E passed.
- The Windows OpenSSH Authentication Agent service on this machine is stopped and disabled; `SSH_AUTH_SOCK` is unset. The service was left unchanged. The mock-agent test does not prove interoperability with that real service or satisfy the disposable OpenSSH fixture requirement.
- Standalone SFTP private-key auth is covered by the broker/controller/worker path but has no E2E evidence.

## Validation

- `corepack pnpm typecheck` — passed.
- `corepack pnpm lint` — passed, including import-boundary checks.
- Focused SSH, broker, contract, worker-protocol and credential-prompt unit tests — 108/108 passed; follow-up controller and Windows helper tests — 22/22 passed.
- `corepack pnpm build` — Windows x64 build passed. Vite reports the existing renderer bundle size advisory (956.81 kB).
- Review follow-up validation: the focused SSH, broker, IPC, TFTP, and preference suite passed **172/172**; typecheck and lint passed. Windows agent-auth and the PowerShell settings/preview E2Es both passed (**1/1** each).
- `corepack pnpm exec playwright test tests/e2e/foundation.test.ts --grep "SSH agent mode" --workers=1` — 1/1 Windows Electron E2E passed, covering terminal agent auth and standalone SFTP agent auth.
- `git diff --check` — passed.

## Status and limitations

P-03/F-003 remains PARTIAL. The actual Windows OpenSSH agent service, a disposable OpenSSH server, standalone SFTP private-key authentication, packaged native credential prompting, agent authentication through gateway routes, and broader interoperability remain unverified. Do not treat the same-library mock fixture as OpenSSH acceptance.

## Review results

- General review of `3d638a1` found no Critical, Important or Minor implementation issues and approved this as a partial slice. It recommended standalone SFTP agent E2E, real Windows OpenSSH-agent and disposable OpenSSH acceptance, packaged prompt coverage, gateway-route acceptance and broader interoperability.
- Standards review found no documented-standard breach. It noted duplicate pipe-selection checks and repeated credential cleanup branches as judgment-call smells across process boundaries.
- Spec review found no behavior mismatch. Follow-up review of `f3b0be8` confirmed standalone SFTP agent E2E coverage, then identified stale wording in `docs/SECURITY.md`; that sentence now distinguishes mock-agent coverage from the remaining real-service and disposable-server gaps.
