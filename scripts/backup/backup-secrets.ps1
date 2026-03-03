param(
  [string]$OutputDir = "backups/secrets",
  [string[]]$IncludeFiles = @(".env", ".env.local", ".env.production", ".env.development")
)

$ErrorActionPreference = "Stop"

function Fill-RandomBytes {
  param(
    [byte[]]$Buffer
  )

  $rng = [System.Security.Cryptography.RNGCryptoServiceProvider]::new()
  try {
    $rng.GetBytes($Buffer)
  } finally {
    $rng.Dispose()
  }
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $repoRoot

$targetDir = Join-Path $repoRoot $OutputDir
if (-not (Test-Path $targetDir)) {
  New-Item -Path $targetDir -ItemType Directory -Force | Out-Null
}

$existingFiles = @()
foreach ($file in $IncludeFiles) {
  $fullPath = Join-Path $repoRoot $file
  if (Test-Path $fullPath) {
    $existingFiles += $fullPath
  }
}

if ($existingFiles.Count -eq 0) {
  throw "No secret files found. Checked: $($IncludeFiles -join ', ')"
}

$securePassword = Read-Host "Enter encryption password" -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
try {
  $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}

if ([string]::IsNullOrWhiteSpace($password)) {
  throw "Password cannot be empty"
}

$timestamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
$tempZip = Join-Path $env:TEMP "secrets-$timestamp.zip"
$outputFile = Join-Path $targetDir "secrets-$timestamp.enc"

if (Test-Path $tempZip) { Remove-Item $tempZip -Force }
Compress-Archive -Path $existingFiles -DestinationPath $tempZip -Force

$plainBytes = [System.IO.File]::ReadAllBytes($tempZip)
$salt = New-Object byte[] 16
$iv = New-Object byte[] 16
Fill-RandomBytes -Buffer $salt
Fill-RandomBytes -Buffer $iv

$kdf = [System.Security.Cryptography.Rfc2898DeriveBytes]::new($password, $salt, 120000, [System.Security.Cryptography.HashAlgorithmName]::SHA256)
$key = $kdf.GetBytes(32)

$aes = [System.Security.Cryptography.Aes]::Create()
$aes.Mode = [System.Security.Cryptography.CipherMode]::CBC
$aes.Padding = [System.Security.Cryptography.PaddingMode]::PKCS7
$aes.Key = $key
$aes.IV = $iv

$encryptor = $aes.CreateEncryptor()
$cipherBytes = $encryptor.TransformFinalBlock($plainBytes, 0, $plainBytes.Length)

$header = [System.Text.Encoding]::UTF8.GetBytes("IMSBKP1")
$allBytes = New-Object byte[] ($header.Length + $salt.Length + $iv.Length + $cipherBytes.Length)
[Array]::Copy($header, 0, $allBytes, 0, $header.Length)
[Array]::Copy($salt, 0, $allBytes, $header.Length, $salt.Length)
[Array]::Copy($iv, 0, $allBytes, $header.Length + $salt.Length, $iv.Length)
[Array]::Copy($cipherBytes, 0, $allBytes, $header.Length + $salt.Length + $iv.Length, $cipherBytes.Length)

[System.IO.File]::WriteAllBytes($outputFile, $allBytes)
Remove-Item $tempZip -Force

Write-Host "OK: $outputFile"
