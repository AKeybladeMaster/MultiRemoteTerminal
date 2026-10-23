# MultiRemoteTerminal — Architecture & Codex Specification Pack

**Status:** Design baseline v1.0 · **Date:** 2026-10-23 · **Artifact type:** documentation only

MultiRemoteTerminal is an independent, Windows-first remote administration workbench. It aims to offer user-visible capabilities analogous to those listed for MobaXterm Home and Professional Editions while using original implementation, licensed third-party tools where allowed, and separate project branding.

This package contains **specifications, architectural contracts, and instructions for Codex**. There is no application source code, no copied third-party binaries, and no completed implementation.

## Read in this order

1. [`AGENTS.md`](AGENTS.md) — mandatory instructions for Codex, skill selection, architecture guardrails, Git protocol.
2. [`docs/SPEC-001-MultiRemoteTerminal.md`](docs/SPEC-001-MultiRemoteTerminal.md) — background, MoSCoW requirements, method, implementation, milestones, gathering results.
3. [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — clean-module design, IPC contracts, process model, data model, state machines, integration boundaries.
4. [`docs/FEATURE-MATRIX.md`](docs/FEATURE-MATRIX.md) — comprehensive Home/Professional feature coverage with delivery phases and tests.
5. [`docs/SECURITY.md`](docs/SECURITY.md) — mandatory security controls and threat model.
6. [`docs/SKILLS-PLAYBOOK.md`](docs/SKILLS-PLAYBOOK.md) — why/when to invoke the 14 installed skills.
7. [`docs/IMPLEMENTATION-PLAN.md`](docs/IMPLEMENTATION-PLAN.md) — sequenced Codex work packages, exit criteria, Git workflow.
8. [`docs/REA-OBSERVATION-PLAN.md`](docs/REA-OBSERVATION-PLAN.md) — optional black-box/reference-product evidence procedure.
9. [`docs/GLOSSARY.md`](docs/GLOSSARY.md) and [`docs/adr/`](docs/adr/) — shared vocabulary and decisions.
10. [`docs/CODEX-START-HERE.md`](docs/CODEX-START-HERE.md) — ready-to-paste initial Codex assignment.

## Chosen architecture at a glance

- **Windows 10 22H2 / Windows 11 x64 first.** Linux/macOS not in the first delivery scope.
- **Desktop shell:** Electron (stable security-patched release chosen and pinned when Codex initializes the implementation).
- **Renderer:** React + TypeScript + Vite + xterm.js; accessibility-first, keyboard-first dense UI.
- **Native terminal:** ConPTY through `node-pty` in an isolated local-terminal worker.
- **Remote connection engine:** `ssh2` adapter for SSH, SFTP, forwarding, and jump-host connectivity. Test optional OpenSSH subprocess provider later when hardware keys / external SSH config compatibility requires it.
- **Persistence:** SQLite with versioned migrations, WAL, database access owned by storage worker.
- **Secrets:** Electron OS-protected safeStorage for default mode, optional master-password encryption mode, never persisted in plaintext.
- **Structure:** modular monolith with a small set of process-separated workers; strict domain/application/adapters dependency direction.
- **Remote desktop, X11/XDMCP, Mosh, legacy protocols and network daemons:** capability modules behind explicit provider seams. These are part of the complete roadmap, not falsely labeled complete in MVP.

## Scope and terminology

**Full scope** describes long-term intended feature coverage. **MVP** denotes the first usable release and is deliberately smaller. No arbitrary application limits are imposed on stored sessions, tunnels, or macros; capacity is still bounded by memory, CPU, ports, file handles, and remote-server restrictions.

The comparison product's contractual benefits (subscription updates, enterprise deployment licensing, lifetime usage rights) are **not technical features to duplicate**; they are product policy decisions for this independent software.

## Official reference material

- MobaXterm editions: https://mobaxterm.mobatek.net/download.html
- MobaXterm features: https://mobaxterm.mobatek.net/features.html
- REA skill: https://www.skills.sh/morluto/rea/reverse-engineer-anything
- Electron security: https://www.electronjs.org/docs/latest/tutorial/security/
- Electron processes: https://www.electronjs.org/docs/latest/api/utility-process
- Terminal renderer: https://xtermjs.org/docs/
- Windows terminal PTY: https://github.com/microsoft/node-pty
- SSH engine: https://github.com/mscdex/ssh2

## Independence and rights

Never copy MobaXterm source, binary assets, icons, logos, internal scripts, profile text, or proprietary packaging; never patch its trial/licensing/edition restrictions. Use documentation and permitted black-box observation to define **functional behavior only**. Third-party tools are not bundled unless licensing, redistributability, provenance, and security updates are verified and documented.
