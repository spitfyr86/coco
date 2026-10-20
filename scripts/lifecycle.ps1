[CmdletBinding()]
param(
    [ValidateSet('start','stop','restart','status')][string]$Action = 'start',
    [ValidateSet('dev','app')][string]$Mode = 'dev',
    [ValidateRange(10,1800)][int]$TimeoutSeconds = 900
)
$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$stateDirectory = Join-Path $repoRoot '.local'
$statePath = Join-Path $stateDirectory 'process.json'
$hostScript = Join-Path $PSScriptRoot 'run-host.ps1'

function Write-CoCoStatus([string]$Message) {
    Write-Host ('[{0:HH:mm:ss}] {1}' -f (Get-Date), $Message)
}

function Get-CoCoApplication($HostProcess, [string]$LaunchMode, [switch]$RequireWindow) {
    $buildProfile = if ($LaunchMode -eq 'app') { 'release' } else { 'debug' }
    $executable = Join-Path $repoRoot "src-tauri\target\$buildProfile\coco.exe"
    $candidates = @(Get-Process -Name coco -ErrorAction SilentlyContinue | Where-Object {
        $_.Path -eq $executable -and $_.StartTime.ToUniversalTime() -ge $HostProcess.CreationDate.ToUniversalTime() -and (!$RequireWindow -or ($_.MainWindowHandle -ne 0 -and $_.Responding))
    })
    foreach ($candidate in $candidates) {
        # A manually launched app in this checkout is not evidence that our launch succeeded.
        $current = Get-CimInstance Win32_Process -Filter "ProcessId = $($candidate.Id)"
        $visited = [Collections.Generic.HashSet[int]]::new()
        while ($current -and $visited.Add([int]$current.ProcessId)) {
            if ($current.ProcessId -eq $HostProcess.ProcessId -and $current.CreationDate -eq $HostProcess.CreationDate) { return $candidate }
            if ($current.CreationDate -lt $HostProcess.CreationDate) { break }
            $current = Get-CimInstance Win32_Process -Filter "ProcessId = $($current.ParentProcessId)"
        }
    }
    return $null
}

function Wait-CoCoReady($Saved) {
    $timer = [Diagnostics.Stopwatch]::StartNew()
    $lastLines = @{}
    $nextHeartbeat = 10
    try {
        while ($timer.Elapsed.TotalSeconds -lt $TimeoutSeconds) {
            foreach ($name in @('stdout.log','stderr.log')) {
                $line = Get-Content -LiteralPath (Join-Path $stateDirectory $name) -Tail 1 -ErrorAction SilentlyContinue
                if ($line -and $lastLines[$name] -ne $line) {
                    Write-CoCoStatus $line.Trim()
                    $lastLines[$name] = $line
                }
            }
            $hostProcess = Get-CoCoHost $Saved
            if (!$hostProcess) { throw "CoCo launcher exited before its window was ready. Inspect $stateDirectory\stdout.log and stderr.log." }
            $application = Get-CoCoApplication $hostProcess $Saved.mode -RequireWindow
            if ($application) {
                Write-CoCoStatus "CoCo started ($($Saved.mode), app PID $($application.Id)). Window ready."
                return
            }
            $seconds = [int]$timer.Elapsed.TotalSeconds
            Write-Progress -Id 1 -Activity 'Starting CoCo' -Status "Waiting for the app window ($seconds seconds). Logs: $stateDirectory"
            if ($seconds -ge $nextHeartbeat) {
                Write-CoCoStatus "Still starting ($seconds seconds). Waiting for the app window..."
                $nextHeartbeat = $seconds + 10
            }
            Start-Sleep -Milliseconds 500
        }
        throw "CoCo was not ready after $TimeoutSeconds seconds. The launch is still tracked; inspect $stateDirectory or run .\stop.ps1."
    } finally { Write-Progress -Id 1 -Activity 'Starting CoCo' -Completed }
}

