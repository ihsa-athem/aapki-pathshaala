import asyncio
import os
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
    words = ts.words or []
    starts = ts.start_time_seconds or []
    ends = ts.end_time_seconds or []
    return [
        {"text": w, "start": s, "end": e}
        for w, s, e in zip(words, starts, ends)
    ]


def _transcribe_sync(audio_bytes: bytes, filename: str, language_code: str) -> dict:
    client = _get_client()
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


async def transcribe_audio(
    audio_bytes: bytes,
    language_code: str = "unknown",
    filename: str = "audio.wav",
) -> dict:
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(
        None, _transcribe_sync, audio_bytes, filename, language_code
    )


async def transcribe_question(
    audio_bytes: bytes,
    filename: str = "question.wav",
) -> dict:
    """Transcribe a student's voice question; auto-detects Hindi vs English."""
    return await transcribe_audio(audio_bytes, language_code="unknown", filename=filename)


# ── TTS helper ────────────────────────────────────────────────────────────────

def _tts_sync(text: str, language: str) -> str:
    if language == "hi":
        lang_code, speaker = "hi-IN", "manisha"
    else:
        lang_code, speaker = "en-IN", "abhilash"

    client = _get_client()
    chunks = [text[i : i + MAX_TTS_CHARS] for i in range(0, len(text), MAX_TTS_CHARS)]

    for chunk in chunks:
        resp = client.text_to_speech.convert(
            text=chunk,
            target_language_code=lang_code,
            speaker=speaker,
            pitch=0,
            pace=1.0,
            loudness=1.5,
            speech_sample_rate=8000,
            enable_preprocessing=True,
            model="bulbul:v2",
        )
        if resp.audios:
            return resp.audios[0]  # return first chunk's audio
    return ""


async def synthesize_speech(text: str, language: str = "en") -> str:
    """Return base64-encoded WAV audio from Sarvam TTS."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _tts_sync, text, language)
