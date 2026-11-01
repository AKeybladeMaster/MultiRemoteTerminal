import { isPowerShellToolAction } from '../../domain/src/powershell-tools.ts';
import type { PowerShellToolAction } from '../../domain/src/powershell-tools.ts';

// shortcut: the asset digest shares GitHub/TLS trust; upgrade when independent signed release provenance is available.
const MINIMUM_POWERSHELL_MSIX_VERSION = '7.6.9.0';
const MAX_POWERSHELL_MSIX_BUNDLE_BYTES = 1024 * 1024 * 1024;

const VERIFY_UPSTREAM_RELEASE = "Add-Type -AssemblyName System.Net.Http -ErrorAction Stop; " +
  "$handler = [System.Net.Http.HttpClientHandler]::new(); $handler.AllowAutoRedirect = $false; " +
  "$client = [System.Net.Http.HttpClient]::new($handler); $deadline = [System.Threading.CancellationTokenSource]::new(); " +
  "$deadline.CancelAfter([TimeSpan]::FromSeconds(10)); $request = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::Get, " +
  "'https://api.github.com/repos/PowerShell/PowerShell/releases/latest'); $request.Headers.Accept.ParseAdd('application/vnd.github+json'); " +
  "$request.Headers.UserAgent.ParseAdd('MultiRemoteTerminal'); $request.Headers.Add('X-GitHub-Api-Version', '2026-03-10'); " +
  "$response = $null; $stream = $null; $body = [System.IO.MemoryStream]::new(); " +
  "try { $response = $client.SendAsync($request, [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead, $deadline.Token).GetAwaiter().GetResult(); " +
  "if ($response.StatusCode -ne [System.Net.HttpStatusCode]::OK -or $response.Content.Headers.ContentLength -gt 65536) { throw 'Could not verify the latest PowerShell release.' }; " +
  "$stream = $response.Content.ReadAsStreamAsync().GetAwaiter().GetResult(); $chunk = New-Object byte[] 8192; $count = 0; " +
  "while (($count = $stream.ReadAsync($chunk, 0, $chunk.Length, $deadline.Token).GetAwaiter().GetResult()) -gt 0) { " +
  "if ($body.Length + $count -gt 65536) { throw 'The PowerShell release metadata exceeded its size limit.' }; $body.Write($chunk, 0, $count) }; " +
  "$utf8 = [System.Text.UTF8Encoding]::new($false, $true); $release = $utf8.GetString($body.ToArray()) | ConvertFrom-Json -ErrorAction Stop; " +
  "if ($release.draft -ne $false -or $release.prerelease -ne $false) { throw 'The latest PowerShell release metadata was not stable.' }; " +
  "$releaseVersionMatch = [regex]::Match([string]$release.tag_name, '^v(?<version>\\d+\\.\\d+\\.\\d+)$'); " +
  "if (-not $releaseVersionMatch.Success) { throw 'The latest PowerShell release tag format is unsupported.' }; " +
  "$upstreamReleaseVersion = [version]($releaseVersionMatch.Groups['version'].Value + '.0'); " +
  "$bundleAssetName = 'PowerShell-' + $releaseVersionMatch.Groups['version'].Value + '.msixbundle'; " +
  "$bundleAssets = @($release.assets | Where-Object { $_.name -ceq $bundleAssetName -and $_.state -ceq 'uploaded' }); " +
  "if ($bundleAssets.Count -ne 1 -or ($bundleAssets[0].size -isnot [int] -and $bundleAssets[0].size -isnot [long]) -or " +
  `$bundleAssets[0].size -le 0 -or $bundleAssets[0].size -gt ${MAX_POWERSHELL_MSIX_BUNDLE_BYTES} -or ` +
  "-not [regex]::IsMatch([string]$bundleAssets[0].digest, '(?i)^sha256:[0-9a-f]{64}$')) { throw 'The latest PowerShell release has no bounded, hashed x64 MSIX bundle asset.' }; " +
  "$upstreamBundleBytes = [long]$bundleAssets[0].size; $upstreamBundleHash = ([string]$bundleAssets[0].digest).Substring(7); " +
  "$upstreamBundleUrl = [string]$bundleAssets[0].browser_download_url; " +
  "$expectedBundleUrl = 'https://github.com/PowerShell/PowerShell/releases/download/v' + $releaseVersionMatch.Groups['version'].Value + '/' + $bundleAssetName; " +
  "if ($upstreamBundleUrl -cne $expectedBundleUrl) { throw 'The PowerShell release asset URL is not the expected official bundle URL.' } " +
  "} finally { if ($stream) { $stream.Dispose() }; if ($response) { $response.Dispose() }; $request.Dispose(); $body.Dispose(); $deadline.Dispose(); $client.Dispose() }; ";

