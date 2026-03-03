param(
  [Parameter(Mandatory = $true)]
  [string]$EncryptedFile,
  [string]$OutputDir = "backups/secrets/restored"
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $repoRoot

$encryptedPath = if ([System.IO.Path]::IsPathRooted($EncryptedFile)) {
  $EncryptedFile
} else {
  Join-Path $repoRoot $EncryptedFile
}

if (-not (Test-Path $encryptedPath)) {
  throw "Encrypted file not found: $encryptedPath"
}

$targetDir = Join-Path $repoRoot $OutputDir
if (-not (Test-Path $targetDir)) {
  New-Item -Path $targetDir -ItemType Directory -Force | Out-Null
}

$securePassword = Read-Host "Enter decryption password" -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
try {
  $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}

if ([string]::IsNullOrWhiteSpace($password)) {
  throw "Password cannot be empty"
}

$bytes = [System.IO.File]::ReadAllBytes($encryptedPath)
if ($bytes.Length -lt 39) {
  throw "Invalid encrypted file"
}

$headerLength = 7
$header = [System.Text.Encoding]::UTF8.GetString($bytes, 0, $headerLength)
if ($header -ne "IMSBKP1") {
  throw "Invalid backup header"
}

$salt = New-Object byte[] 16
$iv = New-Object byte[] 16
[Array]::Copy($bytes, $headerLength, $salt, 0, 16)
[Array]::Copy($bytes, $headerLength + 16, $iv, 0, 16)

$cipherOffset = $headerLength + 16 + 16
$cipherLength = $bytes.Length - $cipherOffset
$cipherBytes = New-Object byte[] $cipherLength
[Array]::Copy($bytes, $cipherOffset, $cipherBytes, 0, $cipherLength)

$kdf = [System.Security.Cryptography.Rfc2898DeriveBytes]::new($password, $salt, 120000, [System.Security.Cryptography.HashAlgorithmName]::SHA256)
$key = $kdf.GetBytes(32)

$aes = [System.Security.Cryptography.Aes]::Create()
$aes.Mode = [System.Security.Cryptography.CipherMode]::CBC
$aes.Padding = [System.Security.Cryptography.PaddingMode]::PKCS7
$aes.Key = $key
$aes.IV = $iv

$decryptor = $aes.CreateDecryptor()
$plainBytes = $decryptor.TransformFinalBlock($cipherBytes, 0, $cipherBytes.Length)

$tempZip = Join-Path $env:TEMP ("restore-secrets-" + [Guid]::NewGuid().ToString() + ".zip")
[System.IO.File]::WriteAllBytes($tempZip, $plainBytes)

Expand-Archive -Path $tempZip -DestinationPath $targetDir -Force
Remove-Item $tempZip -Force

Write-Host "OK: restored to $targetDir"
