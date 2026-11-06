# WP-04M — SOCKS5 and SSH transport feasibility

**Status:** Research complete; P-25 remains PARTIAL. No implementation or
interoperability result is claimed.

## Requirement

P-25 currently covers loopback SOCKS5 no-auth TCP `CONNECT`. Authenticated
methods, `BIND`, `UDP ASSOCIATE` and broad interoperability remain open. The
Phase 07 mission requires those gaps to be investigated without weakening
credential or public-bind security.

## Findings

- RFC 1928 defines `BIND` as a two-reply operation: the first reports a
  listener, and the second reports the accepted peer. `UDP ASSOCIATE` requires
  a UDP relay endpoint that receives and returns UDP datagrams.
- RFC 4254 section 7.2 defines the `direct-tcpip` and `forwarded-tcpip`
  forwarding channel types. The installed `ssh2` provider exposes these as
  `forwardOut`/`forwardIn` TCP streams; it has no generic UDP datagram channel.
- The existing dynamic tunnel has no proxy-credential fields or secret-vault
  flow. Adding SOCKS username/password authentication must keep credentials out
  of renderer state, saved tunnel definitions, logs and exports.
- The authentication policy remains SOCKS5 no-authentication only. The listener
  is explicitly started and loopback-only; any local process can use it. Adding
  RFC 1929 authentication needs a secure way to provision/rotate a local proxy
  credential, which the tunnel profile and vault do not currently provide.
- `BIND` is technically expressible with the provider's SSH `forwardIn` TCP
  primitive, but that alone does not implement SOCKS BIND. It needs request-
  scoped main-process consent before opening the remote listener, correct first
  and second replies, expected-peer filtering (including hostname behavior),
  port reporting, and bounded one-peer cleanup. In addition, SSH remote-forward
  setup reports the assigned port but does not provide an authoritative
  externally reachable address for the SOCKS first reply; the requested bind
  address and server `GatewayPorts` policy do not prove what address the remote
  peer can reach. Resolving this requires an explicit, user-reviewed advertised
  address policy and server-side interoperability evidence. Hostname peer
  filtering also cannot safely rely on local DNS when the target is resolved on
  the SSH server's network. The dynamic SOCKS request path has no such consent,
  advertised-address policy, or listener state machine. BIND remains rejected;
  do not silently bind on the SSH server.
- OpenSSH tunnel-device forwarding (`ssh -w`) was evaluated as a UDP alternative.
  Its documented `tun(4)` device endpoints and server `PermitTunnel` requirement
  are system/network configuration, not a datagram channel exposed by the
  current `ssh2` provider. Microsoft documents `PermitTunnel` as unavailable in
  the OpenSSH version shipped with Windows and Windows Server, so this is not a
  compatible Windows drop-in for the app.

## Decision for the current provider

Do not emulate UDP by sending datagrams outside the SSH route or by treating
TCP streams as UDP. That would change the security and routing meaning of the
proxy. A compatible UDP implementation needs a separately specified,
authenticated remote relay or a transport with datagram forwarding, plus
bounded datagram sizes, queues, lifetime, consent and cleanup. A future BIND
slice must integrate with SSH `forwardIn` and the main-process consent broker,
let the user review/select a reachable advertised address, then prove both
SOCKS replies, peer matching, and listener release against server policy. A future
authenticated method needs an explicit secret-provisioning boundary. Until
those flows are implemented and accepted, do not claim SOCKS5 UDP, BIND or
authenticated methods.

The current provider remains loopback-only no-auth TCP `CONNECT`, which is the
behavior documented by [ADR-0011](../adr/ADR-0011-wp04c-dynamic-socks-forwarding.md).
This research does not close P-25 or accept the outstanding requirements.

## Evidence and verification

- [RFC 1928: SOCKS Protocol Version 5](https://www.rfc-editor.org/rfc/rfc1928),
  especially sections 4–7.
- [RFC 4254: SSH Connection Protocol](https://www.rfc-editor.org/rfc/rfc4254),
  especially section 7.2.
- [OpenBSD `ssh(1)`](https://man.openbsd.org/ssh.1), `-w` tunnel-device
  forwarding, and [OpenBSD `sshd_config(5)`](https://man.openbsd.org/sshd_config.5),
  `PermitTunnel`.
- [Microsoft OpenSSH Server Configuration for Windows](https://learn.microsoft.com/en-us/windows-server/administration/openssh/openssh-server-configuration),
  which lists `PermitTunnel` as unavailable in the shipped Windows OpenSSH.
- Static source inspection of the pinned `ssh2` forwarding calls and the
  current dynamic tunnel implementation.
- No automated tests were run; Phase 07 implementation is still in progress.

## 2026-11-06 authentication implementation follow-up (unverified)

ADR-0067 supersedes the earlier statement that no proxy credential boundary exists: the current candidate authors an optional per-start native username/password prompt, transient main-to-worker credential handoff, RFC1929 validation, no method downgrade and bounded cleanup. Renderer IPC carries only a policy flag; saved tunnel definitions/exports/status contain no account. Default no-auth CONNECT remains available. Authored regression sources have not run under the user's deferred verification sequence. BIND/UDP transport and advertised-address/consent findings above remain unchanged; P-25 stays PARTIAL.
