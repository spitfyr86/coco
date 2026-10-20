param([ValidateSet('dev','app')][string]$Mode, [Parameter(Mandatory)][string]$Token)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
$env:COCO_LAUNCH_TOKEN = $Token
try {
    if ($Mode -eq 'dev') { & npm.cmd run desktop }
    else {
        # GUI programs can detach when invoked with &: keep the tracked host alive.
        $application = Start-Process -FilePath (Join-Path (Get-Location) 'src-tauri\target\release\coco.exe') -WorkingDirectory (Get-Location) -WindowStyle Hidden -PassThru -Wait
        exit $application.ExitCode
    }
    exit $LASTEXITCODE
} catch { Write-Error $_; exit 1 }
