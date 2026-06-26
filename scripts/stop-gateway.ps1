param(
  [string]$StateRoot = "$HOME\.codex-retry-gateway",
  [switch]$Quiet
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot "common.ps1")

$paths = Get-GatewayStatePaths -StateRoot $StateRoot
if (-not (Test-Path -LiteralPath $paths.PidPath)) {
  if (-not $Quiet) {
    Write-Output "No running gateway PID file was found."
  }
  exit 0
}

$pidRaw = (Get-Content -LiteralPath $paths.PidPath -Raw).Trim()
if (-not $pidRaw) {
  Remove-Item -LiteralPath $paths.PidPath -Force
  if (-not $Quiet) {
    Write-Output "Gateway PID file was empty and has been removed."
  }
  exit 0
}

$gatewayPid = [int]$pidRaw
if (Test-ProcessAlive -ProcessId $gatewayPid) {
  Stop-Process -Id $gatewayPid -Force
}

Remove-Item -LiteralPath $paths.PidPath -Force -ErrorAction SilentlyContinue
if (-not $Quiet) {
  Write-Output "Gateway stopped. PID=$gatewayPid"
}
