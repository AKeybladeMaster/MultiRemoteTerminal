# ADR-0062: Bound SSH routes to eight gateways

**Status:** Proposed; Phase 07 acceptance pending

## Context

ADR-0034 caps a route at three SSH gateways, and P-22/F-011 explicitly leave
longer routes open. The reference product's public release history describes
multiple SSH jump hosts but publishes no numeric maximum. An unbounded route
would let one user-selected operation allocate an unbounded number of SSH
clients and nested channels, conflicting with the resource-bound security
policy.

## Decision

- Raise the route maximum to eight ordered saved SSH gateways, followed by the
  target. One route can therefore own at most nine SSH clients and eight
  nested `forwardOut` channels.
- Keep route choices scoped to a connection or tunnel start. Continue sending
  profile IDs through IPC, resolve endpoints in main, and keep credentials out
  of saved definitions and exports.
- Preserve independent host-key verification, ordered credentials, target-only
  shell/SFTP behavior, cancellation and reverse-order cleanup.
- Bound each SSH handshake at 130 seconds and each nested channel open at 15
  seconds. Calculate the provider route deadline from the actual hop count and
  add a 20-second target-setup margin; the maximum eight-gateway route receives
  1,310 seconds for nine handshakes, eight channels and final shell/SFTP setup.
- Give the utility-worker adapter ten seconds beyond the provider deadline to
  receive the result and complete cleanup. Keep direct SSH sessions at their
  existing 130-second provider and 140-second adapter bounds.
- Calculate the preload deadline from up to nine 120-second credential prompts,
  the depth-specific worker deadline and a 40-second IPC/forward-start margin;
  the maximum route budget is 2,440 seconds.
- Reject nine or more gateway profiles at the domain, IPC and worker protocol
  seams. The renderer displays no more than eight gateway selectors.

## Consequences

Routes longer than three hops become supported while the app keeps a finite,
explicit resource bound. P-22/F-011 remain partial for routes beyond eight
gateways and for broad public-server interoperability; no claim is made about
the reference product's maximum. The bound can be revisited if Windows
performance evidence justifies a different resource budget.

## Acceptance tests defined before implementation

- Domain and command contracts accept zero through eight distinct gateway
  profiles and reject nine, duplicates, malformed IDs and endpoint overlap.
- Worker protocol accepts eight credentialed hops and rejects nine.
- Provider coverage opens the maximum chain in order and closes all nine
  clients/eight channels on success, cancellation and destination failure.
- Session-log route metadata preserves eight gateway endpoints and rejects a
  ninth gateway without creating an incomplete log.
- Windows Electron acceptance routes a terminal, an SFTP-only target, and local,
  remote and dynamic tunnels through eight gateways. It verifies ordered
  relays, selector bounds, target-only shell/SFTP behavior, exact tunnel bytes,
  host trust and cleanup.
- Unit coverage confirms provider (1,310 seconds), worker (1,320 seconds) and
  preload (2,440 seconds) deadlines at eight gateways, plus depth scaling.
- A worker-host timer test confirms routed IPC remains alive through the
  depth-specific provider deadline and reply/cleanup margin; direct-session
  timeout behavior is unchanged.

See [MobaXterm release history](https://mobaxterm.mobatek.net/download-home-edition.html)
for the public description of multiple SSH jump hosts.
