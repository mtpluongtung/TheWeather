@echo off
chcp 65001 >nul
set PYTHONIOENCODING=utf-8
echo ============================================================================
echo   ⚔️  ARES STUDIO - SA BÀN CHIẾN DỊCH LỊCH SỬ 3D (ANIMATED MILITARY MAP)
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

if not exist "frontend\node_modules" (
    echo [INFO] Dang cai dat npm packages cho frontend...
    cd frontend
    call npm install
    cd ..
)

echo [1/2] Dang khoi dong FastAPI Backend tai http://127.0.0.1:8000 ...
start "Ares Military Backend" cmd /k "set PYTHONIOENCODING=utf-8 && .\.venv\Scripts\python.exe main.py"

echo [2/2] Dang khoi dong Vite 3D Studio tai http://127.0.0.1:5173 ...
start "Ares Military Studio Frontend" cmd /k "npm run dev"

timeout /t 3 >nul
start "" "http://127.0.0.1:5173"

echo ============================================================================
echo   ⚔️  Ares Military History Studio dang chay!
echo   - Giao dien Studio: http://127.0.0.1:5173
echo   - Tai lieu OpenAPI: http://127.0.0.1:8000/docs
echo ============================================================================
