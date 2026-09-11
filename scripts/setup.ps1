<#
.SYNOPSIS
    One-time Python environment setup for Job Hunter.

.DESCRIPTION
    Creates backend/.venv, installs backend/requirements.txt into it, and checks
    that every dependency imports. The desktop shell launches the backend with
    backend/.venv/Scripts/python.exe and nothing else, so until this script has
    run once the application has no interpreter to start.

    Safe to run repeatedly: an existing, healthy virtual environment is reused
    and the install is repeated against the same pins.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts/setup.ps1
#>

$ErrorActionPreference = 'Stop'

$RepoRoot     = Split-Path -Parent $PSScriptRoot
$BackendDir   = Join-Path $RepoRoot 'backend'
$VenvDir      = Join-Path $BackendDir '.venv'
$VenvPython   = Join-Path $VenvDir 'Scripts\python.exe'
$Requirements = Join-Path $BackendDir 'requirements.txt'

# The minimum the backend is written against.
$MinMajor = 3
$MinMinor = 11

# Import names, not distribution names: these are what the backend actually
# imports at startup. python-multipart installs as python_multipart.
$Modules = @('fastapi', 'uvicorn', 'sqlalchemy', 'pydantic', 'httpx', 'python_multipart')

function Fail([string]$Message) {
    Write-Host ''
    Write-Host "FAILED: $Message" -ForegroundColor Red
    exit 1
}

function Get-InterpreterVersion([string]$Exe, [string[]]$Prefix) {
    # The version comes from the interpreter itself rather than from
    # --version, because the Microsoft Store alias stub answers with nothing
    # at all and still exits without error. Something that cannot print its
    # own version tuple is not an interpreter.
    try {
        $callArgs = @()
        if ($Prefix) { $callArgs += $Prefix }
        # No quotes inside this snippet: Windows PowerShell drops embedded
        # double quotes when it builds the command line for a native process.
        $callArgs += @('-c', 'import sys; print(sys.version_info[0], sys.version_info[1])')
        $output = & $Exe @callArgs 2>$null
    } catch {
        return $null
    }
    if ($LASTEXITCODE -ne 0 -or -not $output) { return $null }
    $parts = ($output | Select-Object -Last 1).ToString().Trim() -split '\s+'
    if ($parts.Count -lt 2) { return $null }
    $parsed = $null
    if (-not [version]::TryParse(($parts[0] + '.' + $parts[1]), [ref]$parsed)) { return $null }
    return $parsed
}

function Test-VersionOk($Version) {
    if ($null -eq $Version) { return $false }
    if ($Version.Major -gt $MinMajor) { return $true }
    return ($Version.Major -eq $MinMajor -and $Version.Minor -ge $MinMinor)
}

Write-Host 'Job Hunter - Python environment setup'
Write-Host "Repository: $RepoRoot"
Write-Host ''

if (-not (Test-Path $Requirements)) {
    Fail 'backend/requirements.txt was not found. Run this script from a checkout of the repository.'
}

# ---------------------------------------------------------------- interpreter

$existing = $null
if (Test-Path $VenvPython) {
    $existing = Get-InterpreterVersion $VenvPython @()
    if (Test-VersionOk $existing) {
        Write-Host "Reusing backend/.venv (Python $existing)."
    } else {
        Fail ('backend/.venv exists but its interpreter is unusable or older than ' +
              "$MinMajor.$MinMinor. Delete the backend\.venv folder and run this script again.")
    }
}

if (-not $existing) {
    # Candidates in order of trustworthiness. The launcher knows about every
    # installed version; the bare names are the fallback for a PATH install.
    $candidates = @(
        @{ Exe = 'py';      Prefix = @('-3') },
        @{ Exe = 'python3'; Prefix = @() },
        @{ Exe = 'python';  Prefix = @() }
    )

    $chosen = $null
    $report = @()
    foreach ($candidate in $candidates) {
        $version = Get-InterpreterVersion $candidate.Exe $candidate.Prefix
        $label = (@($candidate.Exe) + $candidate.Prefix) -join ' '
        if ($null -eq $version) {
            $report += "  $label - not available"
            continue
        }
        $report += "  $label - Python $version"
        if (Test-VersionOk $version) { $chosen = $candidate; break }
    }

    if (-not $chosen) {
        Write-Host 'Looked for an interpreter:'
        $report | ForEach-Object { Write-Host $_ }
        Fail ("no Python $MinMajor.$MinMinor or newer was found. Install it from " +
              'https://www.python.org/downloads/windows/ with "Add python.exe to PATH" ticked, ' +
              'then run this script again.')
    }

    $label = (@($chosen.Exe) + $chosen.Prefix) -join ' '
    Write-Host "Using $label to create backend/.venv"
    $createArgs = @()
    if ($chosen.Prefix) { $createArgs += $chosen.Prefix }
    $createArgs += @('-m', 'venv', $VenvDir)
    & $chosen.Exe @createArgs
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $VenvPython)) {
        Fail 'creating backend/.venv failed. The venv module may be missing from this Python install.'
    }
    Write-Host 'Created backend/.venv'
}

# ------------------------------------------------------------------- installs

Write-Host ''
Write-Host 'Installing backend/requirements.txt ...'
& $VenvPython -m pip install --disable-pip-version-check -r $Requirements
if ($LASTEXITCODE -ne 0) {
    Fail 'installing backend/requirements.txt failed. The message above says which package and why.'
}

# --------------------------------------------------------------- verification

Write-Host ''
Write-Host 'Verifying imports ...'
$missing = @()
foreach ($module in $Modules) {
    & $VenvPython -c "import $module" 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  $module ok"
    } else {
        Write-Host "  $module MISSING" -ForegroundColor Red
        $missing += $module
    }
}

if ($missing.Count -gt 0) {
    Fail ('these dependencies did not import: ' + ($missing -join ', ') +
          '. Delete the backend\.venv folder and run this script again.')
}

$venvVersion = Get-InterpreterVersion $VenvPython @()
$count = $Modules.Count
Write-Host ''
Write-Host "OK: backend/.venv is ready (Python $venvVersion, $count dependencies verified)." -ForegroundColor Green
exit 0
