# Builds the downloadable package: dist\HQ-Personal-<version>-win-x64.zip
#   HQ-Personal-<version>\
#     Install HQ.cmd        <- double-click
#     READ ME FIRST.txt
#     app\                  <- the program (server, page, production node_modules)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$pkg = Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
$name = "HQ-Personal-$($pkg.version)"
$dist = Join-Path $root 'dist'
$out = Join-Path $dist $name
$app = Join-Path $out 'app'

Remove-Item -Recurse -Force $out -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $app | Out-Null

foreach ($d in 'server', 'public', 'scripts', 'node_modules') {
  robocopy (Join-Path $root $d) (Join-Path $app $d) /E /XD .git runtime .cache /R:1 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "copy $d failed" }
}
foreach ($f in 'package.json', 'LICENSE', 'README.md') { Copy-Item (Join-Path $root $f) $app }
Remove-Item (Join-Path $app 'scripts\build-release.ps1'), (Join-Path $app 'scripts\smoke.mjs') -Force -ErrorAction SilentlyContinue

# ---- slim node_modules: Windows x64 binaries only, no sources, maps or typings ----
$nm = Join-Path $app 'node_modules'
$pty = Join-Path $nm 'node-pty'
foreach ($d in 'build', 'deps', 'src', 'third_party', 'scripts', 'typings', 'prebuilds\darwin-arm64', 'prebuilds\darwin-x64', 'prebuilds\win32-arm64') {
  Remove-Item -Recurse -Force (Join-Path $pty $d) -ErrorAction SilentlyContinue
}
Get-ChildItem $nm -Recurse -File -Include *.pdb, *.map, *.d.ts, *.d.mts, *.d.cts, *.md -Exclude LICENSE* | Remove-Item -Force
Remove-Item -Recurse -Force (Join-Path $nm '@anthropic-ai\sdk\src') -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force (Join-Path $nm 'node-addon-api') -ErrorAction SilentlyContinue

# ---- launcher files at the top of the package ----
Set-Content -Path (Join-Path $out 'Install HQ.cmd') -Encoding ASCII -Value @'
@echo off
title Install HQ
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0app\scripts\install.ps1" %*
if errorlevel 1 (
  echo.
  echo Something went wrong. Take a screenshot of this window and send it to the person who gave you HQ.
  pause
)
'@

Set-Content -Path (Join-Path $out 'READ ME FIRST.txt') -Encoding UTF8 -Value @"
HQ - Personal Edition $($pkg.version)
==================================

Install
  1. Unzip this folder anywhere (for example on the Desktop).
  2. Double-click "Install HQ.cmd".
     - If Windows shows "Windows protected your PC", click "More info" then "Run anyway".
  3. HQ opens. A short setup asks for your name, colors, logo, pages, your AI and YouTube.
     Everything can be changed later in Settings.

After that, open HQ from the Desktop icon or the Start menu. You can delete this unzipped folder.

What it needs
  - Windows 10 or 11, internet for YouTube and AI.
  - Node.js: the installer downloads it automatically if this PC doesn't have it.
  - Music and backgrounds need two free helper programs (yt-dlp and FFmpeg):
    HQ installs them with one click (setup step 5, or Settings > Helper programs).

Your data
  Settings, API keys, chats, notes, music and backgrounds are stored in
  %LOCALAPPDATA%\HQ  - updating or reinstalling HQ never deletes them.

Update
  Unzip the new version and run "Install HQ.cmd" again.

Uninstall
  Start menu > HQ > Uninstall HQ.
"@

# ---- zip it (Windows' own tar writes standard zip files and is much faster than Compress-Archive) ----
$zip = Join-Path $dist "$name-win-x64.zip"
Remove-Item $zip -Force -ErrorAction SilentlyContinue
& (Join-Path $env:SystemRoot 'System32\tar.exe') -a -c -f $zip -C $dist $name
if ($LASTEXITCODE -ne 0) { throw 'zip failed' }
$mb = [math]::Round((Get-Item $zip).Length / 1MB, 1)
Write-Output "Built $zip ($mb MB)"
