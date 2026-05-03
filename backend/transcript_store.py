import hashlib
import os
import sqlite3
from typing import Dict, List, Optional

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity


def make_video_id(url: str) -> str:
    return hashlib.md5(url.encode()).hexdigest()[:12]


class TranscriptStore:
    """Hybrid store: in-memory cache (primary) + SQLite (persistence across requests).

    In-memory layer means /api/ask always finds a video that was loaded in the same
    process, even if SQLite is unavailable.  SQLite persists data across hot-reloads.

    Set DB_PATH env var (e.g. /data/transcripts.db on a Railway volume) for
    persistence across full container restarts / redeployments.
    """

    def __init__(self, db_path: Optional[str] = None):
        if db_path is None:
            db_path = os.getenv("DB_PATH", "/tmp/transcripts.db")
        self.db_path = db_path
        # In-memory cache: {video_id: {"url": str, "chunks": List[dict]}}
        self._mem: Dict[str, dict] = {}
        self._init_db()

    # ── DB init ────────────────────────────────────────────────────────────────

    def _init_db(self):
        try:
            conn = sqlite3.connect(self.db_path)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS videos (
                    video_id TEXT PRIMARY KEY,
                    video_url TEXT NOT NULL,
                    title TEXT DEFAULT '',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS chunks (
                    chunk_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    video_id TEXT NOT NULL,
                    text TEXT NOT NULL,
                    start_time REAL NOT NULL,
                    end_time REAL NOT NULL,
                    chunk_index INTEGER NOT NULL,
                    FOREIGN KEY (video_id) REFERENCES videos(video_id)
                )
            """)
            conn.commit()
            conn.close()
            print(f"[store] SQLite ready at {self.db_path}")
        except Exception as e:
            print(f"[store] SQLite init failed (memory-only mode): {e}")

    # ── Write ──────────────────────────────────────────────────────────────────

    def save_video(self, video_id: str, video_url: str, title: str = ""):
        # Always write to memory first
        if video_id not in self._mem:
            self._mem[video_id] = {"url": video_url, "chunks": []}
        else:
            self._mem[video_id]["url"] = video_url
        # Best-effort SQLite write
        try:
            conn = sqlite3.connect(self.db_path)
            conn.execute(
                "INSERT OR REPLACE INTO videos (video_id, video_url, title) VALUES (?, ?, ?)",
                (video_id, video_url, title),
            )
            conn.commit()
            conn.close()
        except Exception as e:
            print(f"[store] save_video SQLite error (data safe in memory): {e}")

    def save_chunks(self, video_id: str, chunks: List[dict]):
        # Always write to memory first
        if video_id not in self._mem:
            self._mem[video_id] = {"url": "", "chunks": chunks}
        else:
            self._mem[video_id]["chunks"] = chunks
        # Best-effort SQLite write
        try:
            conn = sqlite3.connect(self.db_path)
            conn.execute("DELETE FROM chunks WHERE video_id = ?", (video_id,))
            for i, chunk in enumerate(chunks):
                conn.execute(
                    "INSERT INTO chunks (video_id, text, start_time, end_time, chunk_index) "
                    "VALUES (?, ?, ?, ?, ?)",
                    (video_id, chunk["text"], chunk["start_time"], chunk["end_time"], i),
                )
            conn.commit()
            conn.close()
        except Exception as e:
            print(f"[store] save_chunks SQLite error (data safe in memory): {e}")

    # ── Read ───────────────────────────────────────────────────────────────────

    def video_exists(self, video_id: str) -> bool:
        if video_id in self._mem:
            return True
        try:
            conn = sqlite3.connect(self.db_path)
            row = conn.execute(
                "SELECT 1 FROM videos WHERE video_id = ?", (video_id,)
            ).fetchone()
            conn.close()
            return row is not None
        except Exception:
            return False

    def get_chunks(self, video_id: str) -> List[dict]:
        # Memory first (fastest, always consistent with what was saved)
        if video_id in self._mem and self._mem[video_id].get("chunks"):
            return self._mem[video_id]["chunks"]
        # Fall back to SQLite (e.g. after process restart if volume is mounted)
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.execute(
                "SELECT chunk_id, text, start_time, end_time, chunk_index FROM chunks "
                "WHERE video_id = ? ORDER BY chunk_index",
                (video_id,),
            )
            rows = cursor.fetchall()
            conn.close()
            chunks = [
                {
                    "chunk_id": r[0], "text": r[1],
                    "start_time": r[2], "end_time": r[3], "chunk_index": r[4],
                }
                for r in rows
            ]
            # Warm the memory cache from SQLite
            if chunks:
                if video_id not in self._mem:
                    self._mem[video_id] = {"url": "", "chunks": chunks}
                else:
                    self._mem[video_id]["chunks"] = chunks
            return chunks
        except Exception:
            return []

    def search_chunks(self, video_id: str, query: str, top_k: int = 3) -> List[dict]:
        chunks = self.get_chunks(video_id)
        if not chunks:
            return []
        if len(chunks) <= top_k:
            return chunks
        texts = [c["text"] for c in chunks]
        try:
            vec = TfidfVectorizer(analyzer="char_wb", ngram_range=(2, 4), sublinear_tf=True)
            matrix = vec.fit_transform(texts + [query])
            sims = cosine_similarity(matrix[-1], matrix[:-1])[0]
            top_idx = np.argsort(sims)[::-1][:top_k]
            result = [{**chunks[i], "score": float(sims[i])} for i in top_idx if sims[i] > 0]
            return result if result else chunks[:top_k]
        except Exception:
            return chunks[:top_k]
