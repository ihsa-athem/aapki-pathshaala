import asyncio
import base64
import io
import os
import wave
from typing import List

from sarvamai import SarvamAI

SARVAM_API_KEY = os.getenv("SARVAM_API_KEY", "")
MAX_TTS_CHARS = 500


def _get_client() -> SarvamAI:
    return SarvamAI(api_subscription_key=SARVAM_API_KEY, timeout=180.0)


# ── STT helpers ───────────────────────────────────────────────────────────────

def _timestamps_to_segments(ts) -> List[dict]:
    """Convert Sarvam's parallel-array timestamps into [{text, start, end}] segments."""
    if ts is None:
        return []
    words  = ts.words or []
    starts = ts.start_time_seconds or []
    ends   = ts.end_time_seconds or []
    return [{"text": w, "start": s, "end": e} for w, s, e in zip(words, starts, ends)]


def _transcribe_sync(audio_bytes: bytes, filename: str, language_code: str) -> dict:
    client = _get_client()
    try:
        resp = client.speech_to_text.transcribe(
            file=(filename, audio_bytes, "audio/wav"),
            model="saaras:v3",
            mode="transcribe",
            language_code=language_code,
        )
        return {
            "transcript": resp.transcript,
            "timestamps": _timestamps_to_segments(resp.timestamps),
            "language_code": resp.language_code or "en-IN",
        }
    except Exception as e:
        err = str(e).lower()
        if "429" in err or "rate" in err or "quota" in err or "limit" in err or "exceeded" in err:
            print(f"[sarvam-stt] rate limit hit: {e}")
            return {"transcript": "", "timestamps": [], "language_code": "en-IN"}
        raise


async def transcribe_audio(
    audio_bytes: bytes,
    language_code: str = "unknown",
    filename: str = "audio.wav",
) -> dict:
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _transcribe_sync, audio_bytes, filename, language_code)


async def transcribe_question(audio_bytes: bytes, filename: str = "question.wav") -> dict:
    """Transcribe a student's voice question; auto-detects Hindi vs English."""
    return await transcribe_audio(audio_bytes, language_code="unknown", filename=filename)


# ── TTS helpers ───────────────────────────────────────────────────────────────

def _combine_wav_b64(audios: List[str]) -> str:
    """Concatenate multiple base64-encoded WAV chunks into one seamless WAV."""
    if not audios:
        return ""
    if len(audios) == 1:
        return audios[0]

    all_frames: List[bytes] = []
    params = None

    for b64 in audios:
        try:
            raw = base64.b64decode(b64)
            with wave.open(io.BytesIO(raw), "rb") as w:
                if params is None:
                    params = w.getparams()
                all_frames.append(w.readframes(w.getnframes()))
        except Exception:
            continue  # skip malformed chunk rather than failing everything

    if not all_frames or params is None:
        return audios[0]  # fallback: first chunk

    out = io.BytesIO()
    with wave.open(out, "wb") as w:
        w.setparams(params)
        for frames in all_frames:
            w.writeframes(frames)

    return base64.b64encode(out.getvalue()).decode()


def _tts_sync(text: str, language: str, voice: str = "manisha") -> str:
    lang_code = "hi-IN" if language == "hi" else "en-IN"
    client    = _get_client()

    # Split into ≤500-char pieces (Sarvam per-input limit)
    pieces = [text[i : i + MAX_TTS_CHARS] for i in range(0, len(text), MAX_TTS_CHARS)]

    all_audios: List[str] = []
    for piece in pieces:
        if not piece.strip():
            continue
        try:
            resp = client.text_to_speech.convert(
                text=piece,
                target_language_code=lang_code,
                speaker=voice,
                pitch=0,
                pace=1.0,
                loudness=1.5,
                speech_sample_rate=8000,
                enable_preprocessing=True,
                model="bulbul:v2",
            )
            if resp.audios:
                all_audios.extend(resp.audios)
        except Exception as e:
            print(f"[TTS] chunk failed: {e}")

    return _combine_wav_b64(all_audios)


async def synthesize_speech(text: str, language: str = "en", voice: str = "manisha") -> str:
    """Return base64-encoded WAV audio (full answer, all chunks joined)."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _tts_sync, text, language, voice)
