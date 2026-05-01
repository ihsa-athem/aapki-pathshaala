import asyncio
import contextlib
import os
import subprocess
import tempfile
import wave
from pathlib import Path
from typing import List, Tuple

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

from claude_tutor import answer_question_stream
from sarvam import synthesize_speech
from sarvam import transcribe_audio as sarvam_transcribe
from sarvam import transcribe_question as sarvam_transcribe_question
from transcript_store import TranscriptStore, make_video_id

app = FastAPI(title="AI Office Hours API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
    ],
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


class SpeakRequest(BaseModel):
    text: str
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


async def _download_yt_audio(url: str, out_path: str) -> float:
    # No --extractor-args: yt-dlp's default android_vr client works without
    # a JS runtime or PO tokens. The "JS runtime" warning is non-fatal —
    # audio formats still extract.
    cmd = [
        "yt-dlp", "-x",
        "--audio-format", "wav",
        "--postprocessor-args", "ffmpeg:-ar 16000 -ac 1",
        "--ffmpeg-location", FFMPEG_BIN,
        "--no-check-formats",
        "-o", out_path,
        "--no-playlist", "--no-progress",
        url,
    ]
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


# ── Routes ────────────────────────────────────────────────────────────────────

@app.post("/api/load-video")
async def load_video(req: LoadVideoRequest):
    url = req.video_url.strip()
    if not url:
        raise HTTPException(400, "video_url is required")

    vid_id = make_video_id(url)
    if store.video_exists(vid_id):
        return {"video_id": vid_id, "chunks": store.get_chunks(vid_id), "cached": True}

    with tempfile.TemporaryDirectory() as tmp:
        audio_path = os.path.join(tmp, "audio.wav")
        duration = await _download_yt_audio(url, audio_path)

        if not Path(audio_path).exists():
            raise HTTPException(500, "Audio extraction produced no file")

        segments, full_text = await _transcribe_full(audio_path, duration)

    if not segments and not full_text.strip():
        raise HTTPException(500, "Transcription returned empty result")

    if segments:
        # Normalize segment shape
        normalized = [
            {"text": s.get("text", s.get("word", "")), "start": s.get("start", 0), "end": s.get("end", 0)}
            for s in segments
        ]
        chunks = _segments_to_chunks(normalized)
    else:
        chunks = _text_to_timed_chunks(full_text, duration)

    store.save_video(vid_id, url)
    store.save_chunks(vid_id, chunks)
    return {"video_id": vid_id, "chunks": chunks, "cached": False}


@app.post("/api/ask")
async def ask_question(req: AskRequest):
    if not store.video_exists(req.video_id):
        raise HTTPException(404, "Video not found. Load the video first.")

    chunks = store.search_chunks(req.video_id, req.question, top_k=3)
    if not chunks:
        chunks = store.get_chunks(req.video_id)[:3]

    async def sse():
        async for token in answer_question_stream(req.question, chunks, req.language):
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
        audio_b64 = await synthesize_speech(req.text, req.language)
        return {"audio_base64": audio_b64}
    except Exception as e:
        raise HTTPException(500, f"TTS failed: {e}")


@app.get("/health")
async def health():
    return {"status": "ok", "service": "AI Office Hours API"}


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
