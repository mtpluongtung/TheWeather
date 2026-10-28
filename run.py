import sys
from pathlib import Path

# Ensure root directory is on sys.path
root_dir = Path(__file__).resolve().parent
if str(root_dir) not in sys.path:
    sys.path.insert(0, str(root_dir))

# Ensure UTF-8 output on Windows
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

if __name__ == "__main__":
    import uvicorn
    from backend.config import settings

    print("=" * 70)
    print("  ⚔️  ARES TACTICAL MILITARY STUDIO - FASTAPI BACKEND")
    print(f"  API Docs: http://{settings.app_host}:{settings.app_port}/docs")
    print(f"  Frontend: {settings.frontend_url}")
    print("=" * 70)
    uvicorn.run(
        "backend.main:app",
        host=settings.app_host,
        port=settings.app_port,
        reload=False,
    )
