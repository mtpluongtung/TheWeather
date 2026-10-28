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
        self.scenarios_dir = Path(__file__).parent / "data" / "scenarios"
        self.scenarios_dir.mkdir(parents=True, exist_ok=True)
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
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS battle_scenarios (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    data_json TEXT NOT NULL,
                    progress_json TEXT NOT NULL,
                    output_file TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )
            conn.commit()

    # ==========================================
    # ⚔️ BATTLE SCENARIO METHODS
    # ==========================================

    def list_scenarios(self) -> List[Dict[str, Any]]:
        results: Dict[str, Dict[str, Any]] = {}

        # 1. Load built-in JSON scenarios from data/scenarios directory
        if self.scenarios_dir.exists():
            for f in sorted(self.scenarios_dir.glob("*.json")):
                try:
                    with open(f, "r", encoding="utf-8") as fp:
                        data = json.load(fp)
                        sid = data.get("id") or f.stem
                        results[sid] = {
                            "id": sid,
                            "title": data.get("title", f.stem),
                            "subtitle": data.get("subtitle", ""),
                            "historical_date_range": data.get("historical_date_range", ""),
                            "location_name": data.get("location_name", ""),
                            "total_duration_sec": data.get("total_duration_sec", 60.0),
                            "timeline_steps_count": len(data.get("timeline_steps", [])),
                            "factions": [
                                {
                                    "id": fac.get("id"),
                                    "name": fac.get("name"),
                                    "short_name": fac.get("short_name"),
                                    "color": fac.get("color"),
                                    "commander": fac.get("commander"),
                                    "flag_icon": fac.get("flag_icon", "⚔️"),
                                    "initial_manpower": fac.get("initial_manpower", 0),
                                }
                                for fac in data.get("factions", [])
                            ],
                            "is_builtin": True,
                        }
                except Exception:
                    continue

        # 2. Overlay / add custom DB-saved scenarios
        with self._get_conn() as conn:
            rows = conn.execute("SELECT id, title, data_json, output_file, updated_at FROM battle_scenarios").fetchall()
            for row in rows:
                sid = row["id"]
                try:
                    data = json.loads(row["data_json"])
                    results[sid] = {
                        "id": sid,
                        "title": data.get("title", row["title"]),
                        "subtitle": data.get("subtitle", ""),
                        "historical_date_range": data.get("historical_date_range", ""),
                        "location_name": data.get("location_name", ""),
                        "total_duration_sec": data.get("total_duration_sec", 60.0),
                        "timeline_steps_count": len(data.get("timeline_steps", [])),
                        "output_file": row["output_file"],
                        "factions": [
                            {
                                "id": fac.get("id"),
                                "name": fac.get("name"),
                                "short_name": fac.get("short_name"),
                                "color": fac.get("color"),
                                "commander": fac.get("commander"),
                                "flag_icon": fac.get("flag_icon", "⚔️"),
                                "initial_manpower": fac.get("initial_manpower", 0),
                            }
                            for fac in data.get("factions", [])
                        ],
                        "is_builtin": False,
                    }
                except Exception:
                    continue

        return list(results.values())

    def get_scenario(self, scenario_id: str) -> Optional[Dict[str, Any]]:
        # Check DB first
        with self._get_conn() as conn:
            row = conn.execute("SELECT * FROM battle_scenarios WHERE id = ?", (scenario_id,)).fetchone()
            if row:
                data = json.loads(row["data_json"])
                data["progress"] = json.loads(row["progress_json"]) if row["progress_json"] else {}
                data["output_file"] = row["output_file"]
                data["created_at"] = row["created_at"]
                data["updated_at"] = row["updated_at"]
                return data

        # Check built-in scenario file
        file_path = self.scenarios_dir / f"{scenario_id}.json"
        if file_path.exists():
            with open(file_path, "r", encoding="utf-8") as fp:
                data = json.load(fp)
                data["is_builtin"] = True
                return data

        return None

    def save_scenario(self, scenario_data: Dict[str, Any]) -> Dict[str, Any]:
        sid = scenario_data["id"]
        title = scenario_data.get("title", "Chiến dịch lịch sử")
        now_str = now_vn_iso()
        created_at = scenario_data.get("created_at", now_str)
        scenario_data["created_at"] = created_at
        scenario_data["updated_at"] = now_str
        progress = scenario_data.get("progress", {"status": "idle", "progress_pct": 0.0, "current_step": "Sẵn sàng"})
        output_file = scenario_data.get("output_file")

        data_json = json.dumps(scenario_data, ensure_ascii=False)
        progress_json = json.dumps(progress, ensure_ascii=False)

        with self._get_conn() as conn:
            conn.execute(
                """
                INSERT INTO battle_scenarios (id, title, data_json, progress_json, output_file, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    title = excluded.title,
                    data_json = excluded.data_json,
                    progress_json = excluded.progress_json,
                    output_file = excluded.output_file,
                    updated_at = excluded.updated_at
                """,
                (sid, title, data_json, progress_json, output_file, created_at, now_str),
            )
            conn.commit()

        # Also write/update file in scenarios dir for persistence
        file_path = self.scenarios_dir / f"{sid}.json"
        with open(file_path, "w", encoding="utf-8") as fp:
            json.dump(scenario_data, fp, ensure_ascii=False, indent=2)

        return scenario_data

    def update_scenario_progress(
        self, scenario_id: str, progress: Dict[str, Any], output_file: Optional[str] = None
    ) -> None:
        now_str = now_vn_iso()
        progress["updated_at"] = now_str
        with self._get_conn() as conn:
            row = conn.execute("SELECT id FROM battle_scenarios WHERE id = ?", (scenario_id,)).fetchone()
            if not row:
                scen = self.get_scenario(scenario_id) or {"id": scenario_id, "title": scenario_id}
                title = scen.get("title", scenario_id)
                data_json = json.dumps(scen, ensure_ascii=False)
                progress_json = json.dumps(progress, ensure_ascii=False)
                conn.execute(
                    """
                    INSERT INTO battle_scenarios (id, title, data_json, progress_json, output_file, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (scenario_id, title, data_json, progress_json, output_file, now_str, now_str),
                )
            else:
                if output_file is not None:
                    conn.execute(
                        """
                        UPDATE battle_scenarios
                        SET progress_json = ?, output_file = ?, updated_at = ?
                        WHERE id = ?
                        """,
                        (json.dumps(progress, ensure_ascii=False), output_file, now_str, scenario_id),
                    )
                else:
                    conn.execute(
                        """
                        UPDATE battle_scenarios
                        SET progress_json = ?, updated_at = ?
                        WHERE id = ?
                        """,
                        (json.dumps(progress, ensure_ascii=False), now_str, scenario_id),
                    )
            conn.commit()

    def get_scenario_progress(self, scenario_id: str) -> Dict[str, Any]:
        with self._get_conn() as conn:
            row = conn.execute("SELECT progress_json, output_file FROM battle_scenarios WHERE id = ?", (scenario_id,)).fetchone()
            if row and row["progress_json"]:
                p = json.loads(row["progress_json"])
                p["output_file"] = row["output_file"]
                if row["output_file"]:
                    p["download_url"] = f"/api/scenarios/{scenario_id}/download"
                return p
        return {
            "scenario_id": scenario_id,
            "status": "idle",
            "progress_pct": 0.0,
            "current_step": "Sẵn sàng",
            "frames_rendered": 0,
            "total_frames": 0,
        }

    # ==========================================
    # ⛅ LEGACY PROJECTS METHODS
    # ==========================================

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
