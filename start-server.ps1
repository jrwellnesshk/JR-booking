# ==========================================
# Potin Clinic Booking System - Start Script
# Logs are written to logs/ by services/logger.js (daily rotation, 14-day retention)
# For production, prefer pm2: pm2 start ecosystem.config.js
# ==========================================

$port = 4000
$conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($conn) {
    Write-Host "Stopping existing server (PID: $($conn.OwningProcess))..." -ForegroundColor Yellow
    Stop-Process -Id $conn.OwningProcess -Force
    Start-Sleep -Seconds 2
}

Write-Host "Starting Potin Clinic booking system..." -ForegroundColor Green
Start-Process -FilePath "node" -ArgumentList "server.js" -WindowStyle Hidden -WorkingDirectory $PSScriptRoot
Start-Sleep -Seconds 5

$up = Test-NetConnection -ComputerName localhost -Port $port -InformationLevel Quiet -WarningAction SilentlyContinue
if ($up) {
    $logFile = "logs\app-$(Get-Date -Format 'yyyy-MM-dd').log"
    Write-Host "OK - Server is running: http://localhost:$port" -ForegroundColor Green
    Write-Host "   Log file: $logFile"
} else {
    Write-Host "FAILED to start - check the newest log in logs\" -ForegroundColor Red
}
