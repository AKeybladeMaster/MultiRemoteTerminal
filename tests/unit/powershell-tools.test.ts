import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { isPowerShellToolAction } from '../../packages/domain/src/powershell-tools.ts';
import { powerShellToolCommand } from '../../packages/application/src/powershell-tool-command.ts';

test('generated PowerShell tool commands parse without executing on Windows', { skip: process.platform !== 'win32' }, () => {
  const executable = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const parser = '$script = [Console]::In.ReadToEnd(); $tokens = $null; $errors = $null; ' +
    '[void][System.Management.Automation.Language.Parser]::ParseInput($script, [ref]$tokens, [ref]$errors); ' +
    'if ($errors.Count -gt 0) { foreach ($errorItem in $errors) { [Console]::Error.WriteLine($errorItem.ToString()) }; exit 1 }';
  for (const action of ['install', 'update', 'remove'] as const) {
    const result = spawnSync(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', parser], {
      input: powerShellToolCommand(action), encoding: 'utf8', timeout: 10_000, windowsHide: true
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, action + ' command failed to parse: ' + (result.stderr || result.stdout));
  }
});

test('PowerShell tool actions are closed and constrain installation, identity checks, and removal scope', () => {
  assert.equal(isPowerShellToolAction('install'), true);
  assert.equal(isPowerShellToolAction('update'), true);
  assert.equal(isPowerShellToolAction('remove'), true);
  assert.equal(isPowerShellToolAction('winget install Git.Git'), false);

  for (const action of ['install', 'update'] as const) {
    const command = powerShellToolCommand(action);
    assert.match(command, /https:\/\/api\.github\.com\/repos\/PowerShell\/PowerShell\/releases\/latest/);
    assert.match(command, /Add-Type -AssemblyName System\.Net\.Http -ErrorAction Stop/);
    assert.match(command, /X-GitHub-Api-Version', '2026-03-10'/);
    assert.match(command, /AllowAutoRedirect = \$false/);
    assert.match(command, /CancelAfter\(\[TimeSpan\]::FromSeconds\(10\)\)/);
    assert.match(command, /ContentLength -gt 65536/);
    assert.match(command, /body\.Length \+ \$count -gt 65536/);
    assert.match(command, /System\.Text\.UTF8Encoding\]::new\(\$false, \$true\)/);
    assert.match(command, /\$utf8\.GetString\(\$body\.ToArray\(\)\)/);
    assert.match(command, /StatusCode -ne \[System\.Net\.HttpStatusCode\]::OK/);
    assert.match(command, /release\.draft -ne \$false -or \$release\.prerelease -ne \$false/);
    assert.match(command, /\$targetVersion -ne \$upstreamReleaseVersion/);
    assert.match(command, /\$release\.assets/);
    assert.match(command, /PowerShell-' \+ \$releaseVersionMatch\.Groups\['version'\]\.Value \+ '\.msixbundle'/);
    assert.match(command, /bundleAssets\.Count -ne 1/);
    assert.match(command, /bundleAssets\[0\]\.size -gt 1073741824/);
    assert.match(command, /sha256:\[0-9a-f\]\{64\}/);
    assert.match(command, /browser_download_url/);
    assert.match(command, /https:\/\/github\.com\/PowerShell\/PowerShell\/releases\/download\/v/);
    assert.match(command, /Microsoft\.PowerShell/);
    assert.match(command, /downloadHandler\.AllowAutoRedirect = \$false/);
    assert.match(command, /downloadClient\.Timeout = \[System\.Threading\.Timeout\]::InfiniteTimeSpan/);
    assert.match(command, /downloadDeadline\.CancelAfter\(\[TimeSpan\]::FromMinutes\(60\)\)/);
    assert.match(command, /redirectCount -le 3/);
    assert.match(command, /nextDownloadUri\.Port -ne 443/);
    assert.match(command, /downloadUri\.Port -ne 443/);
    assert.match(command, /EndsWith\('\.githubusercontent\.com'/);
    assert.match(command, /UseCookies = \$false; \$downloadHandler\.UseDefaultCredentials = \$false/);
    assert.match(command, /ContentLength -ne \$null/);
    assert.match(command, /FileMode\]::CreateNew, \[System\.IO\.FileAccess\]::Write, \[System\.IO\.FileShare\]::None/);
    assert.match(command, /PowerShell-' \+ \[guid\]::NewGuid\(\)\.ToString\('N'\) \+ '\.msixbundle'/);
    assert.match(command, /localAppDataDirectory\.Attributes -band \[System\.IO\.FileAttributes\]::ReparsePoint/);
    assert.match(command, /appDirectoryInfo\.Attributes -band \[System\.IO\.FileAttributes\]::ReparsePoint/);
    assert.match(command, /stageDirectory\.Attributes -band \[System\.IO\.FileAttributes\]::ReparsePoint/);
    assert.match(command, /if \(\$bundleCreated\) \{ try \{ Remove-Item -LiteralPath \$bundlePath -Force -ErrorAction Stop/);
    assert.doesNotMatch(command, /Remove-Item -LiteralPath \$stage -Recurse/u);
    assert.match(command, /ReadAsync\(\$downloadChunk, 0, \$downloadChunk\.Length, \$downloadDeadline\.Token\)/);
    assert.match(command, /The PowerShell release request failed or was cancelled/);
    assert.match(command, /The PowerShell release download was cancelled or timed out/);
    assert.match(command, /downloadedBytes \+ \$downloadCount -gt \$upstreamBundleBytes/);
    assert.match(command, /downloadedBytes -ne \$upstreamBundleBytes/);
    assert.match(command, /IncrementalHash\]::CreateHash/);
    assert.match(command, /downloadHasher\.GetHashAndReset\(\)/);
    assert.match(command, /BitConverter\]::ToString/);
    assert.match(command, /downloadFile\.Flush\(\$true\)/);
    assert.match(command, /Write-Progress -Activity 'Downloading PowerShell MSIX bundle'/);
    assert.doesNotMatch(command, /winget|--scope user/u);
    assert.match(command, /Get-AuthenticodeSignature -LiteralPath \$bundle\.FullName/);
    assert.match(command, /\$bundleLock\.Length -le 0 -or \$bundleLock\.Length -gt 1073741824 -or \$bundleLock\.Length -ne \$upstreamBundleBytes/);
    assert.match(command, /Get-FileHash -LiteralPath \$bundle\.FullName -Algorithm SHA256 -ErrorAction Stop/);
    assert.match(command, /\$bundleHash\.Hash -ine \$upstreamBundleHash/);
    assert.match(command, /\$signature\.Status -ne 'Valid'/);
    assert.match(command, /\$signature\.SignerCertificate\.Subject -cne \$expectedPublisher/);
    assert.match(command, /Add-Type -AssemblyName System\.IO\.Compression\.FileSystem/);
    assert.match(command, /AppxMetadata\/AppxBundleManifest\.xml/);
    assert.match(command, /\$manifestEntry\.Length -gt 1048576/);
    assert.match(command, /DtdProcessing = \[System\.Xml\.DtdProcessing\]::Prohibit/);
    assert.match(command, /MaxCharactersInDocument = 1048576/);
    assert.match(command, /manifestStream\.Dispose\(\)/);
    assert.match(command, /\$identity\.GetAttribute\('Name'\) -cne 'Microsoft\.PowerShell'/);
    assert.match(command, /GetAttribute\('Architecture'\) -ceq 'x64'/);
    assert.match(command, /\$targetVersion -lt \[version\]'7\.6\.9\.0'/);
    assert.match(command, /Add-AppxPackage -Path \$bundle\.FullName -Confirm/);
    assert.match(command, /\[version\]\$installed\[0\]\.Version -lt \$targetVersion/);
    assert.match(command, /\[version\]\$packages\[0\]\.Version -lt \$targetVersion/);
    assert.match(command, /\$bundleLock\.Dispose\(\)/);
    assert.match(command, /Get-AppxPackage -Name 'Microsoft\.PowerShell'/);
    assert.equal((command.match(/Get-AppxPackage -Name 'Microsoft\.PowerShell' -ErrorAction Stop/gu) ?? []).length, 2);
    assert.match(command, /Microsoft\.PowerShell_8wekyb3d8bbwe/);
    assert.match(command, /CN=Microsoft Corporation, O=Microsoft Corporation/);
    assert.match(command, /Architecture\.ToString\(\) -eq 'X64'/);
    assert.doesNotMatch(command, /--accept-(?:source|package)-agreements|--silent|--disable-interactivity|--force|--allow-reboot|--override/u);
  }
  assert.match(powerShellToolCommand('install'), /downloadedBytes \+ \$downloadCount -gt \$upstreamBundleBytes/);
  assert.match(powerShellToolCommand('update'), /'update' -ceq 'update'/);
  const remove = powerShellToolCommand('remove');
  assert.match(remove, /Get-AppxPackage -Name 'Microsoft\.PowerShell'/);
  assert.equal((remove.match(/Get-AppxPackage -Name 'Microsoft\.PowerShell' -ErrorAction Stop/gu) ?? []).length, 2);
  assert.match(remove, /Microsoft\.PowerShell_8wekyb3d8bbwe/);
  assert.match(remove, /Remove-AppxPackage -Confirm -ErrorAction Stop/);
  assert.match(remove, /Get-AppxPackage -Name 'Microsoft\.PowerShell' -ErrorAction Stop/);
  assert.match(remove, /\$remaining\.Count -ne 0/);
  assert.doesNotMatch(remove, /winget|--all|--silent|--disable-interactivity/u);
  assert.doesNotMatch(remove, /api\.github\.com|releases\/latest/u);
  assert.throws(() => powerShellToolCommand('remove; Stop-Computer' as never), /Unsupported PowerShell tool action/u);
});
