# Windows x64 runnable build - 2026-11-01

Current development candidate 0.0.0; not a signed production release or completed product qualification. Build tools: Node 24.14.1, pnpm 12.15.0, Electron 45.0.0.

## Files

Outputs are under artifacts/windows.

| Executable | Bytes | SHA-256 |
| --- | ---: | --- |
| MultiRemoteTerminal 0.0.0.exe | 114741376 | 875879460739c1576f40907d93b4681b4ac66ae4d487b4c9a1c64ce320576b37 |
| MultiRemoteTerminal Setup 0.0.0.exe | 128734043 | f8195658fedbdb11ec355498723ae9ddd6028b6f1846496b15e08512c39eec34 |

The archive win-packed.zip includes both executables, their CycloneDX SBOMs, SHA256SUMS.txt, Electron/Chromium/production notices, updater metadata/blockmap and RUN-ME.txt. The separate win-packed.zip.sha256 records the archive hash. A ready-to-run portable copy is under .tmp/run-resize-fix/MultiRemoteTerminal.exe so its local profile/internal logs stay under .tmp.

## Verification

The package workflow exited 0: registry signature audits verified 45 runtime and 340 development packages; native/renderer build and 30-package production notices passed; both artifact SBOMs include 31 resolved runtime components. Packaged smoke passed 6/6 (ASAR/fuses, SBOM/hashes, offline NSIS install/settings/uninstall, portable data/shells, native SSH prompt, SSH-log shutdown). All seven SHA256SUMS entries were independently streamed and rechecked after the smoke run. The packaged PTY worker equals the rebuilt worker byte-for-byte, SHA-256 cab39d604d7925cbd017dc547efb3ac3caae992fdf56f48fb45b2c68ae038f45.

The repaired resize E2E passed the final 10/10 repetitions, including typing, editing, paste and native child input. Three Bash/Unicode E2Es passed; 52 input/bridge/mode unit tests passed. Focused release/KDF tests were 16 passed, 3 skipped (the account cannot create Windows file symlinks), 0 failed. Typecheck, changed-file lint/import boundaries and Windows x64 build passed. The full repository suite was not rerun as requested. See [resize evidence](WP-01E-resize-input-wake-2026-11-01.md).

## Release limits

Both executable signatures are NotSigned. No signing identity is provisioned. Windows 10, broader Git/MSYS/raw-console applications, real protocol/hardware and other mandatory phase gates remain open. No main promotion or product completion is claimed. Generated binaries, archives, caches, logs and local session-context are excluded from Git.

Archive verification: 11 ZIP entries; all seven manifest-listed entries were streamed from the archive and matched their SHA-256 values. ZIP SHA-256: 105C72EE1C4FDFAEAF0230EB616AD629071B27AB118C81A4BA8FC90B681D0968. The .tmp run copy matches the portable executable byte-for-byte.
