$ErrorActionPreference = "Stop"

$clientDir = Resolve-Path (Join-Path $PSScriptRoot "..")
$desktopPath = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktopPath "Reika.lnk"
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)

$releaseDir = Join-Path $clientDir "release"
$installedExe = Get-ChildItem -Path $releaseDir -Recurse -Filter "Reika.exe" -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -notmatch "\\win-unpacked\\resources\\" } |
  Select-Object -First 1
$unpackedExe = Join-Path $releaseDir "win-unpacked\Reika.exe"

if ($installedExe) {
  $shortcut.TargetPath = $installedExe.FullName
  $shortcut.WorkingDirectory = Split-Path $installedExe.FullName -Parent
} elseif (Test-Path $unpackedExe) {
  $shortcut.TargetPath = $unpackedExe
  $shortcut.WorkingDirectory = Split-Path $unpackedExe -Parent
} else {
  $shortcut.TargetPath = "powershell.exe"
  $shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -Command `"Set-Location '$clientDir'; npm run dev:desktop`""
  $shortcut.WorkingDirectory = $clientDir
}

$icon = Join-Path $clientDir "assets\reika_phase1\brand\reika_app_icon.ico"
if (Test-Path $icon) {
  $shortcut.IconLocation = $icon
} elseif ($shortcut.TargetPath -like "*.exe" -and (Test-Path $shortcut.TargetPath)) {
  $shortcut.IconLocation = $shortcut.TargetPath
}

$shortcut.Description = "Reika desktop client"
$shortcut.Save()
Write-Host "Created shortcut: $shortcutPath"
