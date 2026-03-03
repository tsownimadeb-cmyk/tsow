param(
  [string]$OutputDir = "backups/database"
)

$ErrorActionPreference = "Stop"

function Get-EnvValueFromFile {
  param(
    [string]$FilePath,
    [string]$Key
  )

  if (-not (Test-Path $FilePath)) {
    return $null
  }

  $line = Get-Content -Path $FilePath | Where-Object {
    $_ -match "^\s*$Key\s*="
  } | Select-Object -First 1

  if (-not $line) {
    return $null
  }

  $value = ($line -replace "^\s*$Key\s*=\s*", "").Trim()
  if ($value.StartsWith('"') -and $value.EndsWith('"')) {
    $value = $value.Substring(1, $value.Length - 2)
  }
  if ($value.StartsWith("'") -and $value.EndsWith("'")) {
    $value = $value.Substring(1, $value.Length - 2)
  }

  return $value
}

function Resolve-PgDumpPath {
  if (-not [string]::IsNullOrWhiteSpace($env:PG_DUMP_PATH) -and (Test-Path $env:PG_DUMP_PATH)) {
    return $env:PG_DUMP_PATH
  }

  $cmd = Get-Command pg_dump -ErrorAction SilentlyContinue
  if ($cmd -and (Test-Path $cmd.Source)) {
    return $cmd.Source
  }

  $candidates = @(
    "D:\PostgreSQL\*\bin\pg_dump.exe",
    "C:\Program Files\PostgreSQL\*\bin\pg_dump.exe",
    "C:\Program Files (x86)\PostgreSQL\*\bin\pg_dump.exe"
  )

  foreach ($pattern in $candidates) {
    $found = Get-ChildItem -Path $pattern -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1
    if ($found) {
      return $found.FullName
    }
  }

  return $null
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $repoRoot

$targetDir = Join-Path $repoRoot $OutputDir
if (-not (Test-Path $targetDir)) {
  New-Item -Path $targetDir -ItemType Directory -Force | Out-Null
}

$dbUrl = $env:SUPABASE_DB_URL
if ([string]::IsNullOrWhiteSpace($dbUrl)) {
  $dbUrl = $env:DATABASE_URL
}

if ([string]::IsNullOrWhiteSpace($dbUrl)) {
  $dbUrl = Get-EnvValueFromFile -FilePath (Join-Path $repoRoot ".env.local") -Key "SUPABASE_DB_URL"
}

if ([string]::IsNullOrWhiteSpace($dbUrl)) {
  $dbUrl = Get-EnvValueFromFile -FilePath (Join-Path $repoRoot ".env.local") -Key "DATABASE_URL"
}

if ([string]::IsNullOrWhiteSpace($dbUrl)) {
  $dbUrl = Get-EnvValueFromFile -FilePath (Join-Path $repoRoot ".env") -Key "SUPABASE_DB_URL"
}

if ([string]::IsNullOrWhiteSpace($dbUrl)) {
  $dbUrl = Get-EnvValueFromFile -FilePath (Join-Path $repoRoot ".env") -Key "DATABASE_URL"
}

if ([string]::IsNullOrWhiteSpace($dbUrl)) {
  throw "SUPABASE_DB_URL or DATABASE_URL is required (env var or .env.local/.env)"
}

$pgDumpPath = Resolve-PgDumpPath
if ([string]::IsNullOrWhiteSpace($pgDumpPath)) {
  throw "pg_dump not found. Install PostgreSQL client tools or set PG_DUMP_PATH to pg_dump.exe"
}

$timestamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
$dumpPath = Join-Path $targetDir "supabase-db-$timestamp.dump"

Write-Host "Creating DB dump: $dumpPath"
& $pgDumpPath --format=custom --no-owner --no-privileges --file=$dumpPath $dbUrl
if ($LASTEXITCODE -ne 0) {
  throw "pg_dump failed"
}

Write-Host "OK: $dumpPath"
