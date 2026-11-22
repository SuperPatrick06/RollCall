$ErrorActionPreference = 'Stop'

# Some managed Windows terminals expose both Path and PATH. Windows PowerShell
# Start-Process treats them as duplicate dictionary keys, so normalize once.
$processPathValue = $env:Path
[Environment]::SetEnvironmentVariable('PATH', $null, 'Process')
[Environment]::SetEnvironmentVariable('Path', $processPathValue, 'Process')

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendRoot = Join-Path $projectRoot 'backend'
$frontendRoot = Join-Path $projectRoot 'frontend'
$pythonExe = (Get-Command python -ErrorAction Stop).Source
$npmExe = (Get-Command npm.cmd -ErrorAction Stop).Source
$backendProcess = $null
$frontendProcess = $null
$cancelRequested = $false

function Test-LocalPort {
    param([int]$Port)
    $client = [System.Net.Sockets.TcpClient]::new()
    try {
        $task = $client.ConnectAsync('127.0.0.1', $Port)
        return $task.Wait(250) -and $client.Connected
    }
    catch {
        return $false
    }
    finally {
        $client.Dispose()
    }
}

function Stop-ProcessTree {
    param([System.Diagnostics.Process]$Process)
    if ($null -eq $Process) { return }
    $Process.Refresh()
    if (-not $Process.HasExited) {
        & taskkill.exe /PID $Process.Id /T /F 2>$null | Out-Null
    }
}

$cancelHandler = [ConsoleCancelEventHandler]{
    param($sender, $eventArgs)
    $eventArgs.Cancel = $true
    $script:cancelRequested = $true
}

try {
    if (Test-LocalPort -Port 8000) {
        throw 'Port 8000 is already in use. Stop that process and try again.'
    }
    if (Test-LocalPort -Port 5173) {
        throw 'Port 5173 is already in use. Stop that process and try again.'
    }

    if (-not (Test-Path -LiteralPath (Join-Path $frontendRoot 'node_modules'))) {
        Write-Host 'First run: installing frontend dependencies...' -ForegroundColor Cyan
        Push-Location $frontendRoot
        try {
            & $npmExe install
            if ($LASTEXITCODE -ne 0) { throw 'Frontend dependency installation failed.' }
        }
        finally {
            Pop-Location
        }
    }

    & $pythonExe -c "import fastapi, uvicorn" 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Host 'Installing backend dependencies...' -ForegroundColor Cyan
        & $pythonExe -m pip install -r (Join-Path $backendRoot 'requirements.txt')
        if ($LASTEXITCODE -ne 0) { throw 'Backend dependency installation failed.' }
    }

    [Console]::add_CancelKeyPress($cancelHandler)
    $backendProcess = Start-Process -FilePath $pythonExe `
        -ArgumentList @('-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '8000', '--reload') `
        -WorkingDirectory $backendRoot -NoNewWindow -PassThru
    $frontendProcess = Start-Process -FilePath $npmExe `
        -ArgumentList @('run', 'dev') `
        -WorkingDirectory $frontendRoot -NoNewWindow -PassThru

    Write-Host ''
    Write-Host 'RollCall is running.' -ForegroundColor Green
    Write-Host 'Frontend: http://127.0.0.1:5173' -ForegroundColor White
    Write-Host 'Backend API: http://127.0.0.1:8000/docs' -ForegroundColor DarkGray
    Write-Host 'Press Ctrl+C to stop both services.' -ForegroundColor Yellow
    Write-Host ''

    while (-not $cancelRequested) {
        Start-Sleep -Milliseconds 500
        $backendProcess.Refresh()
        $frontendProcess.Refresh()
        if ($backendProcess.HasExited) { throw 'The backend service exited unexpectedly.' }
        if ($frontendProcess.HasExited) { throw 'The frontend service exited unexpectedly.' }
    }
}
finally {
    [Console]::remove_CancelKeyPress($cancelHandler)
    Write-Host "`nStopping services..." -ForegroundColor Yellow
    Stop-ProcessTree -Process $frontendProcess
    Stop-ProcessTree -Process $backendProcess
    Write-Host 'Both services have stopped.' -ForegroundColor Green
}
