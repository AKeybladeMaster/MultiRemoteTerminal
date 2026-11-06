# WP-10B - NFS provider research

**Date:** 2026-10-31
**Status:** Research only; no provider selected or accepted. F-022/P-20 remain PARTIAL.

## Requirement and decision

Phase 09 tracks F-022, which lists NFS among the optional network daemons, and P-20. This review compared available NFS server options against Windows support, protocol behavior, lifecycle, security boundaries, and redistribution constraints. No dependency or service was installed, and no protocol interoperability was tested.

The best follow-up candidate is `nfsembed`, but it is not release-ready evidence for this product. Its published scope is NFSv3/MOUNTv3 over TCP; Windows discovery requires TCP and UDP port 111, which the embedding application must own. The crate does not provide RPCSEC_GSS/Kerberos, NFSv4, NFS-over-UDP, elevation, mounting, or process lifecycle. Its Windows native-client tests are project claims and have not been independently reproduced here. A remote, network-bound service would therefore need a reviewed authentication/export policy and a safe port-ownership design before adoption.

## Candidate review

| Candidate | Primary-source findings | Decision |
| --- | --- | --- |
| Microsoft Server for NFS | Microsoft's deployment page applies to Windows Server and installs Server for NFS as a server role. It recommends Kerberos for NFSv3/v4.1 and discourages AUTH_SYS/unmapped access. [Deployment guidance](https://learn.microsoft.com/en-us/windows-server/storage/nfs/deploy-nfs) | Not a first-party Windows client daemon for this app. This host's optional-feature query is inconclusive; do not infer that no optional feature exists from that failure. |
| `@legit-sdk/nfs-serve` | The npm package page lists MIT, 0.3.4 as latest, publication eight months earlier, four weekly downloads at review time, and one dependency. Its README claims full NFSv3 operations and a Node `fs/promises` backend, but the source/repository field is a placeholder in the published instructions. [Package metadata and README](https://www.npmjs.com/package/%40legit-sdk/nfs-serve) | Do not adopt on package claims alone. The low observed use is only a maturity signal; no Windows NFS client interoperability or source audit was established. |
| `RustNfsSvc` | Its repository labels the code GPL-3.0, requires Administrator for service installation, and documents TCP/UDP portmapper on 111. The sample listen address is `0.0.0.0:2049`. [README and license](https://github.com/tangramor/RustNfsSvc) | Do not bundle or install without legal approval, a least-privilege lifecycle design, and an explicit safe bind policy. |
| Hugging Face `nfsserve` | The repository is BSD-3-Clause but calls the implementation incomplete. Its README says `READDIR` is not implemented even though Windows insists on it, and describes Windows mounting as only partly working with unimplemented APIs. [Repository README](https://github.com/huggingface/nfsserve) | Reject for Windows acceptance in its current documented state. |
| `nfsembed` | The current repository declares BSD-3-Clause and Rust 1.96. Its README describes bounded NFSv3/MOUNTv3 over TCP and a managed shutdown API, but Windows requires the app to bind both portmapper sockets on port 111; RPCSEC_GSS/Kerberos, NFSv4, UDP data transport, elevation, mount execution, and process lifecycle are out of scope. The documented example selects AUTH_SYS. The repository claims Windows native-client coverage, but it has not been independently checked. | Keep as a research candidate only. Audit the exact published source and dependency tree, design a reviewed authorization policy and port-111 ownership model, then run native Windows and independent-client interoperability before acceptance. |

## Published `nfsembed` 0.3.0 follow-up - 2026-11-01

The crates.io API now lists 0.3.0 as the current release (published 2026-10-31), correcting the earlier docs.rs index result that showed only 0.1.0. Downloaded the exact 0.3.0 archive into the workspace-local `.tmp` directory and verified its SHA-256 against the registry checksum: `9bff9cdebd2a9c5babb88e27e5051736107cd4f692c372c89acc55c3cd401c77`. Its normalized manifest declares BSD-3-Clause and Rust 1.96; its bundled `.cargo_vcs_info.json` commit `3a311c7e1257e036540067de54bf295d34027f1e` matches the GitHub `v0.3.0` tag. The embedded license is BSD-3-Clause. The package has a Cargo.lock, but Cargo/Rust is not installed in this environment, so no build, transitive license review, Windows test, or independent-client interoperability was performed.

The release corrects source/archive identity but does not resolve product adoption blockers: it was published on 2026-10-31, its registry dependency requirements are not independently reviewed here, and its Windows path requires exclusive TCP and UDP ownership of port 111 while NFS-over-UDP and RPCSEC_GSS/Kerberos are unsupported. The optional-feature query remains inconclusive and no independent NFS client fixture is available. Do not add the crate or claim NFS acceptance on this evidence. F-022/P-20 remain PARTIAL.

Sources: [crates.io crate metadata](https://crates.io/api/v1/crates/nfsembed), [exact 0.3.0 archive](https://crates.io/api/v1/crates/nfsembed/0.3.0/download), [upstream v0.3.0 commit](https://github.com/mmikev/nfsembed/tree/v0.3.0), and the [published 0.3.0 README](https://docs.rs/crate/nfsembed/0.3.0).

The current repository's NFS implementation gap cannot be closed by a client-only Windows feature or by claiming a server from its README. A useful NFS daemon acceptance requires real client mounting and representative file operations against the exact shipped provider, alongside lifecycle, access-control, bounded-resource, shutdown, and Windows file-semantics evidence.

## Next actions

Keep F-022/P-20 PARTIAL. The exact 0.3.0 archive and its VCS tag identity are now verified. Before implementation, review the locked transitive dependency tree and licenses, decide whether the server can safely own TCP and UDP port 111 while meeting Windows discovery behavior, define the AUTH_SYS/export policy and secure bind default, and verify independent Windows-client interoperability. Rust/Cargo and an independent NFS client are unavailable here, so do not adopt the provider or change feature status from this research alone.
