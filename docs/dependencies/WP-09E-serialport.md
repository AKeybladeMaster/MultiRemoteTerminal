# WP-09E dependency review: SerialPort

**Reviewed:** 2026-10-25. **Runtime pins:** `@serialport/stream@13.0.0` and `@serialport/bindings-cpp@13.0.1`. **Test pin:** `@serialport/binding-mock@10.2.2`.

## Decision

Use SerialPort's stream API with its Windows native bindings, loaded only in the serial Electron utility worker. The renderer and main process do not import either runtime package. The mock binding is a development-only dependency used for deterministic tests and a test-only Windows E2E path.

## Package review

| Package | Pin | License | Declared Node support | npm unpacked size | Lockfile integrity |
|---|---:|---|---|---:|---|
| `@serialport/stream` | 13.0.0 | MIT | `>=20.0.0` | 29,522 bytes | `sha512-F7xLJKsjGo2WuEWMSEO1SimRcOA+WtWICsY13r0ahx8s2SecPQH06338g28OT7cW7uRXI7oEQAk62qh5gHJW3g==` |
| `@serialport/bindings-cpp` | 13.0.1 | MIT | `>=18.0.0` | 2,214,657 bytes | `sha512-j8nD5Om5MaQwzptncOiajIKj5RuMy7RiretZYmW4ZpaaLBc5XrapdojjL6AVwhpMWao8iSstlwEx/hpTIAp6mw==` |
| `@serialport/binding-mock` (dev only) | 10.2.2 | MIT | `>=12.0.0` | 25,152 bytes | `sha512-HAFzGhk9OuFMpuor7aT5G1ChPgn5qSsklTFOTUX72Rl6p0xwcSVsRtG/xaGp6bxpN7fI9D/S8THLBWbBgS6ldw==` |

At review time, npm's published `latest` tags matched these exact package pins. The installed `bindings-cpp` package contains a `win32-x64` N-API prebuild of 233,472 bytes. Its ABI is Node-API 8, compatible with the pinned Electron 45 / Node 24 target. The Windows build plus Electron E2E successfully loaded the native module from the utility worker. `pnpm-workspace.yaml` permits only `@serialport/bindings-cpp`'s inspected `node-gyp-build` install hook; unrelated existing ignored build scripts remain blocked.

SerialPort's upgrade guide documents N-API/Electron use and custom bindings; its platform guide lists Electron support; the bindings docs cover Windows serial paths and supported port settings. SerialPort 13.0.0 was released on 2024-12-24. Versions are exact-pinned and integrity-locked. `pnpm audit --prod` reported no known vulnerabilities for the production dependency set on the review date.

The mock package's published ESM export does not resolve its bundled declaration file under the current TypeScript resolver. Production code does not depend on it. Tests and the worker use a small local structural type for its `MockBinding` surface.

The existing Electron Builder configuration unpacks `*.node` native files from ASAR. Both the NSIS-installed and portable Windows smoke tests pass a real `serial.ports.list` request through the packaged utility worker. Neither package smoke opens a physical port.

## Runtime constraints

The installed native binary does not verify Windows driver signatures or physical-device behavior. COM settings are validated before opening; only COM-style paths are accepted. Port enumeration exposes the path and bounded manufacturer string, not the driver-reported serial number. Worker requests, active sessions, input, output buffering and operation deadlines are bounded. Native addon isolation in an Electron utility process is not a strong OS sandbox.

Physical adapter interoperability, device-specific encodings, disconnect/hot-unplug recovery, packaging signature policy and Windows driver verification remain open. This review authorizes no claim that the serial provider is hardware-verified.

## Official references

- [SerialPort upgrade guide](https://serialport.io/docs/guide-upgrade/)
- [SerialPort platform support](https://serialport.io/docs/next/guide-platform-support/)
- [SerialPort bindings-cpp API](https://serialport.io/docs/next/api-bindings-cpp/)
- [SerialPort binding-mock API](https://serialport.io/docs/api-binding-mock/)
- [SerialPort 13.0.0 release notes](https://github.com/serialport/node-serialport/releases)
- [pnpm build-script approval](https://pnpm.io/cli/approve-builds)
