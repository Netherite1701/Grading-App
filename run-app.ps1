Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Push-Location $PSScriptRoot
try {
  $projectPath = (Resolve-Path $PSScriptRoot).Path
  Write-Host "Closing duplicate Next.js dev processes for:"
  Write-Host "  $projectPath"

  $escapedProjectPath = [Regex]::Escape($projectPath)
  $duplicateProcesses = Get-CimInstance Win32_Process -Filter "name = 'node.exe'" |
    Where-Object {
      $_.CommandLine -and
      $_.CommandLine -match $escapedProjectPath -and
      (
        $_.CommandLine -match 'next(\.js)?\s+dev' -or
        $_.CommandLine -match 'next[\\/](dist|src)'
      )
    } |
    Select-Object -ExpandProperty ProcessId -Unique

  if ($duplicateProcesses) {
    Stop-Process -Id $duplicateProcesses -Force
    Write-Host ("Stopped process IDs: " + ($duplicateProcesses -join ", "))
  }
  else {
    Write-Host "No duplicate app processes found."
  }

  npm run dev
}
finally {
  Pop-Location
}
