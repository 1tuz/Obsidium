$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'install.ps1')
. (Join-Path $PSScriptRoot 'uninstall.ps1')

$release = [pscustomobject]@{
  tag_name = 'v1.2.3'
  assets = @(
    [pscustomobject]@{ name = 'Obsidium_1.2.3_x64-setup.exe'; browser_download_url = 'https://github.com/1tuz/Obsidium/releases/download/v1.2.3/Obsidium_1.2.3_x64-setup.exe' },
    [pscustomobject]@{ name = 'Obsidium_1.2.3_arm64-setup.exe'; browser_download_url = 'https://github.com/1tuz/Obsidium/releases/download/v1.2.3/Obsidium_1.2.3_arm64-setup.exe' },
    [pscustomobject]@{ name = 'Obsidium_1.2.3_x64-setup.exe'; browser_download_url = 'http://github.com/1tuz/Obsidium/releases/download/v1.2.3/Obsidium_1.2.3_x64-setup.exe' },
    [pscustomobject]@{ name = 'Obsidium_1.2.3_x64-setup.exe'; browser_download_url = 'https://github.example/Obsidium_1.2.3_x64-setup.exe' }
  )
}

if ((Get-InstallerAssetUrl $release) -ne 'https://github.com/1tuz/Obsidium/releases/download/v1.2.3/Obsidium_1.2.3_x64-setup.exe') { throw 'Installer asset selection failed.' }
$invalidReleases = @(
  [pscustomobject]@{ tag_name = 'v1.2.3'; assets = @([pscustomobject]@{ name = 'Obsidium_1.2.3_x64-setup.exe'; browser_download_url = 'http://github.com/asset.exe' }) },
  [pscustomobject]@{ tag_name = 'v1.2.3'; assets = @([pscustomobject]@{ name = 'Obsidium_1.2.3_x64-setup.exe'; browser_download_url = 'https://github.example/asset.exe' }) },
  [pscustomobject]@{ tag_name = 'v1.2.3'; assets = @([pscustomobject]@{ name = 'Obsidium_1.2.3_arm64-setup.exe'; browser_download_url = 'https://github.com/asset.exe' }) }
)
foreach ($invalidRelease in $invalidReleases) {
  $rejected = $false
  try { Get-InstallerAssetUrl $invalidRelease | Out-Null } catch { $rejected = $true }
  if (-not $rejected) { throw 'Installer asset validation accepted an invalid release asset.' }
}
if (Get-UninstallEntry @([pscustomobject]@{ DisplayName = 'Obsidium Beta' }, [pscustomobject]@{ DisplayName = 'Obsidium' })) { throw 'Uninstall lookup accepted a non-exact name.' }
if ((Get-UninstallEntry @([pscustomobject]@{ DisplayName = 'Obsidium Beta' }, [pscustomobject]@{ DisplayName = 'Obsidium'; UninstallString = 'uninstall.exe' })).UninstallString -ne 'uninstall.exe') { throw 'Exact uninstall lookup failed.' }

'Windows installer checks passed.'
