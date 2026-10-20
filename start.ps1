[CmdletBinding()]
param(
    [ValidateSet('dev','app')][string]$Mode = 'dev',
    [ValidateRange(10,1800)][int]$TimeoutSeconds = 900
)
$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'scripts\lifecycle.ps1') -Action start -Mode $Mode -TimeoutSeconds $TimeoutSeconds
