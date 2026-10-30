# WP-02F — loopback OpenSSH interoperability

**Date:** 2026-10-30
**Requirement:** P-03 SSH transport, host trust, and authentication.
**Status:** Partial acceptance evidence; one Windows x64 run passed.

## Setup and result

- Started the installed Git for Windows `sshd.exe` (`OpenSSH_9.7p1`, OpenSSL 3.2.1) as a temporary user process. Its configuration bound only to `127.0.0.1` on an ephemeral port. It was not installed or registered as a Windows service.
- Generated temporary Ed25519 server and client keys, an authorized-key file, SSH configuration, and per-test known-hosts data under ignored `.tmp/loopback-openssh-acceptance-20261030/`. The client private-key ACL was restricted to the current Windows user.
- The Windows OpenSSH client accepted the loopback host key into the test-only known-hosts file, authenticated with the generated key, and returned the expected remote-command marker.
- The MultiRemoteTerminal development app connected to the same loopback server using its SSH private-key flow. The test accepted the displayed host-key fingerprint, opened an SSH terminal, sent `echo MRT-OPENSSH-APP-OK`, and received the marker. One end-to-end run passed.
- A temporary E2E-only credential hook supplied the current Windows account name because the repository's existing SSH fixture uses a synthetic account that the real Windows SSH daemon rejects. That one-line hook change was reverted, and `corepack pnpm build` passed again with the stable source.
- The loopback server process was stopped and its listener closed. `netstat` showed only a `TIME_WAIT` socket. The current user's Bash history metadata still showed its pre-test timestamp; its contents were not read.

## Limits and remaining acceptance

This verifies one development-app public-key/terminal round trip against a real OpenSSH daemon on this workstation. It does not verify the real Windows OpenSSH agent service, the packaged native credential/key picker, SFTP against OpenSSH, other Windows versions, or broad server interoperability. P-03 remains PARTIAL.

Execution policy rejected deletion of the generated `.tmp` test directory, including its individual files. The stopped server's temporary keys, configuration, logs, and isolated app profile remain local under `.tmp`; do not stage or commit them. No external host was contacted.
