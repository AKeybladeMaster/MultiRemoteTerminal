# WP-07Z — All-flow app-managed credential boundary review

**Date:** 2026-10-29
**Requirements:** N-002 secret handling; P-42 security policy; supporting F-010/P-29 and F-018 behavior
**Branch:** `dev-1`

## Review scope

Traced app-managed credentials and sensitive payloads from the Windows prompt through main-process handling, typed IPC, utility workers, persistence, exports and app diagnostics. Reviewed direct and saved SSH passwords, private-key passphrases and key bytes, OpenSSH agent usernames/signing, per-hop gateway passwords, standalone SFTP, FTP/FTPS accounts, vault master passwords, encrypted credential bundle passphrases, and the external RDP/VNC handoff. Also checked the separate Telnet, serial, macro, profile-script, file-editor and SSH session-log paths so their user-content behavior is not confused with credential exclusion.

This is a source review and scoped acceptance evidence for app-managed credential values. It is not a memory-forensics exercise, a review of OS-generated crash dumps, or proof against malware running as the same Windows user.

## Findings and boundaries

| Flow | Observed boundary | Evidence and limit |
|---|---|---|
| Native Windows credential prompt | The child process receives only a fixed prompt purpose and bounded display context in its arguments. Its `stderr` is ignored; a capped JSON reply arrives on `stdout`, temporary byte buffers are cleared, and only the provided result enters main-process memory. | WP-07F covers contextual prompt validation with a stubbed `Get-Credential`; production native prompting in a packaged build remains unverified. JavaScript strings cannot be guaranteed erased. |
| SSH password, saved password, private key/passphrase, agent and gateways | Renderer requests carry auth mode/profile IDs, not credential values. Main resolves prompts/vault values, then passes the required authentication data to the supervised SSH utility worker. Exact worker schemas reject extra fields; owned credential and key buffers are cleared after setup, and ssh2 config references are removed after connection. Failure replies contain allowlisted codes, not library messages. | WP-07P/WP-07R, WP-02A/WP-02B/WP-04I and WP-02E cover the relevant direct, saved, key, agent, gateway and changed-host flows with loopback or mock-agent fixtures. Installed Windows OpenSSH agent and disposable OpenSSH acceptance remain open. |
| SFTP and remote file contents | Standalone SFTP uses the SSH worker without opening a shell. File contents are carried only for the explicit user-requested file operation/editor; session definitions and diagnostics do not retain them. SSH session logs are offered only for terminal opens. | WP-02A and the SFTP transfer/text-editing E2Es cover bounded file flows. The server fixtures are loopback; hostile-server race limits remain in `docs/SECURITY.md`. |
| FTP/FTPS account and transfers | Main sends the prompted account to the FTP utility worker; the worker clears its request copy after `open`. The basic-ftp protocol logger is disabled and replaced with a no-op. Worker failures cross back as an error category and optional session usability flag, not raw server/library text. Saved profiles contain no account or credential reference. | The updated Windows loopback FTP E2E checks the canary is absent from page text, renderer console, main console, saved SQLite metadata and every file in the closed app profile after a reconnect. Plain FTP still sends credentials and file contents without encryption; the user must explicitly acknowledge the warning. |
| Credential vault and encrypted SSH bundle | Saved passwords are separate from session rows and stored through Windows account protection or the master-password encryption format. Renderer requests do not carry bundle paths/passphrases; the storage worker handles encrypted bundle bytes. Import binds each value to an exact saved SSH profile and does not overwrite. | WP-07K/L/R/S/T and WP-03H exercise encrypted storage, restart/lock/restore, renderer/storage boundaries and bundle export/import. Windows-account cross-user restore and DPAPI migration remain open. |
| Telnet, serial, RDP and VNC | Telnet accepts interactive terminal input over plaintext but has no app credential field or transcript logger. Serial has no credential field. RDP/VNC credentials remain in the external viewer; the workbench starts viewers with validated endpoints only, and VNC ambient credential environment variables are removed. | WP-09B/WP-08A/WP-08B and serial E2Es cover the documented handoff. Telnet is not suitable for secrets; external viewer/server authentication interoperability remains unverified. |
| General diagnostics and session logs | No persistent general-purpose log writer or external telemetry is installed by default. Storage diagnostics contain only fixed component/event/error-code values; the portable initialization console message is static. The distinct SSH session log is opt-in, native-path-selected and bounded; its typed records exclude native credential-prompt values, private-key bytes, SFTP file content and tunnel payloads. | WP-02C covers ordered lifecycle/I/O log records, credential exclusion, limits and shutdown. An opted-in SSH terminal transcript contains exact user input/output and endpoint metadata, which can include secrets; the UI warns before starting it. |
| User-authored content | Saved macros, explicit macro recordings and saved PowerShell scripts are separate user-content features, not diagnostic logs. Their text can contain secrets; macro recording omits paste and suppresses recognized prompts heuristically, and the UI warns users. Settings templates include saved script text with a sharing warning. | WP-06A/B1/B2 and WP-07V cover the opt-in and review flows. Prompt detection is heuristic; arbitrary secret prompts cannot be guaranteed to be recognized. |

No in-scope app diagnostic, profile, or unencrypted saved-session export path was found that stores app-managed SSH/FTP authentication values. These exclusions do not cover intentional network transmission: SSH/FTPS send authentication to the server, plain FTP sends it unencrypted, and Telnet sends all terminal input unencrypted.

## Verification

- After adding the FTP scan, `corepack pnpm check` passed with workspace-pinned Node `24.14.1` and pnpm `12.15.0`: typecheck, lint/import boundaries, 578 unit tests, 70 E2Es passed, and five package-only E2Es skipped by the general command. The package-only tests were skipped because this general check does not build/package Windows artifacts.
- Focused Windows FTP E2E with the new assertions passed 1/1, and it passed again in the full check. A preceding mixed SSH/SFTP/FTP invocation passed the SSH key and SFTP cases but hit one existing virtualized-list click timeout before reaching the FTP assertions; isolated and full-suite runs passed.
- An initial full-check invocation selected Node `24.14.0` and correctly failed the release-script version guard; rerunning with pinned Node `24.14.1` passed the complete check.
- All test-created temporary profiles and files for this run were redirected beneath workspace `.tmp`; build and Playwright output remains ignored.

## Status and remaining limits

This completes the repository source review and credential canary acceptance for P-42. It does not close N-002 or P-29: packaged native prompt behavior, physical Windows session locking, cross-account DPAPI migration, crash-dump behavior, broader privilege-injection acceptance and release signing remain open. The plain-text SSH transcript, user-authored scripts/macros and heuristic macro prompt detection retain the explicit risks above. No live or company SSH endpoint was contacted.

## Review

Independent Standards and Spec reviews found no blocking findings. Standards review requested that the profile canary scan avoid loading the 100 MiB FTP transfer into one allocation; the test now scans files as a stream while retaining a boundary overlap, and the focused FTP E2E passed after the change. The Spec review confirmed that renderer output is checked before close and main-console/profile contents after close. Neither reviewer ran tests.
