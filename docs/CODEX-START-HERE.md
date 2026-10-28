# Ready-to-paste Codex Project Brief

You are implementing MultiRemoteTerminal in
`https://github.com/AKeybladeMaster/MultiRemoteTerminal.git`
on a Windows developer workstation.

When resuming on another PC, read [the current resume snapshot](CODEX-RESUME.md) for verified branch, test, and artifact state. The specification and project documents below remain authoritative.

**At each task:** inspect the current branch, worktree, remote refs and latest result records. Read the entire `AGENTS.md`, `docs/SPEC-001-MultiRemoteTerminal.md`, `docs/ARCHITECTURE.md`, `docs/SECURITY.md`, `docs/FEATURE-MATRIX.md`, `docs/IMPLEMENTATION-PLAN.md`, `docs/GLOSSARY.md`, and relevant `docs/adr/` decisions before changing code. Treat the documentation as the design baseline, then verify current source and test evidence; preserve completed work and continue with the next open slice.

Use the installed skills in `C:\Users\Beasty\.agents\skills\` by reading each relevant `<skill>/SKILL.md`:
- `codebase-design` for modules/interfaces;
- `grill-with-docs` if material decisions are unresolved;
- `frontend-design` for the UI;
- `reverse-engineer-anything` only for permitted reference-product evidence not resolved by public sources;
- `requesting-code-review` + `code-review` after each implementation slice;
- `diagnosing-bugs` for reproduced defects;
- `ui-taste`, `web-design-guidelines`, `vercel-react-best-practices` for the React UI;
- `improve-codebase-architecture` only after actual coupling/friction appears.

Do **not** copy MobaXterm source, binary assets, brand appearance, internal scripts, or defeat licensing. Build original implementations or properly licensed integrations. Product goal is eventual full Home+Professional *functional coverage*, but MVP delivery is explicitly phased.

**Approved baseline stack:** Electron security-hardened shell; React + TypeScript + Vite renderer; xterm.js, ConPTY/node-pty local backend, `ssh2` for SSH/SFTP/forwarding, SQLite with migrations, encrypted Windows credential vault, independent provider adapters for RDP/VNC/X11/Mosh/legacy and daemons. Select and pin verified compatible current dependency versions during implementation.

**Architecture non-negotiables:** renderer cannot import privileged Node/Electron/SSH/DB/vault code; all requests through narrow validated IPC; domain/application modules have no infrastructure imports; transport adapters own protocol state and resource cleanup; every feature is covered by behavior test and error path. Stable contract and schema details are in `docs/ARCHITECTURE.md`.

**Git sequence:** the active development branch is `dev` and the default branch is `main`. Inspect remote state first, make scoped commits on `dev` (or feature branches integrated back to it), test and review each completed phase, then push and merge `dev` into `main` with preserved history. Return to `dev` for the next phase. If `origin/dev` is absent, create it from the existing reviewed development history without rewriting or deleting `dev-1`. Do not force-push or claim a branch was pushed without verifying it.

**Respond first with:** branch and worktree state, the last verified phase, the next open slice and its requirement IDs, applicable skills, and any true blockers. Continue that slice through tests, review, evidence, and its authorized branch promotion. Do not generate the entire full-parity program in one unreviewed pass. Do not ask to repeat information provided by this documentation.
