# ADR-0001 — Windows Electron modular monolith

**Status:** Accepted as initial design (2026-10-23)

## Context

One desktop app must render many concurrent terminal streams, manipulate files, manage trusted SSH sessions and optionally start Windows-native and third-party protocol viewers. Shipping a cloud or microservices platform would add unnecessary deployment, authentication and infrastructure complexity.

## Decision

Electron + React renderer + TypeScript application/domain packages, with separate Electron utility workers for privileged network/PTY/storage adapters. All feature providers implement domain/application-defined ports. No browser/network frontend or remote service is required for initial operation. Desktop UI relies on typed validated IPC, not direct Node access.

## Alternatives considered

- **Tauri + Rust:** smaller runtime; good Windows interop, but broad remote-protocol adapters and vendor tool integration would increase Rust/front-end boundary and contractor ramp-up. Re-evaluate after reliable Windows benchmarks.
- **C# WPF/WinUI:** excellent native Windows access; terminal rendering, xterm-style and multi-protocol ecosystem requires additional native/WebView integration. Revisit if Electron hardening/footprint fails.
- **Web SaaS:** incorrect for local terminal/ConPTY and standalone portable mode.
- **Microservices:** unnecessary operational overhead and harder secret isolation with no user benefit.

## Consequences

Positive: mature terminal ecosystem, Codex-friendly typed stack, practical feature slices. Negative: Chromium footprint, native Node ABI packaging, careful Electron process/security discipline, external native providers may be needed. Review decision after MVP memory/performance/security measurements.
