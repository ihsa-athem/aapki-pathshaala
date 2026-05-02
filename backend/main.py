import asyncio
import contextlib
import math
import os
import subprocess
import tempfile
import wave
from pathlib import Path
from typing import List, Optional, Tuple

import imageio_ffmpeg
import json
import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

# Bundled ffmpeg binary — works on Windows/Linux/Mac without system install
FFMPEG_BIN = imageio_ffmpeg.get_ffmpeg_exe()

load_dotenv()

from claude_tutor import answer_question_stream, generate_chapters, generate_fun_facts, generate_lesson_pack, generate_quiz, translate_transcript
from sarvam import synthesize_speech
from sarvam import transcribe_audio as sarvam_transcribe
from sarvam import transcribe_question as sarvam_transcribe_question
from transcript_store import TranscriptStore, make_video_id

app = FastAPI(title="Aapki Pathshaala API", version="1.0.0")

# CORS: read allowed origins from env var so production frontend domains work.
# Set ALLOWED_ORIGINS="https://your-app.vercel.app" in Railway env vars.
# Falls back to localhost for local dev.
_raw_origins = os.getenv("ALLOWED_ORIGINS", "")
_origins: list = [o.strip() for o in _raw_origins.split(",") if o.strip()]
if not _origins:
    _origins = [
        "http://localhost:5173",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
    ]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_origin_regex=r"https://.*\.vercel\.app",  # allow any Vercel preview URL
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

store = TranscriptStore()

WORDS_PER_CHUNK = 200
SEG_DURATION = 25  # seconds per STT call — Sarvam STT API hard-limits audio to 30s


# ── Request models ───────────────────────────────────────────────────────────

class LoadVideoRequest(BaseModel):
    video_url: str


class AskRequest(BaseModel):
    question: str
    video_id: str
    language: str = "en"
    answer_language: str = "auto"   # "auto" | "en" | "hi"
    class_level: int = 7


class SpeakRequest(BaseModel):
    text: str
    language: str = "en"
    voice: str = "meera"   # Sarvam speaker name tied to persona


class QuizRequest(BaseModel):
    video_id: str
    language: str = "en"


class ChaptersRequest(BaseModel):
    video_id: str


class TranslateRequest(BaseModel):
    text: str
    target_language: str = "en"   # "en" or "hi"
    style: str = "standard"        # "standard" or "simple"


class FunFactsRequest(BaseModel):
    video_id: str


class LessonPackRequest(BaseModel):
    video_id: str
    language: str = "en"


# ── Audio helpers ─────────────────────────────────────────────────────────────

def _run_cmd(cmd: list) -> subprocess.CompletedProcess:
    """Run a subprocess synchronously. Called inside a thread-pool executor so
    the event loop is never blocked and Windows asyncio subprocesses are avoided."""
    return subprocess.run(cmd, capture_output=True, check=False)


