import sqlite3
import hashlib
from typing import List

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity


def make_video_id(url: str) -> str:
    return hashlib.md5(url.encode()).hexdigest()[:12]


class TranscriptStore:
    def __init__(self, db_path: str = "transcripts.db"):
        self.db_path = db_path
        self._init_db()

    def _init_db(self):
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

    def save_video(self, video_id: str, video_url: str, title: str = ""):
        conn = sqlite3.connect(self.db_path)
        conn.execute(
            "INSERT OR REPLACE INTO videos (video_id, video_url, title) VALUES (?, ?, ?)",
            (video_id, video_url, title),
        )
        conn.commit()
        conn.close()

    def save_chunks(self, video_id: str, chunks: List[dict]):
        conn = sqlite3.connect(self.db_path)
        conn.execute("DELETE FROM chunks WHERE video_id = ?", (video_id,))
        for i, chunk in enumerate(chunks):
            conn.execute(
                "INSERT INTO chunks (video_id, text, start_time, end_time, chunk_index) VALUES (?, ?, ?, ?, ?)",
                (video_id, chunk["text"], chunk["start_time"], chunk["end_time"], i),
            )
        conn.commit()
        conn.close()

    def get_chunks(self, video_id: str) -> List[dict]:
        conn = sqlite3.connect(self.db_path)
        cursor = conn.execute(
            "SELECT chunk_id, text, start_time, end_time, chunk_index FROM chunks "
            "WHERE video_id = ? ORDER BY chunk_index",
            (video_id,),
        )
        rows = cursor.fetchall()
        conn.close()
        return [
            {"chunk_id": r[0], "text": r[1], "start_time": r[2], "end_time": r[3], "chunk_index": r[4]}
            for r in rows
        ]

    def search_chunks(self, video_id: str, query: str, top_k: int = 3) -> List[dict]:
        chunks = self.get_chunks(video_id)
        if not chunks:
            return []
        if len(chunks) <= top_k:
            return chunks

        texts = [c["text"] for c in chunks]
        try:
            # char-level n-grams handle Hindi + English without stop-word issues
            vec = TfidfVectorizer(analyzer="char_wb", ngram_range=(2, 4), sublinear_tf=True)
            matrix = vec.fit_transform(texts + [query])
            sims = cosine_similarity(matrix[-1], matrix[:-1])[0]
            top_idx = np.argsort(sims)[::-1][:top_k]
            result = [{**chunks[i], "score": float(sims[i])} for i in top_idx if sims[i] > 0]
            return result if result else chunks[:top_k]
        except Exception:
            return chunks[:top_k]

    def video_exists(self, video_id: str) -> bool:
        conn = sqlite3.connect(self.db_path)
        row = conn.execute("SELECT 1 FROM videos WHERE video_id = ?", (video_id,)).fetchone()
        conn.close()
        return row is not None
