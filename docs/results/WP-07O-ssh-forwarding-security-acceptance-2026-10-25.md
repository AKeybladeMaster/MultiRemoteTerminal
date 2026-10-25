# WP-07O - SSH forwarding security acceptance

**Requirements:** N-002 forwarding policy evidence; F-006 and supporting P-23/P-24/P-25 acceptance.

## Evidence

Focused SSH tunnel and provider unit suites:

- `node --test tests/unit/ssh-tunnels.test.ts tests/unit/ssh-transport-provider.test.ts` - passed, 31/31. Coverage includes loopback-only local binding and relay, TCP half-close and long-lived channels, SOCKS5 no-auth TCP CONNECT plus rejected unsupported commands, IPv6 destinations, remote loopback bind request and unbind, 64-channel limits, open/handshake deadlines, cancellation, bind conflict, profile removal protection, 20 concurrently active saved tunnels without an application cap, and application shutdown cleanup.

Windows loopback application E2E:

- `corepack pnpm exec playwright test tests/e2e/foundation.test.ts --grep "saved SSH profiles start loopback forwards" --reporter=line` - passed, 1/1. Through the renderer, main process and utility worker, the fixture starts three local forwards and verifies unique loopback ports and payload relay, then verifies simultaneous relay while all are active. It starts a remote forward after displaying the `GatewayPorts` warning, verifies the SSH server received the requested `127.0.0.1:0` bind, relays traffic, stops it and verifies unbind. It starts a dynamic SOCKS5 listener on loopback and verifies a domain-name TCP CONNECT payload relay. The fixture also confirms these flows request no shell, shutdown releases listeners, and saved tunnel definitions reopen stopped after app restart.

## Status and limits

The focused forwarding-policy checklist item in `docs/SECURITY.md` is checked. The evidence uses a trusted loopback SSH fixture and does not establish compatibility with public SSH servers. P-23/P-24/P-25 and F-006 remain partial: public/non-loopback bind controls and informed consent are unfinished; a remote SSH server's `GatewayPorts` policy can override the requested loopback bind; dynamic SOCKS5 has no proxy authentication and is reachable by local processes; UDP ASSOCIATE, BIND and SOCKS authentication are unsupported; broader interoperability and tunnel routing through gateways remain open.

## Review

Pending independent Spec and Standards review.
