[CmdletBinding()]
param(
    [string]$CompanionPath = (Join-Path $env:ProgramFiles 'gaming.tools\Companion\GT.Launcher.exe'),
    [string]$NodePath,
    [string]$ShortcutDirectory = [Environment]::GetFolderPath('Desktop'),
    [switch]$Uninstall
)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$wrapper = Join-Path $root 'launch-hidden.vbs'
$hostPath = Join-Path $env:SystemRoot 'System32\wscript.exe'
$linkPath = Join-Path $ShortcutDirectory 'gaming.tools - Clean Layout.lnk'
$configPath = Join-Path $root 'launcher-config.json'
$nodeFile = Join-Path $root 'node-path.txt'
. (Join-Path $root 'shortcut.ps1')

# Do not replace or remove a shortcut owned by another checkout or application.
if (Test-Path -LiteralPath $linkPath) {
    $existing = [CleanLayoutShortcut]::Read($linkPath)
    if ($existing[0] -ne $hostPath -or $existing[1] -ne ('"' + $wrapper + '"')) {
        throw 'The desktop shortcut belongs to another installation. Preserve it or choose a different -ShortcutDirectory.'
    }
}
if ($Uninstall) {
    foreach ($path in @($linkPath, $configPath, $nodeFile)) {
        if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path }
    }
    Write-Output 'Shortcut and local configuration removed. Companion and source files were preserved.'
    return
}
foreach ($name in @('launch.mjs', 'launch-hidden.vbs', 'companion.css')) {
    if (-not (Test-Path -LiteralPath (Join-Path $root $name) -PathType Leaf)) { throw "Missing project file: $name" }
}
if (-not (Test-Path -LiteralPath $CompanionPath -PathType Leaf) -or
    [IO.Path]::GetFileName($CompanionPath) -ne 'GT.Launcher.exe') {
    throw 'Companion was not found. Use -CompanionPath with the full path to GT.Launcher.exe.'
}
if (-not $NodePath) { $NodePath = (Get-Command node.exe -ErrorAction Stop).Source }
$NodePath = (Resolve-Path -LiteralPath $NodePath).ProviderPath
$version = & $NodePath --version
if ($LASTEXITCODE -ne 0 -or $version -notmatch '^v(\d+)\.' -or [int]$Matches[1] -lt 22) {
    throw 'Node.js 22 or newer is required. Install Node.js 24 and reopen PowerShell.'
}
if (-not (Test-Path -LiteralPath $ShortcutDirectory -PathType Container)) { throw 'Shortcut directory does not exist.' }
$CompanionPath = (Resolve-Path -LiteralPath $CompanionPath).ProviderPath
$config = @{ companionPath = $CompanionPath } | ConvertTo-Json
[IO.File]::WriteAllText($configPath, $config, (New-Object Text.UTF8Encoding($false)))
# A Unicode text file keeps the VBS wrapper dependency-free, including non-ASCII paths.
[IO.File]::WriteAllText($nodeFile, $NodePath, [Text.Encoding]::Unicode)
[CleanLayoutShortcut]::Write($linkPath, $hostPath, ('"' + $wrapper + '"'), $root, $CompanionPath)
Write-Output "Ready: $linkPath"
Write-Output 'Keep this folder in place. Close Companion, then use the new shortcut.'
