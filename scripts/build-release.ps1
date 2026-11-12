# Builds the downloadable package: dist\HQ-Personal-<version>-win-x64.zip
#   HQ\
#     Start HQ.cmd          <- double-click (runs only the bundled, signed node.exe)
#     READ ME FIRST.txt
#     runtime\node\         <- official Node.js LTS (checksum + signature verified at build time)
#     app\                  <- HQ itself (server, page, production node_modules)
# No installer script, no PowerShell, no downloads at install time: nothing that looks like a dropper.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$root = Split-Path -Parent $PSScriptRoot
$pkg = Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
$dist = Join-Path $root 'dist'
$out = Join-Path $dist 'HQ'
$app = Join-Path $out 'app'
$cache = Join-Path $dist 'cache'
New-Item -ItemType Directory -Force -Path $cache | Out-Null
Remove-Item -Recurse -Force $out -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $app | Out-Null

# ---- the app ----
foreach ($d in 'server', 'public', 'node_modules') {
  robocopy (Join-Path $root $d) (Join-Path $app $d) /E /XD .git .cache /R:1 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "copy $d failed" }
}
foreach ($f in 'launcher.mjs', 'package.json', 'LICENSE', 'README.md') { Copy-Item (Join-Path $root $f) $app }

# slim node_modules: Windows x64 ConPTY binaries only (winpty is never used), no sources, maps or typings
$nm = Join-Path $app 'node_modules'
$pty = Join-Path $nm 'node-pty'
foreach ($d in 'build', 'deps', 'src', 'third_party', 'scripts', 'typings', 'prebuilds\darwin-arm64', 'prebuilds\darwin-x64', 'prebuilds\win32-arm64') {
  Remove-Item -Recurse -Force (Join-Path $pty $d) -ErrorAction SilentlyContinue
}
foreach ($f in 'pty.node', 'winpty-agent.exe', 'winpty.dll') { Remove-Item -Force (Join-Path $pty "prebuilds\win32-x64\$f") -ErrorAction SilentlyContinue }
Get-ChildItem $nm -Recurse -File -Include *.pdb, *.map, *.d.ts, *.d.mts, *.d.cts, *.md -Exclude LICENSE* | Remove-Item -Force
Remove-Item -Recurse -Force (Join-Path $nm '@anthropic-ai\sdk\src'), (Join-Path $nm 'node-addon-api') -ErrorAction SilentlyContinue

# ---- Node.js (official build, verified) ----
$index = Invoke-RestMethod 'https://nodejs.org/dist/index.json'
$lts = $index | Where-Object { $_.lts -and $_.files -contains 'win-x64-zip' } | Select-Object -First 1
$ver = $lts.version
$zipNode = Join-Path $cache "node-$ver-win-x64.zip"
if (-not (Test-Path $zipNode)) { Invoke-WebRequest "https://nodejs.org/dist/$ver/node-$ver-win-x64.zip" -OutFile $zipNode -UseBasicParsing }
$sums = (Invoke-WebRequest "https://nodejs.org/dist/$ver/SHASUMS256.txt" -UseBasicParsing).Content
$want = (($sums -split "`n" | Where-Object { $_ -match "node-$ver-win-x64\.zip$" }) -replace '\s+.*$', '').Trim().ToLower()
$got = (Get-FileHash $zipNode -Algorithm SHA256).Hash.ToLower()
if (-not $want -or $got -ne $want) { Remove-Item $zipNode -Force; throw "Node.js $ver zip does not match its official checksum" }
Remove-Item -Recurse -Force (Join-Path $cache "node-$ver-win-x64") -ErrorAction SilentlyContinue
& (Join-Path $env:SystemRoot 'System32\tar.exe') -xf $zipNode -C $cache
if ($LASTEXITCODE -ne 0) { throw 'unpacking Node.js failed' }
New-Item -ItemType Directory -Force -Path (Join-Path $out 'runtime') | Out-Null
Move-Item (Join-Path $cache "node-$ver-win-x64") (Join-Path $out 'runtime\node')
$sig = Get-AuthenticodeSignature (Join-Path $out 'runtime\node\node.exe')
if ($sig.Status -ne 'Valid' -or $sig.SignerCertificate.Subject -notmatch 'OpenJS') { throw "node.exe signature check failed: $($sig.Status) $($sig.SignerCertificate.Subject)" }
Remove-Item (Join-Path $out 'runtime\node\CHANGELOG.md'), (Join-Path $out 'runtime\node\README.md') -Force -ErrorAction SilentlyContinue

# ---- the two files at the top ----
Set-Content -Path (Join-Path $out 'Start HQ.cmd') -Encoding ASCII -Value @'
@echo off
rem Starts HQ with the Node.js that comes with it (runtime\node, signed by the OpenJS Foundation).
cd /d "%~dp0app"
if exist "%~dp0runtime\node\node.exe" (
  start "HQ" /min "%~dp0runtime\node\node.exe" launcher.mjs
) else (
  start "HQ" /min node launcher.mjs
)
'@

Set-Content -Path (Join-Path $out 'READ ME FIRST.txt') -Encoding UTF8 -Value @"
HQ - Personal Edition $($pkg.version)
==================================

Start
  1. Unzip this file. Move the "HQ" folder somewhere it can stay
     (for example Documents) - HQ runs from this folder.
  2. Open the folder and double-click "Start HQ.cmd".
     - If Windows shows "Windows protected your PC", click "More info" then "Run anyway".
  3. HQ opens. A short setup asks for your name, colors, logo, pages, your AI and YouTube,
     and can put HQ on your Desktop and in the Start menu.

Nothing is installed in Windows: no admin rights, no registry changes, no background service.
HQ runs with the Node.js included in runtime\node (official build, signed by the OpenJS Foundation).

Music and backgrounds need two free helper programs (yt-dlp and FFmpeg):
HQ downloads them from their official pages with one click (setup step 5, or Settings > Helper programs).

Your data
  Settings, API keys, chats, notes, music and backgrounds are stored in %LOCALAPPDATA%\HQ.
  Updating HQ never deletes them.

Update
  Close HQ, replace the HQ folder with the new one, then start it again.

Remove
  Settings > Your data > turn off the shortcuts, close HQ, delete the HQ folder
  (and %LOCALAPPDATA%\HQ if you also want to delete your data).
"@

# ---- zip ----
$zip = Join-Path $dist "HQ-Personal-$($pkg.version)-win-x64.zip"
Remove-Item $zip -Force -ErrorAction SilentlyContinue
& (Join-Path $env:SystemRoot 'System32\tar.exe') -a -c -f $zip -C $dist HQ
if ($LASTEXITCODE -ne 0) { throw 'zip failed' }
$mb = [math]::Round((Get-Item $zip).Length / 1MB, 1)
Write-Output "Built $zip ($mb MB) with Node.js $ver"
