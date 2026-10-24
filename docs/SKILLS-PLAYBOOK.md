# Codex Skill Selection and Execution Playbook

**Scope:** User-reported skills under `C:\Users\Beasty\.agents\skills\`. Skill catalog descriptions were checked on skills.sh on 2026-10-23, but **the local installed files were not accessible in this environment**. Publishers and revisions can differ; read each local `SKILL.md` before invoking it.

## Ranking: which actually fits?

| Skill | Priority | Purpose and invocation trigger | Do not use as |
|---|---|---|---|
| `codebase-design` | **CORE / always for module changes** | Decide deep-module interface ownership, seams, dependency direction and test surfaces. Best architecture skill in this set. [Reference](https://www.skills.sh/mattpocock/skills/codebase-design) | A generic obligation to add more service layers |
| `reverse-engineer-anything` | **CORE / external parity evidence** | Investigate shipped product artifacts or *permitted* observed runtime behavior when public documentation is insufficient; capture Evidence IDs and confidence. [Reference](https://www.skills.sh/morluto/rea/reverse-engineer-anything) | License circumvention, copying code/assets, routine source review |
| `frontend-design` | **CORE / UX creation** | Design high-density desktop shell, terminal tabs, file browser, tunnel manager and settings with a distinctive original visual system. [Reference](https://www.skills.sh/anthropics/skills/frontend-design) | Desktop protocol architecture or X11 implementation |
| `grill-with-docs` | **CORE / design uncertainty** | Challenge proposals against this repository's glossary and ADRs; update agreed decisions before generation. [Reference](https://www.skills.sh/mattpocock/skills/grill-with-docs) | Asking dozens of questions without attempting documented assumptions |
| `code-review` | **HIGH / after each slice** | Review `dev` changes against spec and coding standards. [Reference](https://www.skills.sh/mattpocock/skills/code-review) | A substitute for running tests |
| `requesting-code-review` | **HIGH / before merging** | Dispatch independent reviewer with feature IDs, diff, tests and findings; keep reviewer context bounded. [Reference](https://www.skills.sh/openai/plugins/requesting-code-review) | Automatic approval to merge |
| `diagnosing-bugs` | **HIGH / failures** | Reproduce, create a failing feedback loop, then narrow hypotheses; redact hostnames/passwords. [Reference](https://www.skills.sh/mattpocock/skills/diagnosing-bugs) | Random fixes before reproducing |
| `ui-taste` | **HIGH / polish** | Critique visual density, alignment, hierarchy, restraint and craft after UI exists. Listed on skills.sh as `uizze.sh/ui-taste`; [catalog corroboration](https://skillbundle.dev/site/uizze.sh/ui-taste). | Protocol correctness or permission design |
| `web-design-guidelines` | **HIGH / UI review** | Evaluate keyboard focus, interaction affordances, forms, labels and contrast in Electron's React UI. [Reference](https://www.skills.sh/vercel-labs/agent-skills/web-design-guidelines) | Claiming browser guideline compliance proves Windows accessibility |
| `vercel-react-best-practices` | **SUPPORTING / renderer performance** | Avoid expensive rerenders, needless network waterfalls and huge React component trees. [Reference](https://www.skills.sh/vercel-labs/agent-skills/vercel-react-best-practices) | Vercel deployment, Next.js SSR or server caching |
| `improve-codebase-architecture` | **AFTER 3+ slices** | Analyze real code and refactor shallow/coupled modules based on measured pain. [Reference](https://www.skills.sh/mattpocock/skills/improve-codebase-architecture) | Premature refactor before modules exist |
| `grill-me` | **OPTIONAL** | Exploratory questions before docs or when proposing a radically new feature. [Reference](https://www.skills.sh/mattpocock/skills/grill-me) | Re-interviewing the user about already specified architecture |
| `find-skills` | **OPTIONAL** | Discover additional implementation skills only when the installed set lacks a specific capability. [Reference](https://www.skills.sh/vercel-labs/skills/find-skills) | Automatically installing unknown skills |
| `requesting-code-review` vs `code-review` | **BOTH** | First requests an independent review; second runs the diff-based review. | Duplicate self-approval |

Note: `code-review` and `diagnosing-bugs` have multiple skill publishers on skills.sh. These links indicate the well-known matching description and **are not proof of your specific local revision**.

## Mandatory sequence for Codex

**Pre-design:** Read `AGENTS.md`, `GLOSSARY.md`, ADRs and the work package. Inspect installed `codebase-design`. If a decision is unclear and consequential, use `grill-with-docs`; prefer bounded documented assumptions when no decision is blocking.

**Behavioral research (conditional):** Use `reverse-engineer-anything` only for a concrete uncertain reference-product claim and legally available installed target. Evidence output must include target version, feature, scenario, tool/evidence ID, observed outcome, uncertainty and independent proposed user behavior. Read the REA skill exactly as installed; installing the skill does **not** install the REA MCP server.

**Frontend design:** `frontend-design` creates information architecture and visuals with independent branding. After renderable UI exists, apply `ui-taste`, then `web-design-guidelines`, then `vercel-react-best-practices` for client performance. The React skill should not transform this Windows Electron app into Next.js.

**Implementation:** Create one vertical slice following `docs/IMPLEMENTATION-PLAN.md`. Generate tests at interfaces first; update feature matrix only when verified.

**Quality:** On failures invoke `diagnosing-bugs`; create a red reproducer before edits. When green, use `requesting-code-review` and run `code-review`. Before `dev` -> `main`, confirm issue references, tests and no new critical security findings.

**Restructuring:** After at least three integrated slices or clear architectural friction, invoke `improve-codebase-architecture`, conditioned by `codebase-design`, and record any lasting decision in an ADR.

## REA limitations and ethical rules

The skill is a guide, not proof the analysis engine is installed. In the user's Windows environment the skill path was reported, but is unverified here. Codex must:

1. Read local `C:\Users\Beasty\.agents\skills\reverse-engineer-anything\SKILL.md`.
2. Check for usable REA tools only when there is a concrete target and analysis need.
3. Prefer official public UI descriptions and black-box user-driven observations.
4. Record evidence in `docs/REA-OBSERVATION-PLAN.md` format.
5. **Never** copy, translate or adapt decompiled proprietary implementation into MultiRemoteTerminal or defeat licensing/edition enforcement.
6. If only architecture is needed, skip binary analysis: the REA skill itself recommends normal source analysis for ordinary repositories.

## Recommended action by work package

| Work package | Skills |
|---|---|
| WP-00 Baseline architecture | `codebase-design`, `grill-with-docs` |
| WP-01 App shell | `frontend-design`, `ui-taste`, `web-design-guidelines` |
| WP-02 SSH / local terminal | `codebase-design`, `diagnosing-bugs` as needed |
| WP-03 Sessions / vault | `codebase-design`, `requesting-code-review`, `code-review` |
| WP-04 SSH jump hosts / forwarding | `codebase-design`, `diagnosing-bugs`, `requesting-code-review`, `code-review` |
| WP-05 SFTP browser / transfers | `codebase-design`, `frontend-design`, `web-design-guidelines`, `requesting-code-review`, `code-review` |
| WP-06 Macros / MultiExec | `codebase-design`, `frontend-design`, `code-review` |
| WP-07 Security / Windows release | `devops-and-deployment`, `web-design-guidelines`, `requesting-code-review`, `code-review` |
| WP-08 RDP/VNC / local editor | `codebase-design`, `frontend-design`, `code-review` |
| WP-09 Serial / FTP / legacy protocols / Mosh | `codebase-design`, `diagnosing-bugs`, `code-review` |
| WP-10 X11 / XDMCP / daemons | `codebase-design`, `performance-and-safe-coding`, `code-review` |
| WP-11 Unix tools / parity review | `reverse-engineer-anything` as applicable, `codebase-design`, `requesting-code-review`, `code-review` |

## Request template for Codex

> Implement exactly `WP-N` against `docs/SPEC-001-MultiRemoteTerminal.md` and `docs/ARCHITECTURE.md`. First read local skills for the work package and identify the applicable requirement IDs. Preserve domain/application/adapter dependency direction, implement complete vertical flow and tests, then run independent review. Report the commands, results, open risks, and changes to the feature matrix. Work only on `dev` or a feature branch; do not merge to `main` without the release gates.

No hidden agent orchestration assumptions: if the installed version lacks subagent support, Codex should perform a bounded standalone review and disclose that limitation.
