param(
  [string]$Subject = "CN=Loreloom Studio",
  [string]$OutputDir = "$PSScriptRoot",
  [string]$Password = "",
  [int]$ValidYears = 5
)

$ErrorActionPreference = "Stop"

if (-not $Password) {
  $bytes = New-Object byte[] 24
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $Password = [Convert]::ToBase64String($bytes)
}

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

$cert = New-SelfSignedCertificate `
  -Type CodeSigningCert `
  -Subject $Subject `
  -CertStoreLocation "Cert:\CurrentUser\My" `
  -KeyUsage DigitalSignature `
  -FriendlyName "Loreloom Studio Code Signing" `
  -NotAfter (Get-Date).AddYears($ValidYears)

$securePwd = ConvertTo-SecureString -String $Password -Force -AsPlainText
$pfxPath = Join-Path $OutputDir "LoreloomStudio.pfx"
$cerPath = Join-Path $OutputDir "LoreloomStudio.cer"

Export-PfxCertificate -Cert $cert -FilePath $pfxPath -Password $securePwd | Out-Null
Export-Certificate -Cert $cert -FilePath $cerPath | Out-Null

Write-Host "Generated self-signed code-signing certificate:"
Write-Host "  Thumbprint : $($cert.Thumbprint)"
Write-Host "  Public CER : $cerPath (safe to commit & install on your PCs)"
Write-Host "  Private PFX: $pfxPath (NEVER commit - gitignored)"
Write-Host "  Expires    : $($cert.NotAfter)"
