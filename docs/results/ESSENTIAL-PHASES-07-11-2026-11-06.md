# Essential Phase 07–11 continuation — 2026-11-06

Status: essential implementation integrated and frozen; final verification pending.

The user permits unverified dev-1 checkpoints after phase integration and defers
all automated tests/typechecks/lint/builds until the resumed implementation is
finished. Main promotion and release acceptance retain their existing gates.
This scope prioritizes essential functionality and correctness; it does not
remove any requirement or convert unavailable acceptance into a pass.

| Phase | Essential implementation disposition | Remaining acceptance/dependency |
|---|---|---|
| 07 | Per-start native SOCKS account, strict method-2 negotiation, no downgrade, transient credential ownership and pending-start cancellation; existing eight-hop/recovery code reused | BIND advertised-address/consent policy, UDP-capable remote transport, wider SSH interoperability and recovery acceptance remain PARTIAL |
| 08 | Existing approved fixed shell/provider controls and bounded PowerShell lifecycle reused; no speculative package installer | Real Windows lifecycle operation, signed provider provenance, ownership/license review and broader portable bundles remain PARTIAL |
| 09 | TFTP ignores early ACKs while reading and stale send callbacks; injected read regression authored | NFS/Cron/helper breadth remains absent; NFS toolchain, export/auth policy, port ownership and independent client required |
| 10 | Cleanup continues after individual provider failures; bounded storage shutdown retains genuine-exit cleanup barrier | Physical Windows lock, cross-account restore, power loss and broader security/recovery acceptance remain open |
| 11 | Existing hardened NSIS/portable, signature policy, SBOM/notices/checksum and smoke workflow reused | Windows 10, physical accessibility/display/hardware, legal/provenance and trusted publisher identity remain open |

## Static evaluation

Installed Matt Pocock codebase-design/code-review and Ponytail were read and
applied. Two independent read-only reviewers found zero Critical/Important
Standards/Security findings and zero Critical/Important Specification findings
in the scoped delta from `0bc54f84fa494f944188de8513c8ae1092b80707`.
Their reports distinguish source correctness from unrun Windows acceptance.
Historical Beasty skill paths were unavailable; those skills are not claimed.
The React delta uses existing form/IPC patterns, an accessible labelled checkbox
and primitive callback inputs; no library or speculative caching was added.

## Final gate (pending)

All planned essential source changes for this continuation are integrated. The
remaining full-product requirements above retain their PARTIAL/BLOCKED status.
The new Windows E2E uses genuine separate native SOCKS/SSH credential prompts,
checks method2, rejects bad credentials without opening a forward, verifies exact
binary bytes and scans renderer/console/closed profile for proxy credentials.
It also stops and rebinds the listener. The controlled SSH channel echo is not
public-server interoperability evidence. Native helpers add only an allowlisted
purpose selector and preserve process-tree scope and stdin credential transport.

Freeze intended code and run the pinned Node24.14.1/pnpm12.15.0 whitespace/type/lint/boundary/unit/build/
Electron gate, SSH integration where configured, advisory audit and Windows
package smoke sequentially. Keep TEMP/TMP and all generated logs under `.tmp`.
Record exact passes, failures, skips, artifact identity and final reviews here.
Existing Nov1 binaries predate this candidate. No test/build/package/signing
result is claimed by this implementation checkpoint.
