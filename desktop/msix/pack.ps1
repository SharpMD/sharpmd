# Builds an unsigned MSIX for the Microsoft Store from the release exe. The Store signs it.
# Run after `npx tauri build --no-bundle` in desktop/. The identity values come from
# Partner Center (the app's Product identity page).
param(
  [Parameter(Mandatory)] [string] $IdentityName,
  [Parameter(Mandatory)] [string] $Publisher,
  [Parameter(Mandatory)] [string] $PublisherName,
  [string] $Out = "SharpMD.msix"
)
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$tauri = Join-Path $here '..\src-tauri'
$version = (Get-Content (Join-Path $tauri 'tauri.conf.json') -Raw | ConvertFrom-Json).version + '.0'

$stage = Join-Path ([IO.Path]::GetTempPath()) ('sharpmd-msix-' + [guid]::NewGuid())
New-Item -ItemType Directory -Force (Join-Path $stage 'icons') | Out-Null
Copy-Item (Join-Path $tauri 'target\release\sharpmd.exe') $stage
foreach ($i in 'StoreLogo.png', 'Square44x44Logo.png', 'Square150x150Logo.png') {
  Copy-Item (Join-Path $tauri "icons\$i") (Join-Path $stage 'icons')
}
$esc = { param($s) [Security.SecurityElement]::Escape($s) }
(Get-Content (Join-Path $here 'AppxManifest.xml') -Raw) `
  -replace '__IDENTITY_NAME__', (& $esc $IdentityName) `
  -replace '__PUBLISHER_NAME__', (& $esc $PublisherName) `
  -replace '__PUBLISHER__', (& $esc $Publisher) `
  -replace '__VERSION__', $version |
  Set-Content (Join-Path $stage 'AppxManifest.xml') -Encoding utf8

$makeappx = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\makeappx.exe" |
  Sort-Object FullName -Descending | Select-Object -First 1
if (-not $makeappx) { throw 'makeappx.exe not found (Windows SDK)' }
& $makeappx.FullName pack /o /d $stage /p $Out
if ($LASTEXITCODE) { throw "makeappx failed ($LASTEXITCODE)" }
Remove-Item -Recurse -Force $stage
Write-Host "MSIX $version -> $Out"
