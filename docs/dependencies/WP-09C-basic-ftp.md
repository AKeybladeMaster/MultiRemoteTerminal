# WP-09C dependency review: `basic-ftp`

**Reviewed:** 2026-10-24. **Pinned:** `basic-ftp@6.2.3` in `apps/desktop/package.json` and `pnpm-lock.yaml`.

## Decision

Use `basic-ftp` only inside the FTP utility worker for explicit FTPS and consent-gated plaintext FTP. The renderer and main broker do not import the package. The worker disables verbose logging, serializes each connection's operations, sets a 30-second server-progress timeout, caps parsed listing data at 2 MiB and refuses a PASV transfer host different from the control host.

## Verification

- The official package metadata reports MIT, Node.js `>=10.0.0`, no runtime dependencies, and 156,084 unpacked bytes. This is pure JavaScript and adds no native addon or Electron ABI requirement; the pinned Electron 45 / Node 24 runtime is within the declared support range.
- The version is exact-pinned and recorded in the workspace lockfile. The official README documents explicit FTPS, connection timeout behavior, passive mode, directory listing, and the prohibition on concurrent commands through one client.
- Reviewed the package's official GitHub security advisories. The listed affected ranges are patched before 6.2.3 (`GHSA-rpmf-866q-6p89` <=5.3.0, fixed in 5.3.1; `GHSA-c475-qrg2-pj4r` <=6.2.0, fixed in 6.2.1). `pnpm audit --prod` reports no known vulnerabilities in the current production dependency set.
- Windows E2E exercises the pinned client against a local passive FTP fixture. It verifies plaintext warning, account authentication, bounded directory listing, saved-profile restart/reconnect, and absence of account fields in SQLite. It does not establish compatibility with every FTP/FTPS server or validate a TLS certificate fixture.

## Limits

The current slice browses directories only. Upload/download, partial-file cleanup, collision policy, and local destination-root safety were release gates for this slice. WP-09F now verifies explicit FTPS certificate rejection/trust and protected data channels against a local fixture; public CA-chain interoperability remains a release gate. The 2 MiB cap applies to parsed listing data; the UI returns at most 500 validated file entries. Plain FTP is inherently unencrypted and remains an explicit user choice.

## Official references

- [basic-ftp README and API](https://github.com/patrickjuchli/basic-ftp/blob/master/README.md?plain=1)
- [basic-ftp security advisories](https://github.com/patrickjuchli/basic-ftp/security/advisories)
- [GHSA-c475-qrg2-pj4r](https://github.com/advisories/GHSA-c475-qrg2-pj4r)
- [GHSA-rpmf-866q-6p89](https://github.com/advisories/GHSA-rpmf-866q-6p89)
