param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Enter the SSH account credential.', 'Unlock the selected SSH private key.', 'Enter the vault master password.')]
    [string] $Message
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$credential = $null
$secret = $null
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
    [Console]::Out.Write((ConvertTo-Json -InputObject $reply -Compress))
} catch {
    $exitCode = 1
} finally {
    $secret = $null
    $credential = $null
    $reply = $null
}

exit $exitCode
