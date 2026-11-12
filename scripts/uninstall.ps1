# Removes HQ (shortcuts + program folder). Your data (settings, music, notes, chats) is kept
# unless you choose to delete it too.
param([switch]$RemoveData, [switch]$Quiet)
$ErrorActionPreference = 'SilentlyContinue'
$installDir = Split-Path -Parent $PSScriptRoot
$dataDir = if ($env:HQ_DATA_DIR) { $env:HQ_DATA_DIR } else { Join-Path $env:LOCALAPPDATA 'HQ' }
$port = if ($env:HQ_PORT) { $env:HQ_PORT } else { 9120 }
Add-Type -AssemblyName System.Windows.Forms

if (-not $Quiet) {
  $ok = [System.Windows.Forms.MessageBox]::Show('Remove HQ from this PC?', 'Uninstall HQ', 'YesNo', 'Question')
  if ($ok -ne 'Yes') { exit 0 }
  if (-not $RemoveData) {
    $d = [System.Windows.Forms.MessageBox]::Show("Also delete your HQ data?`n`nSettings, API keys, chats, notes, music and backgrounds in:`n$dataDir`n`nChoose No to keep them for a later reinstall.", 'Uninstall HQ', 'YesNo', 'Warning', 'Button2')
    $RemoveData = $d -eq 'Yes'
  }
}

# stop the server
foreach ($l in (netstat -ano -p tcp | Select-String "127\.0\.0\.1:$port\s+0\.0\.0\.0:0")) {
  $procId = ($l.ToString().Trim() -split '\s+')[-1]
  if ($procId -match '^\d+$') { Stop-Process -Id ([int]$procId) -Force }
}
Start-Sleep -Milliseconds 500

Remove-Item (Join-Path ([Environment]::GetFolderPath('Desktop')) 'HQ.lnk') -Force
Remove-Item (Join-Path ([Environment]::GetFolderPath('Programs')) 'HQ') -Recurse -Force
Set-Location $env:TEMP
Remove-Item $installDir -Recurse -Force
if ($RemoveData) { Remove-Item $dataDir -Recurse -Force }

if (-not $Quiet) { [System.Windows.Forms.MessageBox]::Show('HQ was removed.' + $(if ($RemoveData) { '' } else { "`nYour data is still in $dataDir" }), 'Uninstall HQ') | Out-Null }
