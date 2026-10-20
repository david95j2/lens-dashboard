[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateSet('lens','installer')][string]$Product,
    [Parameter(Mandatory)][string]$LensRoot,
    [Parameter(Mandatory)][string]$InstallerRoot,
    [Parameter(Mandatory)][string]$OutputRoot,
    [Parameter(Mandatory)][string]$KeyAlias,
    [string]$WorkRoot
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$OutputRoot = [IO.Path]::GetFullPath($OutputRoot)
if (-not $WorkRoot) { $WorkRoot = $LensRoot }
$allowed = [IO.Path]::GetFullPath((Join-Path $WorkRoot 'artifacts/dashboard')) + [IO.Path]::DirectorySeparatorChar
if (-not $OutputRoot.StartsWith($allowed, [StringComparison]::OrdinalIgnoreCase)) { throw 'Output must be under artifacts/dashboard.' }
New-Item -ItemType Directory -Path $OutputRoot -Force | Out-Null
function Publish-Installer {
    Write-Output 'STAGE: installer'
    $script:installerCandidate = $null
    & (Join-Path $InstallerRoot 'scripts/publish.ps1') 6>&1 | ForEach-Object {
        $line = "$_"
        Write-Output $line
        if ($line -match '^Clean output for this run: (.+)$') { $script:installerCandidate = $Matches[1].Trim() }
    }
    if (-not $script:installerCandidate) { throw 'Installer did not report a completed output.' }
    $base = [IO.Path]::GetFullPath((Join-Path $InstallerRoot 'artifacts/publish')) + [IO.Path]::DirectorySeparatorChar
    if (-not [IO.Path]::GetFullPath($script:installerCandidate).StartsWith($base, [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid installer output.' }
    foreach ($name in @('LensInstaller.exe','LensUnInstaller.exe')) {
        if (-not (Test-Path -LiteralPath (Join-Path $script:installerCandidate $name) -PathType Leaf)) { throw "Missing $name" }
    }
}
if ($Product -eq 'installer') {
    Publish-Installer
    $destination = [IO.Path]::GetFullPath((Join-Path $InstallerRoot 'publish'))
    foreach ($name in @('LensInstaller.exe','LensUnInstaller.exe')) {
        $published = Join-Path $destination $name
        if (-not (Test-Path -LiteralPath $published -PathType Leaf) -or
            (Get-FileHash -LiteralPath $published).Hash -ne (Get-FileHash -LiteralPath (Join-Path $script:installerCandidate $name)).Hash) {
            throw "Published installer does not match the validated candidate: $name"
        }
    }
    $candidatePath = [IO.Path]::GetFullPath($script:installerCandidate)
    $candidateParent = [IO.Path]::GetFullPath((Join-Path $InstallerRoot 'artifacts/publish'))
    if ((Split-Path $candidatePath -Parent) -ne $candidateParent -or
        ((Get-Item -LiteralPath $candidatePath).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw 'Refusing to clean an unexpected installer staging directory.'
    }
    Remove-Item -LiteralPath $candidatePath -Recurse -Force
    Write-Output "RESULT: $destination"
    exit 0
}
Write-Output 'STAGE: protected-build'
$candidate = $null
& (Join-Path $LensRoot 'scripts/publish-protected.ps1') | ForEach-Object {
    Write-Output $_
    if ("$_" -match '^Unsigned validation candidate \(NOT release-ready\): (.+)$') { $script:candidate = $Matches[1].Trim() }
}
if (-not $candidate) { throw 'Protected build did not report a completed candidate.' }
$candidate = [IO.Path]::GetFullPath($candidate)
$protectionRoot = [IO.Path]::GetFullPath((Join-Path $LensRoot 'artifacts/protection')) + [IO.Path]::DirectorySeparatorChar
if (-not $candidate.StartsWith($protectionRoot, [StringComparison]::OrdinalIgnoreCase) -or
    (Split-Path $candidate -Leaf) -ne 'unsigned-candidate') { throw 'Invalid protected candidate path.' }
$release = Join-Path $OutputRoot 'SiriusLens'
if (Test-Path -LiteralPath $release) { throw 'Release folder already exists; refusing overwrite.' }
New-Item -ItemType Directory -Path $release | Out-Null
Get-ChildItem -LiteralPath $candidate -Force | Copy-Item -Destination $release -Recurse
$exe = Join-Path $release 'SiriusLens.App.exe'
Write-Output 'STAGE: signing'
& smctl sign --dynamic-auth --keypair-alias $KeyAlias --input $exe
if ($LASTEXITCODE -ne 0) { throw 'Signing failed. ZIP was not created.' }
$signature = Get-AuthenticodeSignature -LiteralPath $exe
if ($signature.Status -ne 'Valid') { throw "Signature verification failed: $($signature.Status). ZIP was not created." }
# Signing changes EXE bytes. Refresh the copied manifest, retaining its UI-validation limitations.
$manifestPath = Join-Path $release 'protection-manifest.json'
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$manifest.Signed = $true
$manifest.Kind = 'signed-validation-candidate'
$manifest.Remaining = @($manifest.Remaining | Where-Object { $_ -ne 'signing certificate and signed artifact verification' })
$manifest.Files = @(Get-ChildItem -LiteralPath $release -File -Recurse | Where-Object FullName -NE $manifestPath | ForEach-Object {
    [ordered]@{ Path = $_.FullName.Substring($release.Length + 1).Replace('\','/'); Sha256 = (Get-FileHash -LiteralPath $_.FullName).Hash }
})
$manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $manifestPath -Encoding utf8
Write-Output 'STAGE: zip'
$version = ([xml](Get-Content -LiteralPath (Join-Path $LensRoot 'src/SiriusLens.App/SiriusLens.App.csproj') -Raw)).Project.PropertyGroup.Version | Where-Object { $_ } | Select-Object -First 1
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid product version.' }
$zip = Join-Path $OutputRoot "SiriusLens-v$version.zip"
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory($release, $zip, [IO.Compression.CompressionLevel]::Optimal, $true)
$archive = [IO.Compression.ZipFile]::OpenRead($zip)
try {
    $entries = @($archive.Entries.FullName | ForEach-Object { $_.Replace('\','/') })
    if (-not ($entries -contains 'SiriusLens/SiriusLens.App.exe') -or
        @($entries | Where-Object { -not $_.StartsWith('SiriusLens/') }).Count -gt 0) { throw 'Invalid ZIP root layout.' }
} finally { $archive.Dispose() }
[ordered]@{ Product='LENS'; Version=$version; SourceCandidate=$candidate; SignedExe=$exe;
    CertificateThumbprint=$signature.SignerCertificate.Thumbprint; Zip=$zip; Sha256=(Get-FileHash -LiteralPath $zip).Hash;
    RealUiValidated=$false; CreatedAt=(Get-Date).ToUniversalTime().ToString('o')
} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $OutputRoot 'package.json') -Encoding utf8
Write-Output "RESULT: $zip"
