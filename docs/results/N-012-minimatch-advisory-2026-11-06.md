# N-012 minimatch advisory assessment — 2026-11-06

Status: Moderate development-tool advisory retained; no identified desktop
runtime exposure. Not an Important blocker for the unsigned package candidate.

Pinned audit finds GHSA-g3hv-75wg-m249 in development-only minimatch 9.0.9 and
10.2.6 through electron-builder, ESLint and typescript-eslint. The desktop
production-only audit reports no known vulnerabilities. The full high-threshold
audit exits zero with one Moderate finding and zero High/Critical findings;
that is not a clean all-severity audit.

The maintainer describes globparts amplification requiring attacker-controlled
glob patterns with optimizationLevel at least 2. Inspected builder/ESLint calls
use the default level 1 and repository configuration supplies fixed patterns.
No direct application use or qualifying level-2 call was identified in the
inspected consumers. This source assessment is not an exploit test.

The published 9.x/10.x lines have no compatible patched version; the documented
fix begins at 11.0.1. Do not force a major transitive override into older build
tools. Track a compatible upstream tool update and reassess if untrusted patterns
or level-2 optimization become reachable. No dependency or audit threshold changed.

An independent read-only security reviewer confirmed this disposition. Broader
N-012 license/provenance review and signed release acceptance remain PARTIAL.

Sources: [maintainer advisory](https://github.com/isaacs/minimatch/security/advisories/GHSA-g3hv-75wg-m249),
[reviewed advisory](https://github.com/advisories/GHSA-g3hv-75wg-m249),
[official registry metadata](https://registry.npmjs.org/minimatch),
[fixed release tag](https://github.com/isaacs/minimatch/releases/tag/v11.0.1).
