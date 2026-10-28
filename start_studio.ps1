# ============================================================================
# WEATHERCAST STUDIO - SCRIPT KHOI CHAY TREN WINDOWS POWERSHELL
# ============================================================================
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Test-Path ".env") -and (Test-Path ".env.example")) {
    Copy-Item ".env.example" ".env"
    Write-Host "[INFO] Da tao file .env tu .env.example" -ForegroundColor Cyan
}

if (-not (Test-Path ".\.venv\Scripts\python.exe")) {
    Write-Host "[INFO] Dang khoi tao Python virtual environment (.venv)..." -ForegroundColor Cyan
    py -3.12 -m venv .venv
    .\.venv\Scripts\pip.exe install -r requirements.txt
    .\.venv\Scripts\playwright.exe install chromium
}

if (-not (Test-Path ".\frontend\node_modules")) {
    Write-Host "[INFO] Dang cai dat npm packages cho frontend..." -ForegroundColor Cyan
    Push-Location frontend
    npm install
    Pop-Location
}

Write-Host "[1/2] Khoi dong FastAPI Backend tai http://127.0.0.1:8000 ..." -ForegroundColor Green
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$PSScriptRoot'; .\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000"

Write-Host "[2/2] Khoi dong Vite Frontend tai http://127.0.0.1:5173 ..." -ForegroundColor Green
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$PSScriptRoot\frontend'; npm run dev"

Start-Sleep -Seconds 3
Start-Process "http://127.0.0.1:5173"
Write-Host "WeatherCast Studio da khoi dong tai http://127.0.0.1:5173" -ForegroundColor Yellow
