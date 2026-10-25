# WP-07Q - Security gate wording correction

**Requirement:** N-002 security evidence and accurate release-gate reporting.

## Change

Corrected the `docs/SECURITY.md` release gate to credit the bounded hostile SSH terminal-output E2E already documented in WP-07I. The gate continues to identify unsigned distribution integrity and broader privilege-injection acceptance as release blockers. No feature or release-gate status changed.

## Validation

- Cross-checked the WP-07I acceptance record, which reports 1/1 hostile SSH-output E2E and 1/1 CSP/Electron-policy E2E.
- No tests run; this phase changes documentation only.
- `git diff --check` - passed.

## Review

Independent review of `1f2cc1304f5f9f42bfd8c03a8f12870e12e3a0bd..c0886eb1be983a9a2205cdf2153c63a40ce31c12`:

- **Spec:** No findings. WP-07I evidence is credited while N-002 remains open.
- **Standards:** No documented-standard violations, unsupported claims or applicable baseline smells found.
