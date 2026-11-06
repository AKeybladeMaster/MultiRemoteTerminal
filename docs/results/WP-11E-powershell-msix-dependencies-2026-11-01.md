# WP-11E: PowerShell MSIX dependency-path research

**Date:** 2026-11-01
**Status:** Source-based conclusion; no package download, signature verification, or deployment performed

## Finding

As of this review, GitHub's latest stable PowerShell release is `v7.6.9`; its stable bundle is `PowerShell-7.6.9.msixbundle` (352,267,317 bytes; GitHub release metadata reports SHA-256 `da75c8aa23edda52e888fb586a46b923ab37a7c243719c2e8914b00130c5917a`). The tag and asset are recorded by the [latest-release API](https://api.github.com/repos/PowerShell/PowerShell/releases/latest) and the [v7.6.9 release](https://github.com/PowerShell/PowerShell/releases/tag/v7.6.9).

The [v7.6.9 package manifest template](https://github.com/PowerShell/PowerShell/blob/v7.6.9/assets/AppxManifest.xml) declares only a `TargetDeviceFamily` inside `<Dependencies>`; it has no `PackageDependency` for an external framework. The [official bundle pipeline](https://github.com/PowerShell/PowerShell/blob/v7.6.9/.pipelines/templates/create-msixbundle-vpack.yml) collects the architecture-specific `.msix` application packages and bundles them. Microsoft's [PowerShell Windows installation instructions](https://learn.microsoft.com/en-us/powershell/scripting/install/install-powershell-on-windows?view=powershell-7.6) document manual bundle installation with `Add-AppxPackage -Path` and no `-DependencyPath` (their example bundle is an older release, 7.6.6).

Microsoft documents [`-DependencyPath`](https://learn.microsoft.com/en-us/powershell/module/appx/add-appxpackage?view=windowsserver2025-ps) as an array of paths to additional packages required by the app; it is optional and supports an `.msixbundle` as the main package. Because the reviewed PowerShell manifest declares no external package dependency, WP-11E does not need `-DependencyPath` or a separate framework-package download. Its existing `Add-AppxPackage -Path $bundle.FullName -Confirm` command matches the documented install workflow ([implementation](../../packages/application/src/powershell-tool-command.ts)). Revisit this if a future upstream package manifest adds `PackageDependency` entries.

## Limits

This conclusion follows the tagged source manifest and official install workflow, not an inspection of the published bundle. The 352 MB asset was not downloaded or unpacked, its embedded bundle and per-architecture manifests were not compared with the source template, and its Authenticode/MSIX signature was not independently checked. No Windows install was attempted, so artifact-level dependency behavior and signature acceptance remain unverified.
