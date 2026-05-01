import os
from typing import List, AsyncIterator

import anthropic

_client: anthropic.AsyncAnthropic | None = None


def _get_client() -> anthropic.AsyncAnthropic:
    global _client
    if _client is None:
        _client = anthropic.AsyncAnthropic(api_key=os.getenv("ANTHROPIC_API_KEY", ""))
    return _client


SYSTEM_PROMPT = """\
You are a friendly, patient tutor helping a student understand content from a video lesson. \
You have been given relevant excerpts from the video transcript, each with timestamps.

Rules:
1. Answer ONLY based on the transcript excerpts provided. Do not use outside knowledge.
2. If the answer is not in the transcript, say: \
"I don't see this covered in the video. You might want to ask your teacher."
3. Always cite the timestamp(s) where the relevant content appears, \
e.g., "This was explained around [2:30–3:15] in the video."
4. Speak like a warm, encouraging tutor — not a textbook. Use simple language.
5. If the student's question is in Hindi, answer fully in Hindi (Devanagari script). \
If in English, answer in English.
6. Keep answers concise: 3–5 sentences max, then cite the timestamp.\
"""


def _fmt(seconds: float) -> str:
    m, s = int(seconds // 60), int(seconds % 60)
    return f"{m}:{s:02d}"


def _build_context(chunks: List[dict]) -> str:
    parts = []
    for c in sorted(chunks, key=lambda x: x["start_time"]):
        parts.append(f"[{_fmt(c['start_time'])}–{_fmt(c['end_time'])}]\n{c['text']}")
    return "\n\n".join(parts)


async def answer_question_stream(
    question: str,
    chunks: List[dict],
    language: str = "en",
) -> AsyncIterator[str]:
    client = _get_client()
    context = _build_context(chunks)
    user_msg = f"Here are the relevant transcript excerpts:\n\n{context}\n\nStudent's question: {question}"

    async with client.messages.stream(
        model="claude-sonnet-4-20250514",
        max_tokens=1024,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_msg}],
    ) as stream:
        async for text in stream.text_stream:
            yield text