async def _exec(cmd: list) -> subprocess.CompletedProcess:
    """Await a subprocess without using asyncio.create_subprocess_exec,
    which raises NotImplementedError on Windows with SelectorEventLoop."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _run_cmd, cmd)


def _wav_duration(path: str) -> float:
    """Read duration from WAV header using stdlib — no ffprobe needed."""
    try:
        with contextlib.closing(wave.open(path, "r")) as w:
            return w.getnframes() / float(w.getframerate())
    except Exception:
        return 300.0


def _get_cookies_path() -> Optional[str]:
    """
    Write the YOUTUBE_COOKIES env var to a temp file and return its path.

    In Railway dashboard: Settings → Variables → Add
      Name:  YOUTUBE_COOKIES
      Value: (paste full contents of cookies.txt in Netscape format)

    How to get cookies.txt:
      1. Install "Get cookies.txt LOCALLY" Chrome/Firefox extension
      2. Go to https://www.youtube.com while logged in to a Google account
      3. Click the extension → "Export" → save as cookies.txt
      4. Copy the entire file contents into the Railway YOUTUBE_COOKIES variable
    """
    raw = os.getenv("YOUTUBE_COOKIES", "").strip()
    if not raw:
        return None
    try:
        f = tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False)
        f.write(raw)
        f.close()
        print(f"[yt-dlp] using YOUTUBE_COOKIES from env ({len(raw)} chars)")
        return f.name
    except Exception as e:
        print(f"[yt-dlp] failed to write cookies file: {e}")
        return None


def _build_ytdlp_cmd(url: str, out_path: str, cookies_path: Optional[str] = None) -> list:
    cmd = [
        "yt-dlp",
        "--format", "bestaudio[ext=m4a]/bestaudio/best",
        "-x",
        "--audio-format", "wav",
        "--postprocessor-args", "ffmpeg:-ar 16000 -ac 1",
        "--ffmpeg-location", FFMPEG_BIN,
        "--no-check-formats",
        "--no-check-certificates",
        # android_vr first: uses Android API endpoints, far less rate-limited than web.
        # Falls back to mweb → web if android_vr formats are unavailable.
        "--extractor-args", "youtube:player_client=android_vr,mweb,web",
        "--js-runtimes", "node,deno",
        "--user-agent",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "--add-header", "Accept-Language: en-US,en;q=0.9",
        "--sleep-interval", "2",
        "--max-sleep-interval", "5",
        "--retries", "5",
        "--fragment-retries", "5",
        "-o", out_path,
        "--no-playlist", "--no-progress",
    ]
    if cookies_path:
        cmd += ["--cookies", cookies_path]
    cmd.append(url)
    return cmd


async def _download_yt_audio(url: str, out_path: str, cookies_path: Optional[str] = None) -> float:
    """Download YouTube audio. Caller owns the cookies_path lifecycle."""
    cmd = _build_ytdlp_cmd(url, out_path, cookies_path)
    result = await _exec(cmd)

    if result.returncode != 0:
        stderr = result.stderr.decode()
        if "429" in stderr or "too many requests" in stderr.lower():
            print("[yt-dlp] 429 hit — waiting 15 s and retrying once")
            await asyncio.sleep(15)
            Path(out_path).unlink(missing_ok=True)
            result = await _exec(cmd)

    if result.returncode != 0 or not Path(out_path).exists():
        raise HTTPException(400, f"yt-dlp error:\n{result.stderr.decode()[:500]}")
    return _wav_duration(out_path)


async def _convert_to_wav(audio_bytes: bytes, suffix: str = ".webm") -> bytes:
    """Convert arbitrary browser audio to 16kHz mono WAV for Sarvam STT."""
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
        f.write(audio_bytes)
        in_path = f.name
    out_path = in_path + ".wav"
    await _exec([FFMPEG_BIN, "-y", "-i", in_path, "-ar", "16000", "-ac", "1", out_path, "-loglevel", "quiet"])
    try:
        with open(out_path, "rb") as f:
            return f.read()
    finally:
        Path(in_path).unlink(missing_ok=True)
        Path(out_path).unlink(missing_ok=True)


# ── Transcript chunking ──────────────────────────────────────────────────────

def _segments_to_chunks(segments: List[dict]) -> List[dict]:
    chunks, buf_words, buf_start, buf_end = [], [], None, 0.0
    for seg in segments:
        text = seg.get("text", seg.get("word", "")).strip()
        if not text:
            continue
        start = float(seg.get("start", 0))
        end = float(seg.get("end", start + 0.5))
        if buf_start is None:
            buf_start = start
        buf_end = end
        buf_words.append(text)
        if sum(len(w.split()) for w in buf_words) >= WORDS_PER_CHUNK:
            chunks.append({"text": " ".join(buf_words), "start_time": buf_start, "end_time": buf_end})
            buf_words, buf_start = [], None
    if buf_words:
        chunks.append({"text": " ".join(buf_words), "start_time": buf_start or 0.0, "end_time": buf_end})
    return chunks


def _text_to_timed_chunks(text: str, duration: float) -> List[dict]:
    words = text.split()
    n = len(words)
    chunks = []
    for i in range(0, n, WORDS_PER_CHUNK):
        w = words[i : i + WORDS_PER_CHUNK]
        chunks.append({
            "text": " ".join(w),
            "start_time": (i / n) * duration,
            "end_time": (min(i + WORDS_PER_CHUNK, n) / n) * duration,
        })
    return chunks


def _seg_to_chunks(text: str, t_start: float, t_end: float) -> List[dict]:
    """Build chunks for a single segment window, timestamps relative to t_start."""
    words = text.split()
    n = len(words) or 1
    dur = t_end - t_start
    chunks = []
    for i in range(0, n, WORDS_PER_CHUNK):
        w = words[i : i + WORDS_PER_CHUNK]
        chunks.append({
            "text": " ".join(w),
            "start_time": t_start + (i / n) * dur,
            "end_time": t_start + (min(i + WORDS_PER_CHUNK, n) / n) * dur,
        })
    return chunks


def _sse(obj: dict) -> str:
    # ensure_ascii=False keeps emojis as UTF-8 so the browser JSON.parse works
    return f"data: {json.dumps(obj, ensure_ascii=False)}\n\n"


async def _transcribe_full(audio_path: str, duration: float) -> Tuple[List[dict], str]:
    """Split audio into segments, transcribe each, return (segments, full_text)."""
    all_segs: List[dict] = []
    text_parts: List[str] = []

    num_segs = max(1, int(duration / SEG_DURATION) + 1)
    for i in range(num_segs):
        t_start = i * SEG_DURATION
        if t_start >= duration:
            break

        seg_path = audio_path.replace(".wav", f"_seg{i}.wav")
        await _exec([
            FFMPEG_BIN, "-y", "-i", audio_path,
            "-ss", str(t_start), "-t", str(SEG_DURATION),
            "-ar", "16000", "-ac", "1", seg_path, "-loglevel", "quiet",
        ])

        seg_file = Path(seg_path)
        if not seg_file.exists() or seg_file.stat().st_size < 500:
            continue

        try:
            with open(seg_path, "rb") as f:
                audio_bytes = f.read()
            result = await sarvam_transcribe(audio_bytes, language_code="unknown")
            t_text = result.get("transcript", "")
            if t_text.strip():
                text_parts.append(t_text)

            timestamps = result.get("timestamps", [])
            if timestamps:
                for ts in timestamps:
                    ts["start"] = float(ts.get("start", 0)) + t_start
                    ts["end"] = float(ts.get("end", 0)) + t_start
                    all_segs.append(ts)
            elif t_text.strip():
                all_segs.append({"text": t_text, "start": t_start, "end": min(t_start + SEG_DURATION, duration)})
        except Exception as e:
            print(f"[transcribe] segment {i} error: {e}")
        finally:
            seg_file.unlink(missing_ok=True)

    return all_segs, " ".join(text_parts)


# ── YouTube Transcript API helpers ───────────────────────────────────────────

def _extract_video_id(url: str) -> Optional[str]:
    import re
    m = re.search(r'(?:v=|youtu\.be/|embed/)([^&\n?#]+)', url)
    return m.group(1) if m else None


async def _fetch_youtube_transcript(url: str, cookies_path: Optional[str] = None) -> Optional[List[dict]]:
    """Fetch YouTube captions via transcript API without downloading video.

    Returns:
        List[dict]  — transcript chunks (may be empty if no captions exist)
        None        — YouTube is blocking this server's IP (HTTP 429 / rate limited)
    """
    video_id = _extract_video_id(url)
    if not video_id:
        return []

    loop = asyncio.get_event_loop()

    def _sync_fetch() -> Optional[List[dict]]:
        try:
            from youtube_transcript_api import YouTubeTranscriptApi
            try:
                from youtube_transcript_api._errors import (
                    TranscriptsDisabled, NoTranscriptFound, VideoUnavailable,
                )
                _no_captions_types: tuple = (TranscriptsDisabled, NoTranscriptFound, VideoUnavailable)
            except ImportError:
                _no_captions_types = ()

            kwargs: dict = {"languages": ["en", "en-IN", "hi", "hi-IN"]}
            if cookies_path:
                kwargs["cookies"] = cookies_path

            try:
                entries = YouTubeTranscriptApi.get_transcript(video_id, **kwargs)
            except _no_captions_types as e:
                print(f"[transcript-api] no captions for {video_id}: {type(e).__name__}")
                return []  # No captions — caller may try yt-dlp audio
            except Exception as e:
                err_str = str(e).lower()
                if "429" in err_str or "too many" in err_str or "blocked" in err_str:
                    print(f"[transcript-api] rate-limited for {video_id}: {e}")
                    return None  # IP blocked — yt-dlp will fail too, stop now
                print(f"[transcript-api] error for {video_id}: {e}")
                return None  # Unknown failure — don't waste time on yt-dlp

            chunks: List[dict] = []
            buf_words: List[str] = []
            buf_start: Optional[float] = None
            buf_end: float = 0.0
            for entry in entries:
                text = entry.get("text", "").strip()
                # Skip music/sound effect markers
                if not text or text.startswith("[") and text.endswith("]"):
                    continue
                start = float(entry.get("start", 0))
                end = start + float(entry.get("duration", 2))
                if buf_start is None:
                    buf_start = start
                buf_end = end
                buf_words.append(text)
                if sum(len(w.split()) for w in buf_words) >= WORDS_PER_CHUNK:
                    chunks.append({
                        "text": " ".join(buf_words),
                        "start_time": buf_start,
                        "end_time": buf_end,
                    })
                    buf_words, buf_start = [], None
            if buf_words:
                chunks.append({
                    "text": " ".join(buf_words),
                    "start_time": buf_start or 0.0,
                    "end_time": buf_end,
                })
            print(f"[transcript-api] {len(chunks)} chunks for {video_id}")
            return chunks

        except Exception as e:
            print(f"[transcript-api] unexpected error for {video_id}: {e}")
            return None

    return await loop.run_in_executor(None, _sync_fetch)


def _parse_json3_subtitles(path: Path) -> List[dict]:
    """Parse YouTube json3 subtitle file into transcript chunks."""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        buf_words: List[str] = []
        buf_start: Optional[float] = None
        buf_end: float = 0.0
        chunks: List[dict] = []
        for event in data.get("events", []):
            segs = event.get("segs")
            if not segs:
                continue
            start = event.get("tStartMs", 0) / 1000.0
            end   = (event.get("tStartMs", 0) + event.get("dDurationMs", 2000)) / 1000.0
            text  = "".join(s.get("utf8", "") for s in segs).strip()
            if not text or text == "\n":
                continue
            if buf_start is None:
                buf_start = start
            buf_end = end
            buf_words.append(text)
            if sum(len(w.split()) for w in buf_words) >= WORDS_PER_CHUNK:
                chunks.append({"text": " ".join(buf_words), "start_time": buf_start, "end_time": buf_end})
                buf_words, buf_start = [], None
        if buf_words:
            chunks.append({"text": " ".join(buf_words), "start_time": buf_start or 0.0, "end_time": buf_end})
        return chunks
    except Exception as e:
        print(f"[parse-json3] error: {e}")
        return []


async def _fetch_yt_subtitles(url: str, cookies_path: Optional[str] = None) -> Optional[List[dict]]:
    """Download subtitle file via yt-dlp --skip-download (android_vr API, no video download).

    Returns:
        List[dict]  — subtitle chunks
        []          — yt-dlp succeeded but no subtitles available for this video
        None        — yt-dlp was blocked (429)
    """
    with tempfile.TemporaryDirectory() as tmp:
        cmd = [
            "yt-dlp",
            "--write-auto-subs", "--write-subs",
            "--sub-langs", "en,en-IN,hi,hi-IN",
            "--sub-format", "json3",
            "--skip-download",
            "--no-check-certificates",
            "--no-check-formats",
            "--extractor-args", "youtube:player_client=android_vr,mweb,web",
            "--js-runtimes", "node,deno",
            "--user-agent",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "--add-header", "Accept-Language: en-US,en;q=0.9",
            "--retries", "2",
            "-o", os.path.join(tmp, "%(id)s.%(ext)s"),
            "--no-playlist", "--no-progress",
        ]
        if cookies_path:
            cmd += ["--cookies", cookies_path]
        cmd.append(url)

        result = await _exec(cmd)

        if result.returncode != 0:
            stderr = result.stderr.decode()
            if "429" in stderr or "too many requests" in stderr.lower():
                print("[yt-dlp-subs] 429 — blocked")
                return None
            print(f"[yt-dlp-subs] failed: {stderr[:200]}")
            return []

        for f in sorted(Path(tmp).glob("*.json3")):
            chunks = _parse_json3_subtitles(f)
            if chunks:
                print(f"[yt-dlp-subs] {len(chunks)} chunks from {f.name}")
                return chunks

        print("[yt-dlp-subs] ran OK but no json3 subtitle files found")
        return []


# ── Routes ────────────────────────────────────────────────────────────────────

@app.post("/api/load-video")
async def load_video(req: LoadVideoRequest):
    url = req.video_url.strip()
    if not url:
        raise HTTPException(400, "video_url is required")
    vid_id = make_video_id(url)

    async def stream():
        try:
            # ── Cache hit ──────────────────────────────────────────────────
            if store.video_exists(vid_id):
                yield _sse({"type": "cached", "video_id": vid_id, "chunks": store.get_chunks(vid_id)})
                yield "data: [DONE]\n\n"
                return

            # ── Get cookies once — passed to both transcript API and yt-dlp
            cookies_path = _get_cookies_path()
            try:
                # ── 1. YouTube Transcript API (fast, no subprocess overhead) ──
                yield _sse({"type": "status", "message": "📄 Fetching transcript..."})
                t_result = await _fetch_youtube_transcript(url, cookies_path)

                if t_result:
                    for chunk in t_result:
                        yield _sse({"type": "chunk", "chunk": chunk})
                    try:
                        store.save_video(vid_id, url)
                        store.save_chunks(vid_id, t_result)
                    except Exception as e:
                        print(f"[save] error: {e}")
                    yield _sse({"type": "done", "video_id": vid_id})
                    yield "data: [DONE]\n\n"
                    return

                # ── 2. yt-dlp subtitle download (android_vr API — different path ──
                # transcript-api uses the YouTube web page (gets 429 from datacenter IPs);
                # yt-dlp uses the Android mobile API which bypasses that block.
                yield _sse({"type": "status", "message": "📥 Fetching subtitles..."})
                sub_result = await _fetch_yt_subtitles(url, cookies_path)

                if sub_result is None:
                    # Both methods got blocked — nothing left to try
                    hint = "" if cookies_path else " Set YOUTUBE_COOKIES in Railway env vars to fix this."
                    yield _sse({"type": "error", "message": f"429: YouTube is blocking this server.{hint}"})
                    yield "data: [DONE]\n\n"
                    return

                if sub_result:
                    for chunk in sub_result:
                        yield _sse({"type": "chunk", "chunk": chunk})
                    try:
                        store.save_video(vid_id, url)
                        store.save_chunks(vid_id, sub_result)
                    except Exception as e:
                        print(f"[save] error: {e}")
                    yield _sse({"type": "done", "video_id": vid_id})
                    yield "data: [DONE]\n\n"
                    return

                # ── 3. yt-dlp full audio download + Sarvam STT ───────────────
                # Reached only for videos that have absolutely no captions/subtitles.
                yield _sse({"type": "status", "message": "⬇️ No captions — downloading audio..."})

                all_chunks: List[dict] = []

                with tempfile.TemporaryDirectory() as tmp:
                    audio_path = os.path.join(tmp, "audio.wav")
                    try:
                        duration = await _download_yt_audio(url, audio_path, cookies_path)
                    except Exception as e:
                        msg = e.detail if isinstance(e, HTTPException) else str(e)
                        yield _sse({"type": "error", "message": msg[:400]})
                        yield "data: [DONE]\n\n"
                        return

                    if not Path(audio_path).exists():
                        yield _sse({"type": "error", "message": "Audio extraction produced no file"})
                        yield "data: [DONE]\n\n"
                        return

                    # Split ALL segments in one ffmpeg call (faster than N separate calls)
                    yield _sse({"type": "status", "message": "✂️ Splitting audio..."})
                    seg_pattern = os.path.join(tmp, "seg%03d.wav")
                    await _exec([
                        FFMPEG_BIN, "-y", "-i", audio_path,
                        "-f", "segment", "-segment_time", str(SEG_DURATION),
                        "-reset_timestamps", "1", "-ar", "16000", "-ac", "1",
                        seg_pattern, "-loglevel", "quiet",
                    ])

                    segs: List[tuple] = []
                    idx = 0
                    while True:
                        sp = os.path.join(tmp, f"seg{idx:03d}.wav")
                        if not Path(sp).exists():
                            break
                        t_start = idx * SEG_DURATION
                        t_end   = min(t_start + SEG_DURATION, duration)
                        if Path(sp).stat().st_size > 500:
                            segs.append((idx, t_start, t_end, sp))
                        idx += 1

                    if not segs:
                        yield _sse({"type": "error", "message": "Audio splitting produced no segments."})
                        yield "data: [DONE]\n\n"
                        return

                    num_segs = len(segs)
                    sarvam_sem = asyncio.Semaphore(2)

                    async def transcribe_seg(i, t_start, t_end, seg_path):
                        async with sarvam_sem:
                            try:
                                with open(seg_path, "rb") as f:
                                    audio_bytes = f.read()
                                result = await sarvam_transcribe(audio_bytes, language_code="unknown")
                                t_text = result.get("transcript", "")
                                if t_text.strip():
                                    timestamps = result.get("timestamps", [])
                                    if timestamps:
                                        normalized = [
                                            {
                                                "text": ts.get("text", ts.get("word", "")),
                                                "start": float(ts.get("start", 0)) + t_start,
                                                "end": float(ts.get("end", 0)) + t_start,
                                            }
                                            for ts in timestamps
                                        ]
                                        return _segments_to_chunks(normalized)
                                    return _seg_to_chunks(t_text, t_start, t_end)
                            except Exception as e:
                                print(f"[transcribe] seg {i}: {e}")
                            finally:
                                Path(seg_path).unlink(missing_ok=True)
                            return []

                    tasks = [asyncio.create_task(transcribe_seg(*seg)) for seg in segs]

                    for i, task in enumerate(tasks):
                        yield _sse({"type": "status", "message": f"🎙️ Transcribing part {i + 1} of {num_segs}..."})
                        try:
                            seg_chunks = await task
                            for chunk in seg_chunks:
                                all_chunks.append(chunk)
                                yield _sse({"type": "chunk", "chunk": chunk})
                        except Exception as e:
                            print(f"[stream] task {i} error: {e}")

                # ── Save + done ────────────────────────────────────────────
                if not all_chunks:
                    yield _sse({"type": "error", "message": "Transcription returned empty result. The video may have no speech, or the transcription service may be temporarily unavailable."})
                    yield "data: [DONE]\n\n"
                    return

                try:
                    store.save_video(vid_id, url)
                    store.save_chunks(vid_id, all_chunks)
                except Exception as e:
                    print(f"[save] error: {e}")

                yield _sse({"type": "done", "video_id": vid_id})
                yield "data: [DONE]\n\n"

            finally:
                if cookies_path:
                    Path(cookies_path).unlink(missing_ok=True)

        except Exception as e:
            # Safety net — prevents unhandled exceptions from killing the SSE stream silently
            print(f"[stream] unhandled error: {type(e).__name__}: {e}")
            try:
                yield _sse({"type": "error", "message": f"Server error: {type(e).__name__}: {str(e)[:200]}"})
                yield "data: [DONE]\n\n"
            except Exception:
                pass

    return StreamingResponse(stream(), media_type="text/event-stream")


@app.post("/api/ask")
async def ask_question(req: AskRequest):
    if not store.video_exists(req.video_id):
        raise HTTPException(404, "Video not found. Load the video first.")

    chunks = store.search_chunks(req.video_id, req.question, top_k=3)
    if not chunks:
        chunks = store.get_chunks(req.video_id)[:3]

    resp_lang = req.language if req.answer_language == "auto" else req.answer_language

    async def sse():
        async for token in answer_question_stream(req.question, chunks, resp_lang, req.class_level):
            yield f"data: {json.dumps({'text': token})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(sse(), media_type="text/event-stream")


@app.post("/api/transcribe-question")
async def transcribe_question_route(audio: UploadFile = File(...)):
    raw = await audio.read()
    filename = audio.filename or "question.webm"

    # Convert browser audio (webm/ogg) to WAV before sending to Sarvam
    suffix = Path(filename).suffix or ".webm"
    try:
        wav_bytes = await _convert_to_wav(raw, suffix=suffix)
    except Exception:
        wav_bytes = raw  # fall back to raw — Sarvam may still accept it

    try:
        result = await sarvam_transcribe_question(wav_bytes)
        transcript = result.get("transcript", "").strip()
        lang_code = result.get("language_code", "en-IN")
        language = "hi" if "hi" in lang_code.lower() else "en"
        return {"question_text": transcript, "detected_language": language}
    except Exception as e:
        raise HTTPException(500, f"STT failed: {e}")


@app.post("/api/speak-answer")
async def speak_answer(req: SpeakRequest):
    if not req.text.strip():
        raise HTTPException(400, "text is required")
    try:
        audio_b64 = await synthesize_speech(req.text, req.language, req.voice)
        if not audio_b64:
            return {"audio_base64": None}
        return {"audio_base64": audio_b64}
    except Exception as e:
        print(f"[TTS] failed: {e}")
        return {"audio_base64": None}  # degrade gracefully — text answer still works


@app.post("/api/fun-facts")
async def fun_facts_route(req: FunFactsRequest):
    if not store.video_exists(req.video_id):
        raise HTTPException(404, "Video not found.")
    chunks = store.get_chunks(req.video_id)
    if not chunks:
        return {"facts": []}
    try:
        facts = await generate_fun_facts(chunks)
        return {"facts": facts}
    except Exception as e:
        print(f"[fun-facts] {e}")
        return {"facts": []}   # non-critical — silent failure


@app.post("/api/lesson-pack")
async def lesson_pack(req: LessonPackRequest):
    if not store.video_exists(req.video_id):
        raise HTTPException(404, "Video not found. Load the video first.")
    chunks = store.get_chunks(req.video_id)
    if not chunks:
        raise HTTPException(400, "No transcript available.")
    try:
        result = await generate_lesson_pack(chunks, req.language)
        return result
    except Exception as e:
        raise HTTPException(500, f"Lesson pack generation failed: {e}")


@app.post("/api/translate")
async def translate(req: TranslateRequest):
    if not req.text.strip():
        raise HTTPException(400, "text is required")
    try:
        translation = await translate_transcript(req.text, req.target_language, req.style)
        return {"translation": translation}
    except Exception as e:
        raise HTTPException(500, f"Translation failed: {e}")


@app.post("/api/chapters")
async def chapters(req: ChaptersRequest):
    if not store.video_exists(req.video_id):
        raise HTTPException(404, "Video not found.")
    chunks = store.get_chunks(req.video_id)
    if not chunks:
        raise HTTPException(400, "No transcript available.")
    try:
        result = await generate_chapters(chunks)
        return {"chapters": result}
    except Exception as e:
        raise HTTPException(500, f"Chapter generation failed: {e}")


@app.post("/api/quiz")
async def quiz(req: QuizRequest):
    if not store.video_exists(req.video_id):
        raise HTTPException(404, "Video not found. Load the video first.")
    chunks = store.get_chunks(req.video_id)
    if not chunks:
        raise HTTPException(400, "No transcript available for this video.")
    try:
        questions = await generate_quiz(chunks, req.language)
        return {"questions": questions}
    except Exception as e:
        raise HTTPException(500, f"Quiz generation failed: {e}")


@app.get("/health")
async def health():
    return {"status": "ok", "service": "AI Office Hours API"}


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)  # pass object, not string, to avoid re-import
