$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$nodeScript = Join-Path $scriptDir "test-install-restore.mjs"

node $nodeScript
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
