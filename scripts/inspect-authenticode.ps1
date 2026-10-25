param(
  [Parameter(Mandatory = $true)][string]$ArtifactDirectory,
  [Parameter(Mandatory = $true)][string]$ArtifactNamesBase64
)

$ErrorActionPreference = 'Stop'
$root = [System.IO.Path]::GetFullPath($ArtifactDirectory)
$artifactNames = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($ArtifactNamesBase64))
$names = @($artifactNames -split "`n" | ForEach-Object { $_.TrimEnd("`r") } | Where-Object { $_.Length -gt 0 })
$results = foreach ($name in $names) {
  if ([System.IO.Path]::IsPathRooted($name) -or $name.Contains('..') -or $name.Contains('/') -or $name.Contains('\')) {
    throw 'An artifact name must be a simple file name.'
  }
  $path = Join-Path $root $name
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Missing packaged artifact: $name" }
  $signature = Get-AuthenticodeSignature -LiteralPath $path
  $signerSubject = $null
  $signerThumbprint = $null
  if ($signature.SignerCertificate) {
    $signerSubject = [string]$signature.SignerCertificate.Subject
    $signerThumbprint = [string]$signature.SignerCertificate.Thumbprint
  }
  [PSCustomObject]@{
    file = $name
    status = [string]$signature.Status
    signerSubject = $signerSubject
    signerThumbprint = $signerThumbprint
  }
}

ConvertTo-Json -InputObject @($results) -Depth 4 -Compress
