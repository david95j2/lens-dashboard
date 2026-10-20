$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$repo = Split-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) -Parent
$root = Join-Path $repo ('artifacts/dashboard-package-test-' + [Guid]::NewGuid().ToString('N'))
$fakeLens = Join-Path $root 'lens'
$fakeInstaller = Join-Path $root 'installer'
foreach ($folder in @("$fakeLens/scripts", "$fakeLens/src/SiriusLens.App", "$fakeInstaller/scripts", "$fakeInstaller/artifacts/publish/fixture", "$fakeLens/artifacts/protection/fixture/unsigned-candidate")) {
    New-Item -ItemType Directory -Path $folder -Force | Out-Null
}
# Test doubles replace external publish/signing boundaries; the real packaging script runs below.
@'
$repository = Split-Path $PSScriptRoot -Parent
Write-Host "Clean output for this run: $repository/artifacts/publish/fixture"
'@ | Set-Content -LiteralPath "$fakeInstaller/scripts/publish.ps1"
@'
$repository = Split-Path $PSScriptRoot -Parent
Write-Output "Unsigned validation candidate (NOT release-ready): $repository/artifacts/protection/fixture/unsigned-candidate"
'@ | Set-Content -LiteralPath "$fakeLens/scripts/publish-protected.ps1"
'<Project><PropertyGroup><Version>1.0.3</Version></PropertyGroup></Project>' | Set-Content -LiteralPath "$fakeLens/src/SiriusLens.App/SiriusLens.App.csproj"
foreach ($name in @('LensInstaller.exe','LensUnInstaller.exe')) { 'fixture' | Set-Content -LiteralPath "$fakeInstaller/artifacts/publish/fixture/$name" }
'unsigned fixture' | Set-Content -LiteralPath "$fakeLens/artifacts/protection/fixture/unsigned-candidate/SiriusLens.App.exe"
'{"Signed":false,"Kind":"unsigned-validation-candidate","ReleaseReady":false,"RealUiValidated":false,"Remaining":["real UI and saved-project validation","signing certificate and signed artifact verification"],"Files":[]}' | Set-Content -LiteralPath "$fakeLens/artifacts/protection/fixture/unsigned-candidate/protection-manifest.json"
$global:dashboardTestSignatureStatus = 'Valid'
function smctl { $global:LASTEXITCODE = 0 }
function Get-AuthenticodeSignature { param($LiteralPath) [pscustomobject]@{Status=$global:dashboardTestSignatureStatus; SignerCertificate=[pscustomobject]@{Thumbprint='fixture'}} }
$publish = Join-Path (Split-Path $PSScriptRoot -Parent) 'publish.ps1'
$output = Join-Path $fakeLens 'artifacts/dashboard/success'
& $publish -Product lens -LensRoot $fakeLens -InstallerRoot $fakeInstaller -OutputRoot $output -KeyAlias test
$zip = [IO.Compression.ZipFile]::OpenRead((Join-Path $output 'SiriusLens-v1.0.3.zip'))
try {
    $names = @($zip.Entries.FullName | ForEach-Object { $_.Replace('\','/') })
    if ($names -notcontains 'SiriusLens/SiriusLens.App.exe' -or $names -contains 'SiriusLens/LensUnInstaller.exe') { throw 'Invalid ZIP root or separately bundled uninstaller.' }
} finally { $zip.Dispose() }
$manifest = Get-Content -LiteralPath "$output/SiriusLens/protection-manifest.json" -Raw | ConvertFrom-Json
if (-not $manifest.Signed -or $manifest.ReleaseReady -or $manifest.RealUiValidated) { throw 'Incorrect validation claims.' }
if ($manifest.Files.Count -ne 1) { throw 'Candidate file hashes not updated.' }
$original = Get-Content -LiteralPath "$fakeLens/artifacts/protection/fixture/unsigned-candidate/protection-manifest.json" -Raw | ConvertFrom-Json
if ($original.Signed) { throw 'Original candidate was modified.' }
$global:dashboardTestSignatureStatus='NotSigned'
$badOutput = Join-Path $fakeLens 'artifacts/dashboard/failure'
$failed=$false
try { & $publish -Product lens -LensRoot $fakeLens -InstallerRoot $fakeInstaller -OutputRoot $badOutput -KeyAlias test } catch { $failed=$true }
if (-not $failed -or (Test-Path -LiteralPath "$badOutput/SiriusLens-v1.0.3.zip")) { throw 'Invalid signature was packaged.' }
New-Item -ItemType Directory -Path "$fakeInstaller/publish" -Force | Out-Null
foreach ($name in @('LensInstaller.exe','LensUnInstaller.exe')) {
    Copy-Item -LiteralPath "$fakeInstaller/artifacts/publish/fixture/$name" -Destination "$fakeInstaller/publish/$name"
}
$installerOutput = Join-Path $fakeLens 'artifacts/dashboard/installer'
$installerResult = & $publish -Product installer -LensRoot $fakeLens -InstallerRoot $fakeInstaller -OutputRoot $installerOutput -KeyAlias test
if (Test-Path -LiteralPath "$fakeInstaller/artifacts/publish/fixture") { throw 'Installer staging was archived.' }
if (Test-Path -LiteralPath "$installerOutput/Installer") { throw 'Installer was copied into job history.' }
if (-not (Test-Path -LiteralPath "$fakeInstaller/publish/LensInstaller.exe")) { throw 'Latest installer was removed.' }
if (-not ($installerResult -match '^RESULT: ')) { throw 'Latest installer result was not returned.' }
Write-Output 'PASS: ZIP root, signature failure, manifest, latest-only installer and staging cleanup.'
