# Prepare this machine to code-sign with Azure Artifact Signing (Trusted Signing).
# Idempotent — safe to re-run. Handles the local network quirk where the VPN's
# DNS returns AAAA (IPv6) records for nuget.org / PSGallery but IPv6 is dead in
# the tunnel, so every default download stalls. We force IPv4 with curl.
#
# Run once in Windows PowerShell or pwsh:  ./scripts/setup-signing.ps1
# Then: az login   (interactive, one time)  and  npm run dist:signed
$ErrorActionPreference = 'Stop'

$TS_MODULE_VERSION = '0.5.8'
$root = Join-Path $env:LOCALAPPDATA 'TrustedSigning'
$work = Join-Path $env:TEMP 'ts-setup'
New-Item -ItemType Directory -Force $work | Out-Null

function Get-IPv4 { param($Url, $Out) & curl.exe -4 -sSL --max-time 300 -o $Out $Url; if ($LASTEXITCODE -ne 0) { throw "download failed: $Url" } }

# 1. TrustedSigning PowerShell module (both PS editions) --------------------
$haveModule = Get-Module -ListAvailable -Name TrustedSigning |
  Where-Object { $_.Version -ge [version]$TS_MODULE_VERSION } | Select-Object -First 1
if (-not $haveModule) {
  Write-Host "Installing TrustedSigning module $TS_MODULE_VERSION ..."
  $zip = Join-Path $work 'trustedsigning.zip'
  Get-IPv4 'https://www.powershellgallery.com/api/v2/package/TrustedSigning' $zip
  $ext = Join-Path $work 'ts-extract'
  if (Test-Path $ext) { Remove-Item $ext -Recurse -Force }
  Expand-Archive $zip $ext -Force
  $data = Import-PowerShellDataFile (Get-ChildItem $ext -Filter 'TrustedSigning.psd1' -Recurse | Select-Object -First 1).FullName
  $ver = $data.ModuleVersion
  foreach ($junk in '_rels', 'package', '[Content_Types].xml', '*.nuspec') {
    Get-ChildItem $ext -Filter $junk -Force -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
  }
  foreach ($base in 'PowerShell', 'WindowsPowerShell') {
    $dst = Join-Path ([Environment]::GetFolderPath('MyDocuments')) "$base\Modules\TrustedSigning\$ver"
    if (Test-Path $dst) { Remove-Item $dst -Recurse -Force }
    New-Item -ItemType Directory -Force $dst | Out-Null
    Copy-Item (Join-Path $ext '*') $dst -Recurse -Force
    Write-Host "  installed -> $dst"
  }
} else {
  Write-Host "TrustedSigning module already present ($($haveModule.Version))."
}

# 2. NuGet dependencies the module normally auto-downloads ------------------
$pkgs = @(
  @{ Id = 'Microsoft.Windows.SDK.BuildTools'; Version = '10.0.26100.4188';   Probe = 'bin\10.0.26100.0\x64\signtool.exe' },
  @{ Id = 'Microsoft.Trusted.Signing.Client'; Version = '1.0.95';            Probe = 'bin\x64' },
  @{ Id = 'sign';                             Version = '0.9.1-beta.24469.1'; Probe = 'tools\net8.0\any' }
)
foreach ($p in $pkgs) {
  $install = Join-Path $root "$($p.Id)\$($p.Id).$($p.Version)"
  if (Test-Path (Join-Path $install $p.Probe)) { Write-Host "dep present: $($p.Id) $($p.Version)"; continue }
  $lid = $p.Id.ToLower(); $lver = $p.Version.ToLower()
  $zip = Join-Path $work "$lid.$lver.zip"
  Write-Host "Downloading $($p.Id) $($p.Version) ..."
  Get-IPv4 "https://api.nuget.org/v3-flatcontainer/$lid/$lver/$lid.$lver.nupkg" $zip
  New-Item -ItemType Directory -Force $install | Out-Null
  Expand-Archive $zip $install -Force
  Write-Host "  installed -> $install"
}

# 3. Azure CLI (auth provider for the signing call) ------------------------
if (-not (Get-Command az -ErrorAction SilentlyContinue) -and -not (Test-Path "$env:ProgramFiles\Microsoft SDKs\Azure\CLI2\wbin\az.cmd")) {
  Write-Host 'Installing Azure CLI via winget ...'
  winget install --id Microsoft.AzureCLI --accept-source-agreements --accept-package-agreements --disable-interactivity
} else {
  Write-Host 'Azure CLI already installed.'
}

Write-Host ''
Write-Host 'Setup complete. Next:'
Write-Host '  1) az login          (one-time interactive browser sign-in)'
Write-Host '  2) npm run dist:signed'