const VERIFY_POWERSHELL_MSIX = "$packages = @(Get-AppxPackage -Name 'Microsoft.PowerShell' -ErrorAction Stop | Where-Object { " +
  "$_.PackageFamilyName -eq 'Microsoft.PowerShell_8wekyb3d8bbwe' -and " +
  "$_.Publisher -eq 'CN=Microsoft Corporation, O=Microsoft Corporation, L=Redmond, S=Washington, C=US' -and " +
  "$_.Architecture.ToString() -eq 'X64' }); " +
  "if ($packages.Count -ne 1) { throw 'A verified Microsoft PowerShell x64 MSIX package is not registered for this user.' }; ";

const DOWNLOAD_VERIFY_AND_INSTALL_POWERSHELL_MSIX = (action: PowerShellToolAction) =>
  "$expectedPublisher = 'CN=Microsoft Corporation, O=Microsoft Corporation, L=Redmond, S=Washington, C=US'; " +
  "if (-not $env:LOCALAPPDATA) { throw 'The current-user package staging directory is unavailable.' }; " +
  "$localAppDataDirectory = Get-Item -LiteralPath $env:LOCALAPPDATA -Force -ErrorAction Stop; " +
  "$appDirectory = Join-Path $env:LOCALAPPDATA 'MultiRemoteTerminal'; " +
  "$appDirectoryInfo = Get-Item -LiteralPath $appDirectory -Force -ErrorAction SilentlyContinue; " +
  "if (($localAppDataDirectory.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -or " +
  "($appDirectoryInfo -and ($appDirectoryInfo.Attributes -band [System.IO.FileAttributes]::ReparsePoint))) { throw 'The package staging parent cannot be a reparse point.' }; " +
  "$stage = Join-Path $appDirectory 'package-staging'; " +
  "[System.IO.Directory]::CreateDirectory($stage) | Out-Null; $stageDirectory = Get-Item -LiteralPath $stage -Force -ErrorAction Stop; " +
  "if ($stageDirectory.Attributes -band [System.IO.FileAttributes]::ReparsePoint) { throw 'The package staging directory cannot be a reparse point.' }; " +
  "$bundlePath = Join-Path $stage ('PowerShell-' + [guid]::NewGuid().ToString('N') + '.msixbundle'); $bundleCreated = $false; " +
  "try { " +
  "$downloadHandler = [System.Net.Http.HttpClientHandler]::new(); $downloadHandler.AllowAutoRedirect = $false; " +
  "$downloadHandler.UseCookies = $false; $downloadHandler.UseDefaultCredentials = $false; " +
  "$downloadClient = [System.Net.Http.HttpClient]::new($downloadHandler); $downloadClient.Timeout = [System.Threading.Timeout]::InfiniteTimeSpan; " +
  "$downloadDeadline = [System.Threading.CancellationTokenSource]::new(); " +
  "$downloadDeadline.CancelAfter([TimeSpan]::FromMinutes(60)); $downloadUri = [uri]$upstreamBundleUrl; $downloaded = $false; " +
  "try { Write-Output ('Downloading PowerShell ' + $upstreamReleaseVersion + ' MSIX bundle.'); " +
  "for ($redirectCount = 0; $redirectCount -le 3; $redirectCount++) { " +
  "$downloadRequest = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::Get, $downloadUri); " +
  "$downloadRequest.Headers.UserAgent.ParseAdd('MultiRemoteTerminal'); $downloadResponse = $null; $downloadStream = $null; " +
  "$downloadFile = $null; $downloadHasher = $null; " +
  "try { try { $downloadResponse = $downloadClient.SendAsync($downloadRequest, [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead, $downloadDeadline.Token).GetAwaiter().GetResult() } " +
  "catch { throw 'The PowerShell release request failed or was cancelled.' }; " +
  "if ([int]$downloadResponse.StatusCode -in @(301, 302, 303, 307, 308)) { " +
  "if ($redirectCount -eq 3 -or -not $downloadResponse.Headers.Location) { throw 'The PowerShell release download exceeded its redirect limit or omitted a location.' }; " +
  "$nextDownloadUri = [uri]::new($downloadUri, $downloadResponse.Headers.Location); " +
  "if ($nextDownloadUri.Scheme -cne 'https' -or $nextDownloadUri.Port -ne 443 -or $nextDownloadUri.UserInfo -or " +
  "($nextDownloadUri.Host -cne 'github.com' -and $nextDownloadUri.Host -cne 'githubusercontent.com' -and " +
  "-not $nextDownloadUri.Host.EndsWith('.githubusercontent.com', [System.StringComparison]::OrdinalIgnoreCase))) { throw 'The PowerShell release download redirected to an unapproved host.' }; " +
  "$downloadUri = $nextDownloadUri; continue }; " +
  "if ($downloadResponse.StatusCode -ne [System.Net.HttpStatusCode]::OK -or $downloadUri.Port -ne 443 -or " +
  "($downloadUri.Host -cne 'github.com' -and $downloadUri.Host -cne 'githubusercontent.com' -and " +
  "-not $downloadUri.Host.EndsWith('.githubusercontent.com', [System.StringComparison]::OrdinalIgnoreCase)) -or " +
  "($downloadResponse.Content.Headers.ContentLength -ne $null -and [long]$downloadResponse.Content.Headers.ContentLength -ne $upstreamBundleBytes)) { throw 'The PowerShell release download response was not the expected bounded asset.' }; " +
  "$downloadStream = $downloadResponse.Content.ReadAsStreamAsync().GetAwaiter().GetResult(); " +
  "$downloadFile = [System.IO.File]::Open($bundlePath, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None); $bundleCreated = $true; " +
  "$downloadHasher = [System.Security.Cryptography.IncrementalHash]::CreateHash([System.Security.Cryptography.HashAlgorithmName]::SHA256); " +
  "$downloadChunk = New-Object byte[] 65536; $downloadedBytes = [long]0; $nextProgressBytes = [long]16777216; " +
  "while ($true) { try { $downloadCount = $downloadStream.ReadAsync($downloadChunk, 0, $downloadChunk.Length, $downloadDeadline.Token).GetAwaiter().GetResult() } " +
  "catch [System.OperationCanceledException] { throw 'The PowerShell release download was cancelled or timed out.' } " +
  "catch { throw 'The PowerShell release download failed.' }; if ($downloadCount -le 0) { break }; " +
  "if ($downloadedBytes + $downloadCount -gt $upstreamBundleBytes) { throw 'The PowerShell release download exceeded its declared size.' }; " +
  "$downloadFile.Write($downloadChunk, 0, $downloadCount); $downloadHasher.AppendData($downloadChunk, 0, $downloadCount); $downloadedBytes += $downloadCount; " +
  "if ($downloadedBytes -ge $nextProgressBytes) { Write-Progress -Activity 'Downloading PowerShell MSIX bundle' " +
  "-Status ($downloadedBytes.ToString('N0') + ' of ' + $upstreamBundleBytes.ToString('N0') + ' bytes') " +
  "-PercentComplete ([int](100 * $downloadedBytes / $upstreamBundleBytes)); $nextProgressBytes += 16777216 } }; " +
  "Write-Progress -Activity 'Downloading PowerShell MSIX bundle' -Completed; " +
  "if ($downloadedBytes -ne $upstreamBundleBytes -or [BitConverter]::ToString($downloadHasher.GetHashAndReset()).Replace('-', '') -ine $upstreamBundleHash) { throw 'The PowerShell release download size or SHA-256 does not match GitHub release metadata.' }; " +
  "$downloadFile.Flush($true); $downloaded = $true } finally { if ($downloadHasher) { $downloadHasher.Dispose() }; " +
  "if ($downloadFile) { $downloadFile.Dispose() }; if ($downloadStream) { $downloadStream.Dispose() }; " +
  "if ($downloadResponse) { $downloadResponse.Dispose() }; $downloadRequest.Dispose() }; " +
  "if ($downloaded) { break } }; if (-not $downloaded) { throw 'The PowerShell release download did not complete.' } " +
  "} finally { $downloadDeadline.Dispose(); $downloadClient.Dispose() }; " +
  "$bundle = Get-Item -LiteralPath $bundlePath -ErrorAction Stop; if ($bundle.Extension -ine '.msixbundle') { throw 'The official PowerShell release did not produce the expected MSIX bundle.' }; " +
  "$bundleLock = [System.IO.File]::Open($bundle.FullName, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read); " +
  `try { if ($bundleLock.Length -le 0 -or $bundleLock.Length -gt ${MAX_POWERSHELL_MSIX_BUNDLE_BYTES} -or $bundleLock.Length -ne $upstreamBundleBytes) { throw 'The PowerShell MSIX bundle is empty, oversized, or differs from the release asset size.' }; ` +
  "$bundleHash = Get-FileHash -LiteralPath $bundle.FullName -Algorithm SHA256 -ErrorAction Stop; " +
  "if ($bundleHash.Hash -ine $upstreamBundleHash) { throw 'The PowerShell MSIX bundle does not match the latest release asset SHA-256.' }; " +
  " $signature = Get-AuthenticodeSignature -LiteralPath $bundle.FullName -ErrorAction Stop; " +
  "if ($signature.Status -ne 'Valid' -or -not $signature.SignerCertificate -or $signature.SignerCertificate.Subject -cne $expectedPublisher) { throw 'The PowerShell bundle does not have a valid Microsoft publisher signature.' }; " +
  "Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction Stop; $archive = [System.IO.Compression.ZipFile]::OpenRead($bundle.FullName); " +
  "try { $manifestEntry = $archive.GetEntry('AppxMetadata/AppxBundleManifest.xml'); if (-not $manifestEntry -or $manifestEntry.Length -gt 1048576) { throw 'The PowerShell bundle manifest is missing or oversized.' }; " +
  "$readerSettings = [System.Xml.XmlReaderSettings]::new(); $readerSettings.DtdProcessing = [System.Xml.DtdProcessing]::Prohibit; $readerSettings.XmlResolver = $null; $readerSettings.MaxCharactersInDocument = 1048576; " +
  "$manifestStream = $manifestEntry.Open(); try { $reader = [System.Xml.XmlReader]::Create($manifestStream, $readerSettings); try { $manifest = [System.Xml.XmlDocument]::new(); $manifest.XmlResolver = $null; $manifest.Load($reader) } finally { $reader.Dispose() } } finally { $manifestStream.Dispose() }; " +
  "$identity = $manifest.SelectSingleNode(\"/*[local-name()='Bundle']/*[local-name()='Identity']\"); " +
  "if (-not $identity -or $identity.GetAttribute('Name') -cne 'Microsoft.PowerShell' -or $identity.GetAttribute('Publisher') -cne $expectedPublisher) { throw 'The downloaded bundle identity is not the approved PowerShell package.' }; " +
  "$x64Packages = @($manifest.SelectNodes(\"/*[local-name()='Bundle']/*[local-name()='Packages']/*[local-name()='Package']\") | Where-Object { $_.GetAttribute('Type') -ceq 'application' -and $_.GetAttribute('Architecture') -ceq 'x64' }); " +
  "if ($x64Packages.Count -eq 0) { throw 'The downloaded PowerShell bundle does not contain an x64 application package.' }; $targetVersion = [version]$identity.GetAttribute('Version'); " +
  `if ($targetVersion -lt [version]'${MINIMUM_POWERSHELL_MSIX_VERSION}') { throw 'The downloaded PowerShell bundle is below the approved minimum version.' }; ` +
  "if ($targetVersion -ne $upstreamReleaseVersion) { throw 'The downloaded PowerShell bundle does not match the latest stable upstream release.' } } finally { $archive.Dispose() }; " +
  "$installed = @(Get-AppxPackage -Name 'Microsoft.PowerShell' -ErrorAction Stop | Where-Object { $_.PackageFamilyName -eq 'Microsoft.PowerShell_8wekyb3d8bbwe' -and $_.Publisher -eq $expectedPublisher -and $_.Architecture.ToString() -eq 'X64' }); " +
  "if ($installed.Count -gt 1) { throw 'Multiple matching PowerShell packages are registered for this user.' }; " +
  `if ('${action}' -ceq 'update' -and $installed.Count -eq 0) { throw 'PowerShell 7 is not installed for this user.' }; ` +
  "if ($installed.Count -eq 0 -or [version]$installed[0].Version -lt $targetVersion) { Add-AppxPackage -Path $bundle.FullName -Confirm -ErrorAction Stop } else { Write-Output 'The verified PowerShell package is already at this version or newer.' }; " +
  `} finally { $bundleLock.Dispose() } } finally { if ($bundleCreated) { try { Remove-Item -LiteralPath $bundlePath -Force -ErrorAction Stop } catch { Write-Warning 'The temporary PowerShell bundle could not be removed.' } } }`;

