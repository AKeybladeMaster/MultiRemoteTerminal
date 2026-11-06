# ADR-0065: Bounded PowerShell release download

**Date:** 2026-10-31
**Status:** Accepted implementation direction; Windows acceptance pending
**Supersedes:** [ADR-0064](ADR-0064-fixed-powershell-tool-lifecycle.md)

## Context

F-009, P-21, and P-37 require safe user-managed optional shell tooling. The prior fixed PowerShell MSIX candidate used WinGet to download the official release asset, then checked its byte count. That check bounded data passed to signature and archive parsers but could not bound temporary disk writes while WinGet was still downloading. The fixed PowerShell release API already provides the exact asset URL, size, and SHA-256 digest.

## Decision

- Keep only the typed `install`, `update`, and `remove` actions for the fixed PowerShell package. Run lifecycle actions in a fresh, app-managed `-NoProfile` terminal opened by Settings; the application controller marks that new session for one lifecycle command and consumes the mark before writing it. Any ordinary write or paste clears the mark, so manual input cannot be concatenated with the lifecycle command. Ordinary PowerShell sessions cannot receive lifecycle commands, and an action is never written to an existing terminal.
- Before install/update, query the public GitHub latest-stable PowerShell release endpoint with the existing ten-second timeout and 64 KiB metadata bound. Decode the response using strict UTF-8 before JSON parsing. Require a stable `vMAJOR.MINOR.PATCH` tag, exactly one version-matched uploaded MSIX bundle asset, a size from 1 byte through 1 GiB, a valid SHA-256 digest, and the exact `github.com/PowerShell/PowerShell/releases/download/...` URL derived from the tag and fixed asset name.
- Fetch that asset without credentials, cookies, default credentials, or automatic redirects. Manually allow at most three HTTPS redirects to `github.com` or a `githubusercontent.com` host on port 443. Stream into a uniquely named, exclusively created file under the app's local staging directory with a 60-minute cancellation deadline; reject bytes as soon as they exceed the API-declared size, require the final byte count to match, and compare an incremental SHA-256 with the release metadata. Reject reparse-point `LOCALAPPDATA`, app-data, or staging directories and remove only the bundle file created by this operation; never recursively delete the staging directory.
- Open the completed bundle read-only while denying write/delete sharing. Recheck its locked size and SHA-256, require a valid Windows signature with the exact Microsoft publisher subject, and parse its bounded bundle manifest with DTD processing prohibited. Require the fixed `Microsoft.PowerShell` identity, an x64 application payload, the API-matched version, and the existing minimum version `7.6.9.0`.
- Install/update with `Add-AppxPackage -Confirm` for the current user, then verify the registered package family, publisher, x64 architecture, and a version at least as high as the selected release. A declined or cancelled update therefore fails its postcondition when the older package remains installed. Removal keeps its separate explicit confirmation and removes only that verified current-user package identity, followed by an absence check.
- The UI links the upstream repository's MIT-license statement and keeps the deployment/removal confirmations visible. Do not call WinGet, inspect or change WinGet sources, add authentication tokens, or accept arbitrary package IDs or URLs.
- Keep P-21/P-37/F-009 partial until interactive Windows package-operation acceptance and package provenance/license review pass.

## Consequences and limits

- Streaming rejects a chunk before writing it if it would cross the declared asset size; actual staging writes are bounded to at most 1 GiB. The `HttpClient` timeout is infinite so its default 100-second cap cannot override the explicit 60-minute cancellation token; the token is passed to each request and response-body read. Cancellation, network failure, redirect rejection, length mismatch, or digest mismatch enters cleanup before signature parsing or deployment. Cleanup is scoped to the exclusively created bundle path so a path collision cannot recursively remove unrelated contents.
- The download URL is derived from a strict numeric release tag and fixed filename, then compared to the API-provided URL. Redirects carry no application credentials and are restricted to HTTPS GitHub hosts on the standard TLS port. The final file still relies on the same GitHub API/TLS trust path for the expected digest, plus Windows publisher trust for the MSIX signature. Neither check is an independent provenance review; no leaf certificate thumbprint is pinned.
- Direct retrieval removes WinGet's source and package-agreement prompts. The Settings action is explicit and `Add-AppxPackage -Confirm` remains visible; the UI identifies and links the upstream MIT license. Broader package/legal/provenance review remains open.
- A release redirect to a new host outside the allowlist fails closed until reviewed. This is a deliberate availability tradeoff; no arbitrary redirect target is followed.
- The current candidate has authored command and UI assertions only. No package download or installation, automated test, Windows interoperability check, or Phase 08 verification has run.

## References

- [GitHub REST API: Get the latest release](https://docs.github.com/en/rest/releases/releases#get-the-latest-release)
- [GitHub REST API: Release asset metadata and downloads](https://docs.github.com/en/rest/releases/assets?apiVersion=2026-03-10)
- [Microsoft .NET: `HttpClient.Timeout`](https://learn.microsoft.com/dotnet/api/system.net.http.httpclient.timeout)
- [PowerShell project and MIT license statement](https://github.com/PowerShell/PowerShell#legal-and-licensing)
- [Add-AppxPackage](https://learn.microsoft.com/en-us/powershell/module/appx/add-appxpackage)
- [Get-AuthenticodeSignature](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.security/get-authenticodesignature)
- [Programmatically validate an app-package signature](https://learn.microsoft.com/en-us/windows/win32/appxpkg/how-to-programmatically-sign-a-package)
