# Current candidate review - 2026-11-01

## Scope and source state

Current dev-1 worktree against checkpoint 6205ce71602c8276ed34eae50512d7540d097e46. The final delta includes Git Bash resize wake, the earlier explicit-selection/startup fix, X11/XDMCP shutdown cleanup/guards, native-dialog focus/fixture repairs, and release lockfile/notice metadata fixes. Earlier broad reviews covered the 20-commit range from origin/main 811701c230e4f0c953ce58dbf907afc3f3d7ecc3 through this checkpoint with a targeted security pass; they were not whole-range line-by-line certification.

## Standards and architecture

Independent final review reports no Critical/Important breach. The resize adaptation stays in the utility-worker adapter, retains shell/mode ownership and changes no domain/renderer capability. The X11 provider is drained at teardown; pre-dispatch and post-preference guards close the previously identified shutdown-launch race. Native dialog changes continue to use the real OS picker and explicit consent. Bounded release readers retain link/identity/integrity checks.

## Specification

The previously skipped resize E2E is re-enabled and the corrected final ten repetitions pass. One Important assertion weakness found during review (OK substring could match unwanted OKX) was resolved by an end-delimited output marker, re-reviewed and rerun. Custom-logo native-picker acceptance remains VERIFIED for its bounded workflow; dangling November evidence links were corrected. P-02/F-002 stay PARTIAL for broader environments, and P-25/N-010 and remaining phase criteria stay open.

## Security and correctness

Independent final review reports no Critical/Important issue in this delta. The empty mode-9001 key-up contains no key, text or modifiers and is emitted only for Bash after resize, with no timer/retry/replay or unbounded state. Raw console programs can observe it; arbitrary native-program compatibility is not claimed. The package smoke hook only supplies a default path under explicit packaged-test flags; native consent, Save and cancellation are retained. Certificate/store preflight found no signing identity; artifacts remain unsigned until publisher credentials are provisioned.

## Verification

Pinned Node 24.14.1/pnpm 12.15.0: typecheck, changed-file lint, 52 focused unit/bridge/mode tests and Windows build passed; final resize E2E 10/10, 0 skipped/failed, including native cmd child. The full repository suite was not rerun at the user's request. Earlier full-check counts (684 unit passes/6 skips, 82 E2E passes/7 skips) predate the resize fix and remain historical evidence in the ledgers. Package build/smoke and final Git checkpoint evidence follow in the Phase 08/11 ledgers and local session handoff.

## Final runnable package checkpoint

The final package workflow and six packaged E2Es passed6/6, with verified per-artifact SBOM/hash metadata and the current resize worker included. Binaries are unsigned development candidates; broader phase/release gates stay open. See [binary evidence](WINDOWS-BINARIES-2026-11-01.md). No code changed after the successful targeted verification and independent reviews.
