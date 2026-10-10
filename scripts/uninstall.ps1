$ErrorActionPreference = 'Stop'

function Get-UninstallEntry {
  param([Parameter(Mandatory)][object[]]$Entries)

  $Entries | Where-Object { $_.DisplayName -ceq 'Obsidium' } | Select-Object -First 1
}

function Uninstall-Obsidium {
  $uninstallRoot = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall'
  $entries = @(Get-ChildItem -LiteralPath $uninstallRoot -ErrorAction SilentlyContinue | ForEach-Object { Get-ItemProperty -LiteralPath $_.PSPath })
  $entry = Get-UninstallEntry $entries

  if (-not $entry) {
    Write-Output 'Obsidium is not installed for the current Windows user.'
    return
  }

  $command = if ($entry.QuietUninstallString) { [string]$entry.QuietUninstallString } else { [string]$entry.UninstallString }
  if (-not $command -or $command -notmatch '^\s*(?:"([^"]+)"|(\S+))(.*)$') { throw 'Obsidium uninstall command is missing or invalid.' }
  $executable = if ($Matches[1]) { $Matches[1] } else { $Matches[2] }
  $arguments = $Matches[3].Trim()
  if (-not $entry.QuietUninstallString -and $arguments -notmatch '(?i)(^|\s)/S(\s|$)') { $arguments = "$arguments /S".Trim() }

  $process = Start-Process -FilePath $executable -ArgumentList $arguments -Wait -PassThru
  if ($process.ExitCode -ne 0) { throw "Obsidium uninstaller exited with code $($process.ExitCode)." }
  Write-Output 'Obsidium uninstalled. Vaults, Markdown files, and application data were left untouched.'
}

if ($MyInvocation.InvocationName -ne '.') { Uninstall-Obsidium }
