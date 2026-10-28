import json
import sqlite3
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Dict, Any, List, Optional
from backend.config import settings

VN_TZ = timezone(timedelta(hours=7))


def now_vn_iso() -> str:
    return datetime.now(VN_TZ).isoformat(timespec="seconds")


class DatabaseManager:
    def __init__(self, db_path: Optional[Path] = None) -> None:
        self.db_path = db_path or settings.database_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _get_conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.db_path), timeout=30.0)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        with self._get_conn() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS projects (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    config_json TEXT NOT NULL,
                    scenes_json TEXT NOT NULL,
                    progress_json TEXT NOT NULL,
                    output_file TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )
            conn.commit()

    def save_project(self, project_data: Dict[str, Any]) -> Dict[str, Any]:
        project_id = project_data["id"]
        name = project_data.get("name", "Bản tin Thời tiết")
        now_str = now_vn_iso()
        created_at = project_data.get("created_at", now_str)
        project_data["created_at"] = created_at
        project_data["updated_at"] = now_str

        config_copy = {
            k: v
            for k, v in project_data.items()
            if k not in ("scenes", "progress")
        }
        scenes_json = json.dumps(project_data.get("scenes", []), ensure_ascii=False)
        progress_json = json.dumps(project_data.get("progress", {}), ensure_ascii=False)
        config_json = json.dumps(config_copy, ensure_ascii=False)
        output_file = project_data.get("output_file")

        with self._get_conn() as conn:
            conn.execute(
                """
                INSERT INTO projects (id, name, config_json, scenes_json, progress_json, output_file, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    name = excluded.name,
                    config_json = excluded.config_json,
                    scenes_json = excluded.scenes_json,
                    progress_json = excluded.progress_json,
                    output_file = excluded.output_file,
                    updated_at = excluded.updated_at
                """,
                (project_id, name, config_json, scenes_json, progress_json, output_file, created_at, now_str),
            )
            conn.commit()
        return project_data

    def get_project(self, project_id: str) -> Optional[Dict[str, Any]]:
        with self._get_conn() as conn:
            row = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
            if not row:
                return None
            config = json.loads(row["config_json"])
            config["scenes"] = json.loads(row["scenes_json"])
            config["progress"] = json.loads(row["progress_json"])
            config["output_file"] = row["output_file"]
            config["created_at"] = row["created_at"]
            config["updated_at"] = row["updated_at"]
            return config

    def list_projects(self, limit: int = 25) -> List[Dict[str, Any]]:
        with self._get_conn() as conn:
            rows = conn.execute(
                "SELECT * FROM projects ORDER BY updated_at DESC LIMIT ?", (limit,)
            ).fetchall()
            results = []
            for row in rows:
                config = json.loads(row["config_json"])
                config["scenes"] = json.loads(row["scenes_json"])
                config["progress"] = json.loads(row["progress_json"])
                config["output_file"] = row["output_file"]
                config["created_at"] = row["created_at"]
                config["updated_at"] = row["updated_at"]
                results.append(config)
            return results

    def update_progress(self, project_id: str, progress: Dict[str, Any], output_file: Optional[str] = None) -> None:
        now_str = now_vn_iso()
        progress["updated_at"] = now_str
        with self._get_conn() as conn:
            if output_file is not None:
                conn.execute(
                    """
                    UPDATE projects
                    SET progress_json = ?, output_file = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (json.dumps(progress, ensure_ascii=False), output_file, now_str, project_id),
                )
            else:
                conn.execute(
                    """
                    UPDATE projects
                    SET progress_json = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (json.dumps(progress, ensure_ascii=False), now_str, project_id),
                )
            conn.commit()


db = DatabaseManager()
