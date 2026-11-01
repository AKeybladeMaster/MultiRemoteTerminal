# WP-03D — 1,000-definition saved-folder bundle round trip

**Requirements:** F-018 saved-configuration export/import subset; P-13 session catalog persistence.
**Status:** Acceptance source authored; not run.

The new Windows Electron E2E fixture creates a 1,000-session saved-folder bundle, imports it into a source profile, exports the folder through the existing typed storage path, verifies version/count and absence of credential-bearing fields, imports the exported bundle into a fresh profile, and confirms the 1,000-definition count and a representative saved session after restart.

The scenario uses the existing native-dialog adapter test hook, as in WP-03D acceptance; it does not claim physical common-dialog interaction. It covers saved-folder configuration only, not the encrypted SSH password bundle. The test has not run because Phase 08 implementation is still open under the major-phase verification freeze. F-018 remains PARTIAL.
