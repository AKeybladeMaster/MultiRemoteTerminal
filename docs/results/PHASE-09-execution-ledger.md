# Phase 09 execution ledger — network daemons and administration utilities

**Status:** PARTIAL; existing TFTP behavior has current suite coverage. Remaining daemon providers and their interoperability acceptance are blocked by missing provider/runtime evidence and unspecified behavior for Cron/helper utilities. No phase acceptance or review is claimed.

## Requirement trace

Phase 09 covers F-013, F-022, P-20, P-41, and related reliability/security evidence in N-001, N-002, and N-010. F-013 is Must; F-022 is Could. P-20 remains PARTIAL and P-41 is verified for TFTP only.

## Existing implementation and evidence

- WP-10A provides an opt-in, read-only TFTP server supervised in a utility worker. The listener and transfer sockets bind to IPv4 loopback; requests are bounded; writes, traversal, and oversized files are rejected; the opened file is checked against pre-open/post-open path metadata and its canonical path; runtime file-symlink rejection remains unverified. The selected root remains behind an opaque main-process token; renderer loss and app shutdown stop the worker.
- The Phase 08 full `pnpm check` run passed the two normal TFTP Windows E2Es: exact-byte transfer and unsafe-request rejection, plus renderer-crash cleanup. All 622 unit tests passed. This run did not enable the >360-second lifetime acceptance mode.
- Historical WP-10A evidence records the >360-second TFTP lifetime, eight active transfers and a bounded ninth-request rejection, a mixed pending-open admission test, restart/stop cleanup, and Unicode filename transfer. See [WP-10A results](WP-10A-loopback-tftp-2026-10-26.md) and [ADR-0026](../adr/ADR-0026-wp10a-loopback-tftp.md).

## Current environment and open requirements

- The inspected Windows 11 Pro Education host has no registered NFS service and no `crontab.exe`. The WSL query lists only Docker Desktop distributions. The Windows optional-feature query failed with a COM exception, so this is not evidence that an OS feature is absent.
- Microsoft's NFS deployment instructions require Windows Server systems for the Server for NFS role; the server feature catalog lists Server for NFS as a Windows Server role service. Windows 11 is therefore not an available first-party NFS server fixture. No licensed third-party Windows NFS server/provider or independent NFS client fixture is installed or approved. A Windows NFS client would not satisfy the local NFS daemon requirement.
- No Cron/helper daemon is implemented. The canonical WP-10 description does not define schedule syntax, job authorization, persistence, execution identity, or safe lifecycle semantics; implementing shell scheduling without those boundaries would add an unreviewed command-execution capability.
- TFTP file-symlink rejection remains unverified because this account cannot create a symlink. Broader interoperability and machine-to-machine exposure/isolation remain open. No TFTP lifetime acceptance was run in the current gate.
- No dependencies, system services, Windows features, or packages were added for Phase 09. No independent reviews or promotion occurred.

The provider limitation is based on Microsoft's [NFS deployment guidance](https://learn.microsoft.com/en-us/windows-server/storage/nfs/deploy-nfs) and [Windows Server feature catalog](https://learn.microsoft.com/en-us/windows/win32/wmisdk/win32-serverfeature). This evidence supports the host compatibility limitation; it does not establish third-party NFS server licensing or interoperability.

## Host resource refresh - 2026-10-31

- Read-only host inspection still finds Windows 11 Pro Education build 26200, no registered NFS-named service, and no `crontab.exe`. This does not establish that an optional Windows feature is absent; the earlier optional-feature query failed. No provider was installed or daemon acceptance run.

## WP-10B NFS provider research - 2026-10-31

- The primary-source comparison in [WP-10B research](WP-10B-nfs-provider-research-2026-10-31.md) found no provider ready for adoption. The npm TypeScript server has low observed use and no verified Windows client interoperability; the GPL-3 Windows service requires an administrator install and defaults to a wildcard bind; Hugging Face `nfsserve` documents missing `READDIR`, which Windows requires.
- `nfsembed` is the strongest follow-up candidate, not an accepted provider. Its documented Windows client path needs TCP and UDP port 111 ownership, its published artifact/source parity is unclear, and its authorization, lifecycle and native-client behavior have not been independently accepted.
- No dependency, service, or Windows feature was installed. No interoperability check ran. F-022/P-20 remain PARTIAL.

## Next actions

Audit an exact candidate release and dependency tree, establish a least-privilege port-111 and export policy, and arrange independent Windows-client interoperability before implementing NFS. Define safe bounded behavior for Cron/helper utilities before adding command execution. Keep F-022/P-20 PARTIAL and P-41 scoped to TFTP until those gates pass. Continue independent phases while these provider and specification gaps remain unresolved.

## 2026-11-01 NFS provider release identity follow-up

- Audited the exact `nfsembed 0.3.0` crates.io archive in workspace-local `.tmp`; the archive SHA-256 matches the registry checksum and its bundled source commit matches the GitHub `v0.3.0` tag. The normalized manifest and included license declare BSD-3-Clause; Rust 1.96 is required.
- This corrects the prior source/archive mismatch observation. No Rust toolchain is installed, so no Cargo build, transitive license review, Windows native test, or independent NFS client interop ran. Port-111 TCP/UDP ownership, unauthenticated AUTH_SYS policy, missing RPCSEC_GSS/Kerberos and absent independent client fixture remain adoption blockers. F-022/P-20 stay PARTIAL; no dependency was added.

## 2026-11-01 Phase 09 NFS next-action correction

- Updated WP-10B next actions to reflect that the exact 0.3.0 source/archive identity is now verified. Transitive dependency/license review, port-111 ownership and AUTH_SYS policy, Rust build, and independent Windows-client interoperability remain open; no provider was adopted.
## 2026-11-01 WP-10B host capability refresh

- Read-only checks found no `rustc`/`cargo`, no Windows `System32\mount.exe` or `nfsadmin.exe`, and no NFS/portmapper service. The only `mount.exe` on PATH is bundled with Git. WSL lists only Docker Desktop distributions. No toolchain, Windows feature, provider, or service was installed.
- This host cannot build the reviewed `nfsembed` candidate or provide Windows NFS-client interoperability; existing AUTH_SYS, port-111, and policy concerns also remain. Phase 09 stays PARTIAL; continue research or unrelated work without treating TFTP evidence as NFS acceptance.

## 2026-11-01 TFTP opened-path race hardening (unverified)

- `openRootFile` now rechecks `lstat` after opening and compares the path entry, opened handle, and canonical target identities before serving. Added a unit case for rejecting a file symlink; it skips only when Windows denies link creation. This closes the identified replacement window for paths that resolve to a different file or outside the selected root, but does not establish the Windows symlink acceptance gate.
- No tests or other automated checks ran. Phase 09 remains PARTIAL; retain the explicit Windows symlink-capability limitation until the phase gate.
