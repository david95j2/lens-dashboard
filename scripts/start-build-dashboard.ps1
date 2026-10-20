[CmdletBinding()]
param([switch]$NoBrowser, [switch]$RegisterStartup, [switch]$RemoveStartup, [switch]$Restart)
$ErrorActionPreference = 'Stop'
$dashboard = Join-Path $PSScriptRoot 'build-dashboard'
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$startupName = 'SiriusBuildDashboard'
if ($RemoveStartup) {
    Remove-ItemProperty -LiteralPath $runKey -Name $startupName -ErrorAction SilentlyContinue
    Write-Host 'Automatic startup removed. The running server is unchanged.'
    return
}
$node = (Get-Command node -ErrorAction Stop).Source
$serverFile = Join-Path $dashboard 'server.mjs'
$port = (Get-Content -LiteralPath (Join-Path $dashboard 'settings.json') -Raw | ConvertFrom-Json).port
$url = "http://127.0.0.1:$port"
if ($RegisterStartup) {
    $powershell = Join-Path $PSHOME 'powershell.exe'
    if (-not (Test-Path -LiteralPath $powershell)) {
        $powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    }
    $startupCommand = "`"$powershell`" -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$PSCommandPath`" -NoBrowser"
    New-Item -Path $runKey -Force | Out-Null
    New-ItemProperty -LiteralPath $runKey -Name $startupName -Value $startupCommand -PropertyType String -Force | Out-Null
}
$mutex = New-Object System.Threading.Mutex($false, "Local\SiriusBuildDashboard-$port")
$locked = $false
try {
    $locked = $mutex.WaitOne(15000)
    if (-not $locked) { throw 'Another dashboard launcher is running.' }
    $listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($listener) {
        $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)"
        if ($process.Name -ne 'node.exe' -or -not $process.CommandLine.Contains($serverFile)) {
            throw "Port $port is used by another application."
        }
        if ($Restart) {
            $state = Invoke-RestMethod "$url/api/state" -TimeoutSec 15
            if ($state.active) { throw 'A dashboard job is running. Restart after it completes.' }
            Stop-Process -Id $listener.OwningProcess -ErrorAction Stop
            Wait-Process -Id $listener.OwningProcess -Timeout 10 -ErrorAction SilentlyContinue
            $listener = $null
        }
    }
    if (-not $listener) {
        $logs = Join-Path $PSScriptRoot '..\artifacts\dashboard-server'
        New-Item -ItemType Directory -Path $logs -Force | Out-Null
        Start-Process -FilePath $node -ArgumentList "`"$serverFile`"" -WorkingDirectory $dashboard -WindowStyle Hidden `
            -RedirectStandardOutput (Join-Path $logs 'server.log') -RedirectStandardError (Join-Path $logs 'server-error.log') | Out-Null
    }
    $ready = $false
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        try { Invoke-WebRequest $url -UseBasicParsing -TimeoutSec 2 | Out-Null; $ready = $true; break }
        catch { Start-Sleep -Milliseconds 250 }
    }
    if (-not $ready) { throw "Dashboard did not start. Check artifacts\dashboard-server." }
    if (-not $NoBrowser) { Start-Process $url }
    Write-Host "Dashboard is running in the background: $url"
} finally {
    if ($locked) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
