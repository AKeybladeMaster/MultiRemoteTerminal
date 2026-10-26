# ADR-0030: Preserve supplementary characters in ConPTY clipboard input

**Status:** Accepted for the WP-01E follow-up (2026-10-26)

## Context

Windows E2E reproduced pasted U+1F642 becoming U+FFFD in interactive Git for Windows Bash through system ConPTY. PowerShell and non-interactive Bash controls preserved the same character. A focused probe showed that ConPTY accepts Win32 Input Mode key records carrying the two UTF-16 surrogate code units and that an interactive Bash command entered this way prints the original character.

Microsoft's ConPTY input protocol requests Win32 Input Mode with `CSI ? 9001 h` and accepts key records as `CSI Vk ; Sc ; Uc ; Kd ; Cs ; Rc _` sequences. The terminal application's clipboard broker currently keeps clipboard text in the main process and writes it to the local PTY. The renderer must not receive clipboard text, and remote terminal protocols must not receive Windows-specific key records.

## Decision

- Add a distinct typed local-terminal `paste` operation. Keep clipboard read, one-use gesture authorization, multiline confirmation and cancellation in the existing main-process broker.
- In the local PTY worker, observe mode 9001 enable and disable sequences from each session's output stream, including sequences split across output chunks. Reset this state with the PTY session.
- When mode 9001 is enabled, translate only valid supplementary UTF-16 pairs in clipboard paste text into two Win32 key-down records, one for each code unit. Preserve all other characters and control sequences unchanged. Ordinary terminal writes are unchanged.
- When mode 9001 is not enabled, write clipboard text through the existing raw PTY path. SSH, Telnet and serial paste remain on their existing transport paths.
- Keep the existing 16,384 UTF-16-code-unit clipboard bound. The worst case expands to 196,608 encoded characters, within a single bounded local paste operation. Do not return clipboard contents to the renderer or log them.

## Consequences

- The desktop does not add a dependency or change xterm.js. Protocol detection and translation live in the local PTY adapter; application and worker interfaces carry a paste-specific operation.
- Windows 11 x64 E2E with Git for Windows 2.53.0 verifies the interactive Bash command round trip three consecutive times. The PowerShell supplementary Unicode control also passes.
- In a separate raw `cat` probe, the program receives and prints the supplementary character, while ConPTY's console echo still displays U+FFFD plus a replacement glyph before the program's output. The interactive Bash line-editing round trip is correct; raw-console echo is not fixed by this change.
- Windows 10 compatibility, the packaged shell lifecycle, and behavior across other ConPTY clients remain acceptance work. F-002 stays partial until the remaining documented gates pass.

## References

- [Microsoft ConPTY improved keyboard handling specification](https://github.com/microsoft/terminal/blob/main/doc/specs/%234999%20-%20Improved%20keyboard%20handling%20in%20Conpty.md)
- [WP-01E supplementary input results](../results/WP-01E-bash-supplementary-input-2026-10-26.md)
