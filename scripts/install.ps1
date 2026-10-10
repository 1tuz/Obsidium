$ErrorActionPreference = 'Stop'

function Get-InstallerAssetUrl {
  param([Parameter(Mandatory)]$Release)

  $version = [string]$Release.tag_name -replace '^v', ''
  $assetName = "Obsidium_${version}_x64-setup.exe"
  $asset = @($Release.assets | Where-Object { $_.name -ceq $assetName }) | Select-Object -First 1
  if (-not $asset) { throw "Latest GitHub release has no $assetName asset." }

  $assetUri = [uri]$asset.browser_download_url
  if ($assetUri.Scheme -cne 'https' -or $assetUri.Host -cne 'github.com') { throw 'Installer asset URL must use HTTPS on github.com.' }
  $assetUri.AbsoluteUri
}

function Install-Obsidium {
  if (-not [Environment]::Is64BitOperatingSystem) { throw 'Obsidium Windows installer supports x64 Windows only.' }

  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $release = Invoke-RestMethod -Uri 'https://api.github.com/repos/1tuz/Obsidium/releases/latest'
  $assetUrl = Get-InstallerAssetUrl $release
  $temporaryInstaller = Join-Path ([IO.Path]::GetTempPath()) ("Obsidium-" + [guid]::NewGuid().ToString('N') + '.exe')

  try {
    Invoke-WebRequest -Uri $assetUrl -OutFile $temporaryInstaller
    $process = Start-Process -FilePath $temporaryInstaller -ArgumentList @('/S', '/CURRENTUSER') -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw "Obsidium installer exited with code $($process.ExitCode)." }
    Write-Output 'Obsidium installed for the current Windows user.'
  }
  finally {
    Remove-Item -LiteralPath $temporaryInstaller -Force -ErrorAction SilentlyContinue
  }
}

if ($MyInvocation.InvocationName -ne '.') { Install-Obsidium }