function Read-CoCoState {
    if (!(Test-Path -LiteralPath $statePath)) { return $null }
    try { return Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json } catch { throw 'CoCo process state is unreadable. Inspect .local/process.json before continuing.' }
}
function Get-CoCoHost($Saved) {
    if ($null -eq $Saved) { return $null }
    if ($Saved.root -ne $repoRoot) { throw 'The saved process belongs to another checkout.' }
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$Saved.pid)"
    if ($null -eq $process) { return $null }
    $started = $process.CreationDate.ToUniversalTime()
    if ($process.CommandLine -notlike "*$hostScript*" -or $process.CommandLine -notlike "*$($Saved.token)*" -or $started -ne ([datetime]$Saved.started).ToUniversalTime()) {
        throw 'The saved PID no longer identifies this CoCo launch. No process was stopped.'
    }
    return $process
}
function Stop-CoCo {
    $saved = Read-CoCoState
    $hostProcess = Get-CoCoHost $saved
    if ($null -eq $hostProcess) { Write-CoCoStatus 'CoCo is not running through this script.'; return }
    Write-CoCoStatus "Stopping CoCo ($($saved.mode))..."
    # Inventory descendants once, preserve depth, and verify creation times again before stopping.
    $all = @(Get-CimInstance Win32_Process)
    $tree = [Collections.Generic.List[object]]::new()
    $tree.Add([pscustomobject]@{ process = $hostProcess; depth = 0 })
    for ($index = 0; $index -lt $tree.Count; $index++) {
        $parent = $tree[$index]
        foreach ($child in $all | Where-Object { $_.ParentProcessId -eq $parent.process.ProcessId -and $_.CreationDate -ge $hostProcess.CreationDate }) {
            if (!($tree | Where-Object { $_.process.ProcessId -eq $child.ProcessId })) { $tree.Add([pscustomobject]@{ process = $child; depth = $parent.depth + 1 }) }
        }
    }
    # Developer force-stop: normal window close now hides to the tray.
    # The captured tree includes voice workers, which are stopped before their parents.
    $remaining = $tree.Count
    foreach ($item in $tree | Sort-Object depth -Descending) {
        Write-Progress -Id 2 -Activity 'Stopping CoCo' -Status "$remaining tracked processes remaining" -PercentComplete ((($tree.Count - $remaining) / $tree.Count) * 100)
        $live = Get-CimInstance Win32_Process -Filter "ProcessId = $($item.process.ProcessId)"
        if ($live -and $live.CreationDate -eq $item.process.CreationDate) {
            Write-CoCoStatus "Stopping $($live.Name) (PID $($live.ProcessId))..."
            try { Stop-Process -Id $live.ProcessId -Force -ErrorAction Stop }
            catch {
                $after = Get-CimInstance Win32_Process -Filter "ProcessId = $($live.ProcessId)"
                if ($after -and $after.CreationDate -eq $live.CreationDate) { throw }
            }
        }
        $remaining--
    }
    Write-Progress -Id 2 -Activity 'Stopping CoCo' -Completed
    $survivors = @($tree | Where-Object {
        $live = Get-CimInstance Win32_Process -Filter "ProcessId = $($_.process.ProcessId)"
        $live -and $live.CreationDate -eq $_.process.CreationDate
    })
    if ($survivors.Count) { throw 'Some tracked CoCo processes are still running. Launch state was preserved; retry stop.ps1.' }
    if (Test-Path -LiteralPath $statePath) { Remove-Item -LiteralPath $statePath }
    Write-CoCoStatus 'CoCo stopped.'
}
function Start-CoCo {
    $saved = Read-CoCoState
    $existingHost = Get-CoCoHost $saved
    if ($existingHost) {
        if (Get-CoCoApplication $existingHost $saved.mode) {
            Write-CoCoStatus "CoCo is already running ($($saved.mode)). Use its tray icon if the window is hidden."
            return
        }
        Write-CoCoStatus "CoCo launch already exists ($($saved.mode), host PID $($saved.pid)). Checking readiness..."
        Wait-CoCoReady $saved
        return
    }
    Write-CoCoStatus "Starting CoCo ($Mode)..."
    if ($Mode -eq 'dev' -and !(Test-Path -LiteralPath (Join-Path $repoRoot 'node_modules'))) { throw 'Run npm install in the CoCo repository first.' }
    if ($Mode -eq 'app' -and !(Test-Path -LiteralPath (Join-Path $repoRoot 'src-tauri\target\release\coco.exe'))) { throw 'Run npm run package first, or start with -Mode dev.' }
    if ($Mode -eq 'dev') {
        $existing = Get-NetTCPConnection -LocalPort 1420 -State Listen -ErrorAction SilentlyContinue
        if ($existing) { throw 'Port 1420 is already in use. Stop the existing development instance first.' }
    }
    $null = New-Item -ItemType Directory -Force -Path $stateDirectory
    $token = [Guid]::NewGuid().ToString('N')
    $shellPath = (Get-Process -Id $PID).Path
    $arguments = @('-NoLogo','-NoProfile','-NonInteractive','-File',('"' + $hostScript + '"'),'-Mode',$Mode,'-Token',$token)
    $process = Start-Process -FilePath $shellPath -ArgumentList $arguments -WorkingDirectory $repoRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $stateDirectory 'stdout.log') -RedirectStandardError (Join-Path $stateDirectory 'stderr.log') -PassThru
    $nativeProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($process.Id)"
    if (!$nativeProcess) { throw 'CoCo launcher exited immediately. Inspect .local/stderr.log.' }
    @{ pid=$process.Id; started=$nativeProcess.CreationDate.ToUniversalTime().ToString('o'); token=$token; root=$repoRoot; mode=$Mode } | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding utf8
    Write-CoCoStatus "Launcher running. Logs: $stateDirectory"
    Wait-CoCoReady (Read-CoCoState)
}
try {
    switch ($Action) {
        'start' { Start-CoCo }
        'stop' { Stop-CoCo }
        'restart' { Stop-CoCo; Start-CoCo }
        'status' { $saved = Read-CoCoState; if (Get-CoCoHost $saved) { Write-CoCoStatus "CoCo launch active ($($saved.mode), host PID $($saved.pid))." } else { Write-CoCoStatus 'CoCo is not running through this script.' } }
    }
} catch {
    Write-Progress -Id 1 -Activity 'Starting CoCo' -Completed
    Write-Progress -Id 2 -Activity 'Stopping CoCo' -Completed
    Write-CoCoStatus "CoCo $Action failed: $($_.Exception.Message)"
    throw
}
