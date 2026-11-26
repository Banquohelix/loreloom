param(
  [string]$CerPath = "$PSScriptRoot\LoreloomStudio.cer",
  [ValidateSet("CurrentUser", "LocalMachine")]
  [string]$Scope = "CurrentUser"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $CerPath)) {
  throw "Public certificate not found at $CerPath"
}

Write-Host "Installing $CerPath into $Scope Trusted Root & Trusted Publishers..."
Import-Certificate -FilePath $CerPath -CertStoreLocation "Cert:\$Scope\Root" | Out-Null
Import-Certificate -FilePath $CerPath -CertStoreLocation "Cert:\$Scope\TrustedPublisher" | Out-Null

Write-Host "Done! Windows on this PC will now trust Loreloom builds signed with this certificate."
