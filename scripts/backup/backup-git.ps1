param(
  [string]$OutputDir = "backups/git"
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $repoRoot

$targetDir = Join-Path $repoRoot $OutputDir
if (-not (Test-Path $targetDir)) {
  New-Item -Path $targetDir -ItemType Directory -Force | Out-Null
}

$timestamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
$bundleName = "git-backup-$timestamp.bundle"
$bundlePath = Join-Path $targetDir $bundleName

Write-Host "Creating git bundle: $bundlePath"
git bundle create $bundlePath --all
if ($LASTEXITCODE -ne 0) {
  throw "git bundle failed"
}

Write-Host "Verifying bundle"
git bundle verify $bundlePath | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "git bundle verify failed"
}

Write-Host "OK: $bundlePath"
