param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Enter the SSH account credential.', 'Unlock the selected SSH private key.', 'Enter the FTP account credential.', 'Enter the vault master password.')]
    [string] $Message
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$credential = $null
$secret = $null
$json = $null
$exitCode = 0
$reply = @{ kind = 'cancelled' }

try {
    $credential = Get-Credential -Message $Message
    if ($null -ne $credential) {
        $secret = $credential.GetNetworkCredential().Password
        $reply = @{ kind = 'provided'; username = $credential.UserName; secret = $secret }
    }
} catch {
    $reply = @{ kind = 'unavailable' }
    $exitCode = 1
}

try {
    $json = ConvertTo-Json -InputObject $reply -Compress
    if ([System.Text.Encoding]::UTF8.GetByteCount($json) -gt 65536) {
        $json = '{"kind":"unavailable"}'
        $exitCode = 1
    }
    [Console]::Out.Write($json)
} catch {
    $exitCode = 1
} finally {
    $json = $null
    $secret = $null
    $credential = $null
    $reply = $null
}

exit $exitCode
