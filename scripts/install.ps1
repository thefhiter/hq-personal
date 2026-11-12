# Installs HQ for the current Windows user (no admin rights needed):
#   1. copies the app to %LOCALAPPDATA%\Programs\HQ (updates keep your data and installed tools)
#   2. makes sure Node.js is available (downloads the official portable LTS build if missing)
#   3. adds "HQ" to the Desktop and the Start menu, then opens it.
param(
  [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'Programs\HQ'),
  [switch]$NoShortcuts,
  [switch]$NoLaunch,
  [switch]$ForceNodeDownload
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$src = Split-Path -Parent $PSScriptRoot           # ...\app
$dataDir = if ($env:HQ_DATA_DIR) { $env:HQ_DATA_DIR } else { Join-Path $env:LOCALAPPDATA 'HQ' }
$port = if ($env:HQ_PORT) { $env:HQ_PORT } else { 9120 }

function Say($text, $color = 'Gray') { Write-Host "  $text" -ForegroundColor $color }
Write-Host ''
Write-Host '  H Q  -  Personal Edition' -ForegroundColor Cyan
Write-Host '  ---------------------------' -ForegroundColor DarkGray

# --- stop a running copy (when updating) ---
$lines = netstat -ano -p tcp | Select-String "127\.0\.0\.1:$port\s+0\.0\.0\.0:0"
foreach ($l in $lines) {
  $procId = ($l.ToString().Trim() -split '\s+')[-1]
  if ($procId -match '^\d+$' -and [int]$procId -gt 0) { Stop-Process -Id ([int]$procId) -Force -ErrorAction SilentlyContinue; Say 'Stopped the running HQ to update it.' }
}

# --- copy the app ---
Say "Installing to $InstallDir"
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
if ((Resolve-Path $src).Path.TrimEnd('\') -ne (Resolve-Path $InstallDir).Path.TrimEnd('\')) {
  # /MIR keeps the folder identical to the new version, except runtime\ (Node, yt-dlp, FFmpeg already installed)
  robocopy "$src" "$InstallDir" /MIR /XD runtime /R:2 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "Copying files failed (robocopy code $LASTEXITCODE)" }
}

# --- Node.js ---
function Get-NodeMajor($exe) { try { [int]((& $exe --version) -replace '^v(\d+).*', '$1') } catch { 0 } }
$ownNode = Join-Path $InstallDir 'runtime\node\node.exe'
$pathNode = (Get-Command node -ErrorAction SilentlyContinue).Source
if ((Test-Path $ownNode) -and (Get-NodeMajor $ownNode) -ge 20 -and -not $ForceNodeDownload) {
  Say "Node.js $(& $ownNode --version) (HQ's own copy)" 'DarkGreen'
} elseif ($pathNode -and (Get-NodeMajor $pathNode) -ge 20 -and -not $ForceNodeDownload) {
  Say "Node.js $(& $pathNode --version) found on this PC" 'DarkGreen'
} else {
  Say 'Downloading Node.js (official LTS build, about 35 MB)...' 'Yellow'
  $index = Invoke-RestMethod 'https://nodejs.org/dist/index.json'
  $lts = $index | Where-Object { $_.lts -and $_.files -contains 'win-x64-zip' } | Select-Object -First 1
  if (-not $lts) { throw 'Could not find a Node.js LTS release to download.' }
  $ver = $lts.version
  $tmp = Join-Path $env:TEMP "hq-node-$ver"
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force -Path $tmp | Out-Null
  $zip = Join-Path $tmp 'node.zip'
  Invoke-WebRequest "https://nodejs.org/dist/$ver/node-$ver-win-x64.zip" -OutFile $zip -UseBasicParsing
  # check the download against the official checksums
  $sums = (Invoke-WebRequest "https://nodejs.org/dist/$ver/SHASUMS256.txt" -UseBasicParsing).Content
  $want = ($sums -split "`n" | Where-Object { $_ -match "node-$ver-win-x64\.zip$" }) -replace '\s+.*$', ''
  $got = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
  if (-not $want -or $got -ne $want.Trim().ToLower()) { throw 'The Node.js download did not match its official checksum.' }
  Expand-Archive -LiteralPath $zip -DestinationPath $tmp -Force
  $nodeDir = Join-Path $InstallDir 'runtime\node'
  Remove-Item -Recurse -Force $nodeDir -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force -Path (Split-Path $nodeDir) | Out-Null
  Move-Item (Join-Path $tmp "node-$ver-win-x64") $nodeDir
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
  Say "Node.js $ver installed for HQ" 'DarkGreen'
}

# --- icon (follows your logo once you've set HQ up) ---
$brand = Join-Path $dataDir 'brand'
New-Item -ItemType Directory -Force -Path $brand | Out-Null
$ico = Join-Path $brand 'app.ico'
if (-not (Test-Path $ico)) { Copy-Item (Join-Path $InstallDir 'public\assets\hq.ico') $ico }

# --- shortcuts ---
if (-not $NoShortcuts) {
  $shell = New-Object -ComObject WScript.Shell
  $vbs = Join-Path $InstallDir 'scripts\HQ.vbs'
  $menu = Join-Path ([Environment]::GetFolderPath('Programs')) 'HQ'
  New-Item -ItemType Directory -Force -Path $menu | Out-Null
  foreach ($lnkPath in @((Join-Path ([Environment]::GetFolderPath('Desktop')) 'HQ.lnk'), (Join-Path $menu 'HQ.lnk'))) {
    $lnk = $shell.CreateShortcut($lnkPath)
    $lnk.TargetPath = "$env:WINDIR\System32\wscript.exe"
    $lnk.Arguments = "`"$vbs`""
    $lnk.WorkingDirectory = $InstallDir
    $lnk.IconLocation = "$ico,0"
    $lnk.Description = 'HQ - your focus room, music, AI, projects and notes'
    $lnk.Save()
  }
  $un = $shell.CreateShortcut((Join-Path $menu 'Uninstall HQ.lnk'))
  $un.TargetPath = 'powershell.exe'
  $un.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$InstallDir\scripts\uninstall.ps1`""
  $un.WorkingDirectory = $env:TEMP
  $un.Save()
  Say 'Added HQ to the Desktop and the Start menu' 'DarkGreen'
}

Write-Host ''
Say 'HQ is installed.' 'Green'
Say "Your data lives in $dataDir" 'DarkGray'
if (-not $NoLaunch) {
  Say 'Opening HQ...'
  & (Join-Path $InstallDir 'scripts\start-hq.ps1')
}
