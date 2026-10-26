# ADR-0027: Explicit WSL distribution terminals

**Status:** Accepted for WP-11B, 2026-10-26

## Context

P-02 and F-023 call for WSL-backed Unix-like terminals. WP-11 requires an approved provider path with bounded behavior and user-controlled tool availability. The Windows `wsl.exe` command supports listing installed distributions with `--list --quiet` and launching a selected distribution with `--distribution` [1]. A default distribution can be Docker-managed or otherwise unsuitable as a workbench shell, so the application must not silently use it.

## Decision

- Query only installed distribution names on an explicit user action. Run the fixed absolute Windows `wsl.exe` path with `--list --quiet`; parse bounded output, support the observed UTF-16LE encoding, and terminate the query on timeout or output overflow.
- Let the user choose a listed distribution. Revalidate the choice against a fresh bounded list before launch. Start only the selected distribution with fixed arguments `--distribution <name> --exec bash --login`; pass the distribution name as a separate process argument, never through a command shell.
- Persist WSL profiles as local sessions with `shell: wsl` and the exact distribution name. Reopening or importing a profile must not fall back to another/default distribution if the named distribution is absent.
- Keep WSL launch behind the existing explicit command-palette action and typed main/preload/worker path. App startup performs no WSL discovery or launch. Do not run WSL install, update, shutdown, terminate, import, export, unregister, online-list or arbitrary command operations.
- Add `wsl` to the fixed local-shell visibility registry and migrate settings to schema v7 with the new action visible by default. Bump saved-session folder bundles to v7 for WSL profile round trips; continue accepting v1-v6 data unchanged.
- Use a guarded unpackaged E2E harness to test exact selected-distribution launch and saved-profile persistence without starting Docker-managed WSL infrastructure. A focused provider test verifies a stale saved target is rejected before PTY creation. Real user-distro interoperability remains a separate Windows acceptance gate.

## Consequences and limits

This adds the WSL distribution as an explicit profile field but does not install Linux distributions, packages, WSL itself, Mosh or a general Unix toolpack. Profiles cannot silently change targets when their distribution is removed. WSL's normal interactive login can run the user's Linux login configuration after the user explicitly opens a terminal. P-02, P-21 and F-023 remain partial until a real user-installed distribution passes Windows acceptance.

## Reference

1. [Microsoft Learn: Basic commands for WSL](https://learn.microsoft.com/en-us/windows/wsl/basic-commands)
