@echo off
chcp 65001 >nul
echo ============================================================================
echo   WEATHERCAST STUDIO - KHOI DONG HE THONG TREN WINDOWS 10/11
echo ============================================================================

cd /d "%~dp0"

if not exist ".env" (
    if exist ".env.example" (
        copy ".env.example" ".env" >nul
        echo [INFO] Da tao file .env mac dinh tu .env.example
    )
)

if not exist ".venv\Scripts\python.exe" (
    echo [INFO] Dang tao moi truong Python (.venv)...
    py -3.12 -m venv .venv 2>nul || py -m venv .venv
    .\.venv\Scripts\pip.exe install -r requirements.txt
    .\.venv\Scripts\playwright.exe install chromium
)

echo [1/2] Dang khoi dong FastAPI Backend tai http://127.0.0.1:8000 ...
start "WeatherCast Backend API" cmd /k ".\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000"

echo [2/2] Dang khoi dong Vite React MapLibre Frontend tai http://127.0.0.1:5173 ...
start "WeatherCast Frontend Studio" cmd /k "cd frontend && npm run dev"

timeout /t 3 >nul
start "" "http://127.0.0.1:5173"

echo ============================================================================
echo   WeatherCast Studio dang chay!
echo   - Giao dien Studio: http://127.0.0.1:5173
echo   - Tai lieu OpenAPI: http://127.0.0.1:8000/docs
echo ============================================================================
