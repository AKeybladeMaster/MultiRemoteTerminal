# ADR-0066 - Wake Git Bash input processing after a ConPTY resize

**Status:** Accepted for the scoped Windows 11/Git Bash workaround (2026-11-01); broader platform acceptance remains open.

## Context

P-02/F-002 immediately typed input after a resize intermittently loses its first character with installed Git for Windows 2.45.2, Bash 5.2.26 and MSYS 3.4.10. The unmodified current candidate failed 2/10 repetitions. Raw IPC capture confirms the character reaches the worker after the resize request, before ConPTY's resized-screen redraw. There is no overlapping cursor query. Win32 text-key encoding and bypassing the Git Bash launcher also reproduced the loss.

The MSYS console input loop processes window-size events and signals during native input reads. An empty Win32 key record can wake that loop without delivering a character. Both key-down and key-up probes passed 10/10; the key-up variant performs no key press. This is evidence for a transport workaround, not proof of the exact upstream race.

## Decision

After resizing a Git Bash session, when ConPTY has requested Win32 Input Mode (`CSI ? 9001 h`), send one empty key-up record (`CSI ; ; ; 0 _`). Its virtual key, scan code, character and modifier state are zero. Other shells and sessions without the mode request receive no extra record. PTY creation, resize and this wake event remain in the existing utility-worker adapter.

Keep input, clipboard, ordering, timeout and cleanup paths unchanged. Do not delay or replay user input, send a character, disable Readline, or claim a general child-ready acknowledgement. Re-enable and extend the Windows regression for immediate typing, immediate clipboard paste and preservation/editing of an existing command line after resize. Adapter tests cover the shell/mode gates and unchanged user bytes.

## Limits and removal

The empty native record can be observed by programs reading raw console key-up events inside Git Bash. It carries no assigned key or text; acceptance must verify normal shell editing, Unicode, native commands and process cleanup. Remove the workaround when supported upstream behavior passes the same repeated regression. Windows 10 and other Git/MSYS versions remain separate acceptance requirements; this decision does not close all of P-02/F-002.

## Sources

- [Microsoft Win32 Input Mode specification](https://github.com/microsoft/terminal/blob/main/doc/specs/%234999%20-%20Improved%20keyboard%20handling%20in%20Conpty.md)
- [MSYS/Cygwin 3.4.10 console input implementation](https://github.com/msys2/msys2-runtime/blob/cygwin-3.4.10/winsup/cygwin/fhandler/console.cc)
- [Current reproduction and earlier failed probes](../results/WP-01E-local-resize-rerun-2026-11-01.md)
