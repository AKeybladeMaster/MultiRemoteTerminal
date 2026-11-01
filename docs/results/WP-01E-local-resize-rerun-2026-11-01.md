# WP-01E current-candidate resize regression rerun

**Requirement:** P-02 local terminal sizing and input; F-002 ConPTY input/resize.
**Candidate:** local dev-1 worktree at base commit 6205ce71602c8276ed34eae50512d7540d097e46, including the uncommitted changes present on 2026-11-01.
**Result:** FAIL - intermittent first-character loss reproduced.

The existing focused Windows E2E was temporarily enabled and run ten times serially using pinned Node v24.14.1/pnpm 12.15.0. Result: 8 passed, 2 failed (exit 1).

One failed repetition displayed the typed command as rintf after the expected printf, then Bash reported rintf: command not found. The second failure exceeded the test's 30-second timeout. The other eight repetitions passed. The test's unconditional skip was restored; no application source change was made by this diagnostic.

This is a current-candidate reproduction, not passing acceptance. Prior work in [WP-01E resize evidence](WP-01E-local-resize-2026-10-29.md) narrowed the boundary past renderer input emission and preload ordering but did not identify a safe, reliable child-ready acknowledgment. No fixed delay, xterm/ConPTY variant, or shell-mode workaround passed repeated acceptance without changing expected terminal behavior. Keep P-02/F-002 PARTIAL, do not treat the normal suite's skip as a pass, and do not promote this candidate while this mandatory behavior remains failing.

## Transport boundary review

Source review confirms the current app waits for the utility worker to invoke the pinned node-pty resize before it forwards terminal input, but the pinned IPty resize contract returns void and exposes no child-process resize acknowledgement. Microsoft documents ResizePseudoConsole as resizing the ConPTY internal buffers and returning HRESULT; that reports API success, not that an arbitrary child has processed its window-change notification. Microsoft Terminal's discussion also describes resize/reflow work continuing asynchronously. See [Microsoft ResizePseudoConsole](https://learn.microsoft.com/en-us/windows/console/resizepseudoconsole), [node-pty 1.1.0 API](https://github.com/microsoft/node-pty/blob/v1.1.0/typings/node-pty.d.ts), [node-pty 1.1.0 native resize implementation](https://github.com/microsoft/node-pty/blob/v1.1.0/src/win/conpty.cc), and [Microsoft Terminal resize discussion](https://github.com/microsoft/terminal/issues/1156).

The inference is that the application currently has no supported signal on which it can safely delay arbitrary terminal input until the child is ready. Replaying a character can duplicate commands in programs that act immediately; injecting a control key changes the program's input; fixed delays were already disproven by repeated probes. No production workaround was added. A reliable fix needs a supported upstream/platform readiness boundary or an alternative transport that passes the existing resize and Unicode acceptance together.

## Superseding scoped repair

The later empty native key-up workaround provides a bounded input-queue wake despite the absence of a generic child-ready acknowledgement. It passes the corrected production ten-repeat acceptance; see [repair evidence](WP-01E-resize-input-wake-2026-11-01.md) and [ADR-0066](../adr/ADR-0066-git-bash-resize-input-wake.md). Earlier failures and the unsupported-acknowledgement inference above are historical and do not describe the final candidate's focused test result.
