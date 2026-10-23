# AGENTS.md — Mandatory instructions for Codex

## Mission

Build an **independent Windows remote terminal application** named **MultiRemoteTerminal** according to `docs/SPEC-001-MultiRemoteTerminal.md`. The present repository may initially contain *only documentation*. Do not claim implementation, testing, packaging, or Git pushes until independently verified.

### First read

1. `docs/CODEX-START-HERE.md`
2. `docs/SPEC-001-MultiRemoteTerminal.md`
3. `docs/ARCHITECTURE.md`
4. `docs/SECURITY.md`
5. `docs/FEATURE-MATRIX.md`
6. `docs/IMPLEMENTATION-PLAN.md`
7. `docs/GLOSSARY.md` and relevant `docs/adr/*.md`

## Skill instructions (installed locally on user's Windows machine)

The user reports these skills under `C:\Users\Beasty\.agents\skills\`. At each task, inspect the relevant `<skill-name>\SKILL.md` file first. **Catalog names collide across publishers** and installed behavior can differ. If a skill file is unavailable, state this in the report and proceed under repository rules; do not invent its execution.

- Initial domain/architecture design: `codebase-design`, optionally `grill-with-docs` for unresolved design choices.
- External behavioral evidence, when needed: `reverse-engineer-anything` (only with lawful target access and configured REA runtime).
- UI new feature/design pass: `frontend-design`; UI consistency/critique: `ui-taste`; UI code accessibility audit: `web-design-guidelines`.
- React performance: `vercel-react-best-practices` (React-specific client-side advice only; **this app is not a Vercel/Next.js service**).
- Bugs: `diagnosing-bugs` with a reproduced failing test first.
- Every completed major slice: `requesting-code-review`, then `code-review` against `docs/FEATURE-MATRIX.md` and tests.
- After multiple vertical slices: `improve-codebase-architecture` to review actual friction, not speculatively restructure.
- `grill-me` is optional for ungrounded brainstorming; `find-skills` only when a capability lacks an installed skill.

See `docs/SKILLS-PLAYBOOK.md` for exact sequencing and evidence requirements.

## Non-negotiable clean architecture

- Depend inward: `presentation -> application -> domain` with **no** domain imports from Electron, Node.js, React, SQLite, or protocol libraries.
- `adapters` implement the interfaces declared in application/domain; wire adapters only in process composition roots.
- Keep modules **deep**: one understandable interface owning substantial behavior; no empty classes, service-per-method, speculative microservices, or direct UI-to-SSH calls.
- Renderer may invoke *allowlisted, typed, validated* commands through preload IPC only. Renderer has no Node integration, no filesystem permissions, and no access to secrets.
- Electron main acts as a narrow capability broker. Storage and network/PTY providers run in utility workers where practical; guard worker crashes and cleanup.
- Interactions that potentially leak commands/secrets require explicit user action. No arbitrary remote script execution at app startup.
- All protocol operations support cancellation, bounded queues, timeouts, and meaningful error categories.
- Document any material departure as an ADR and update acceptance tests before coding.
- No feature marked "implemented" until end-to-end behavior passes on Windows.

## Dependencies

Before introducing a package: consult the **current official docs**, check license, maintenance, support for pinned Electron/Node ABI and Windows x64, security posture, and size. Pin approved versions into a lockfile. Prefer platform tools over bundling high-risk protocol binaries. Never guess or hardcode "latest" version strings in docs.

## Git rules

- Target repo: `https://github.com/AKeybladeMaster/MultiRemoteTerminal.git`
- Use `dev` for all work, feature branches as needed, and **do not commit generated sources directly to `main`**.
- Desired promotion: feature work -> `dev` with checks -> review -> PR/merge `dev` into `main` (preserve merge history).
- Do **not** force-push, rewrite, or delete existing history; inspect remote state first.
- Push only with valid authorization/network access. Never claim a push occurred without `git ls-remote`/remote verification.
- MVP release is gated on Windows smoke/E2E tests, review, security checklist, and signed/verified packaging decision.
- Preserve `docs/` as the canonical specification; update docs together with behavior changes.

## Definition of done for each vertical slice

1. Requirements/behavior IDs are identified.
2. Interface and state ownership are clear; failure modes specified.
3. Unit tests for domain/application rules, contract tests for adapters, E2E smoke where feasible.
4. Error handling, cancellation, cleanup, structured redacted logging, and keyboard/accessibility included.
5. `code-review` findings handled or explicitly tracked.
6. Feature matrix changed from planned to implemented **only with test evidence**.

## Reporting format (brief)

- Slice and linked requirement IDs
- Architecture decisions made, if any
- Files changed / tests run / actual results
- Security risks and limitations
- Next independent slice

Only ask the user questions when a material choice is genuinely blocking; default to documented assumptions rather than stopping.