const REMOVE_POWERSHELL_MSIX = `${VERIFY_POWERSHELL_MSIX}$packages[0] | Remove-AppxPackage -Confirm -ErrorAction Stop; ` +
  "$remaining = @(Get-AppxPackage -Name 'Microsoft.PowerShell' -ErrorAction Stop | Where-Object { $_.PackageFamilyName -eq $packages[0].PackageFamilyName -and " +
  "$_.Publisher -eq $packages[0].Publisher -and $_.Architecture.ToString() -eq 'X64' }); " +
  "if ($remaining.Count -ne 0) { throw 'The verified PowerShell package is still registered for this user.' }; " +
  "Write-Output 'The verified PowerShell package was removed.'";

export function powerShellToolCommand(action: PowerShellToolAction): string {
  if (!isPowerShellToolAction(action)) throw new TypeError('Unsupported PowerShell tool action.');
  if (action === 'remove') return REMOVE_POWERSHELL_MSIX;
  return `${VERIFY_UPSTREAM_RELEASE}${DOWNLOAD_VERIFY_AND_INSTALL_POWERSHELL_MSIX(action)}${VERIFY_POWERSHELL_MSIX}` +
    "if ([version]$packages[0].Version -lt $targetVersion) { throw 'PowerShell deployment did not reach the requested release version.' };";
}
