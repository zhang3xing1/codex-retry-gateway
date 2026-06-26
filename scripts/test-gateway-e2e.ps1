$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$nodeScript = Join-Path $scriptDir "test-gateway-e2e.mjs"

node $nodeScript
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
