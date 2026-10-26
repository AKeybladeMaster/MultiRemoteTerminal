param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('ssh-password', 'ssh-key-passphrase', 'ssh-agent-username', 'ftp-account', 'master-password')]
    [string] $Purpose,
    [ValidateLength(0, 256)]
    [string] $Context = ''
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$purposeMessages = @{
    'ssh-password' = 'Enter the SSH account credential.'
    'ssh-key-passphrase' = 'Unlock the selected SSH private key.'
    'ssh-agent-username' = 'Enter the SSH account username. Leave the password blank; your Windows OpenSSH agent will sign authentication requests.'
    'ftp-account' = 'Enter the FTP account credential.'
    'master-password' = 'Enter the vault master password.'
}
$message = $purposeMessages[$Purpose]
$contextText = ($Context -replace '[\x00-\x1f\x7f]', ' ').Trim()
if (-not [string]::IsNullOrWhiteSpace($contextText)) {
    $message = "$message`r`n`r`n$contextText"
}
$credential = $null
$secret = $null
$json = $null
$exitCode = 0
$reply = @{ kind = 'cancelled' }

try {
    $credential = Get-Credential -Message $message
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
