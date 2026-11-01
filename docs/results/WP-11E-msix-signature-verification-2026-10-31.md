# WP-11E: MSIX bundle signature verification research

**Date:** 2026-10-31  
**Status:** Source-based conclusion; no package operation or runtime test performed

## Finding

`Get-AuthenticodeSignature` on Windows should validate a signed `.msix` or `.msixbundle` through the supported Windows package-signature trust path. This is an inference from the PowerShell 7.6.9 implementation combined with Microsoft's explicit API guidance: the cmdlet routes a file path to `SignatureHelper.GetSignature`; that helper falls back to `WinVerifyTrust` with `WINTRUST_ACTION_GENERIC_VERIFY_V2`; Microsoft documents that exact action for validating Windows app-package signatures and says there are no special package-specific considerations. The cmdlet documentation itself does not explicitly enumerate MSIX extensions, so this conclusion is implementation-backed rather than stated directly in the cmdlet docs. [PowerShell cmdlet source](https://github.com/PowerShell/PowerShell/blob/v7.6.9/src/Microsoft.PowerShell.Security/security/SignatureCommands.cs#L1890-L1895), [signature helper source](https://github.com/PowerShell/PowerShell/blob/v7.6.9/src/System.Management.Automation/security/Authenticode.cs#L1850-L1874), [WinVerifyTrust call](https://github.com/PowerShell/PowerShell/blob/v7.6.9/src/System.Management.Automation/security/Authenticode.cs#L2043-L2088), [Microsoft app-package verification guidance](https://learn.microsoft.com/en-us/windows/win32/appxpkg/how-to-programmatically-sign-a-package#remarks).

For a PowerShell preflight, check the returned status and fail closed:

```powershell
$signature = Get-AuthenticodeSignature -LiteralPath $bundlePath
if ($signature.Status -ne 'Valid') { throw "MSIX bundle signature status: $($signature.Status)" }
```

The directly documented verification API is `WinVerifyTrust` with `WINTRUST_ACTION_GENERIC_VERIFY_V2`. The Windows SDK CLI alternative is `signtool verify /pa /v <bundle.msixbundle>`; `/pa` selects the Default Authentication Verification Policy because SignTool otherwise defaults to the Windows driver policy. [SignTool verification guidance](https://learn.microsoft.com/en-us/windows/win32/seccrypto/using-signtool-to-verify-a-file-signature).

MSIX bundle signing covers the packages inside the bundle. A valid status establishes trust under the device's Windows policy; it does not by itself assert that the signer is the expected PowerShell publisher. Compare the signer subject with the bundle manifest's `Publisher` and check the expected package identity separately. [MSIX signing overview](https://learn.microsoft.com/en-us/windows/msix/package/signing-package-overview), [package publisher requirement](https://learn.microsoft.com/en-us/windows/win32/appxpkg/how-to-sign-a-package-using-signtool). The verified bundle can then be passed to [Add-AppxPackage](https://learn.microsoft.com/en-us/powershell/module/appx/add-appxpackage).

## Verification limits

No `.msixbundle` was downloaded, verified, or installed, and no tests were run. The cited implementation is pinned to PowerShell tag `v7.6.9`; Windows-version-specific behavior remains untested here.
