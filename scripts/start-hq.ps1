# HQ launcher: starts the HQ server in the background (if it isn't running yet)
# and opens it as its own app window. Used by the desktop / Start-menu shortcut.
param([switch]$NoWindow)

$ErrorActionPreference = 'SilentlyContinue'
$root = Split-Path -Parent $PSScriptRoot
$port = if ($env:HQ_PORT) { $env:HQ_PORT } else { 9120 }
$url = "http://127.0.0.1:$port"
$dataDir = if ($env:HQ_DATA_DIR) { $env:HQ_DATA_DIR } else { Join-Path $env:LOCALAPPDATA 'HQ' }
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null

function Test-HQ {
  try { (Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 "$url/api/health").Content -match 'hq-personal' } catch { $false }
}

if (-not (Test-HQ)) {
  # Node.js: the copy HQ installed for itself first, then the one on PATH.
  $node = Join-Path $root 'runtime\node\node.exe'
  if (-not (Test-Path $node)) { $node = (Get-Command node -ErrorAction SilentlyContinue).Source }
  if (-not $node) {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show("HQ needs Node.js. Run 'Install HQ' again, or install Node.js from nodejs.org.", 'HQ') | Out-Null
    exit 1
  }
  $env:HQ_PORT = "$port"
  Start-Process -FilePath $node -ArgumentList 'server/index.mjs' -WorkingDirectory $root -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $dataDir 'server.log') -RedirectStandardError (Join-Path $dataDir 'server.err.log')
  for ($i = 0; $i -lt 60 -and -not (Test-HQ); $i++) { Start-Sleep -Milliseconds 250 }
  if (-not (Test-HQ)) {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show("HQ did not start. Details are in:`n$dataDir\server.err.log", 'HQ') | Out-Null
    exit 1
  }
}

if ($NoWindow) { exit 0 }

$browsers = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { $_ -and (Test-Path $_) }

if ($browsers) {
  Start-Process -FilePath $browsers[0] -ArgumentList "--app=$url", '--window-size=1500,940'
} else {
  Start-Process $url
}
