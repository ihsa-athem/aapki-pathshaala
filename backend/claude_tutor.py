import json
import os
import re
from typing import List, AsyncIterator

import anthropic

_client: anthropic.AsyncAnthropic | None = None

# Primary model: safe default that works on every Anthropic API key.
# Override by setting CLAUDE_MODEL in Railway env vars if you want a newer model.
_PRIMARY = os.getenv("CLAUDE_MODEL", "claude-3-5-sonnet-20241022")
# Fallback tried automatically if the primary model returns a model-not-found error.
_FALLBACK = "claude-3-5-sonnet-20241022"


def _get_client() -> anthropic.AsyncAnthropic:
    global _client
    if _client is None:
        key = os.getenv("ANTHROPIC_API_KEY", "").strip()
        if not key:
            raise RuntimeError("ANTHROPIC_API_KEY is not set in environment variables.")
        _client = anthropic.AsyncAnthropic(api_key=key)
    return _client


def _is_model_error(e: Exception) -> bool:
    """True when the error is 'model not found / not accessible' — safe to retry."""
    s = str(e).lower()
    return ("not_found" in s or "model" in s) and "404" in s


async def _create(system: str, user: str, max_tokens: int) -> str:
    """Non-streaming Claude call with automatic model fallback."""
    client = _get_client()
    models = list(dict.fromkeys([_PRIMARY, _FALLBACK]))  # deduplicated, primary first
    last_err: Exception | None = None
    for model in models:
        try:
            resp = await client.messages.create(
                model=model,
                max_tokens=max_tokens,
                system=system,
                messages=[{"role": "user", "content": user}],
            )
            return resp.content[0].text.strip()
        except Exception as e:
            if _is_model_error(e):
                print(f"[claude] model {model} not available, trying fallback: {e}")
                last_err = e
                continue
            raise
    raise last_err or RuntimeError("No Claude model could be reached.")


SYSTEM_PROMPT = """\
You are a warm, encouraging school tutor for Indian students. \
You have video transcript excerpts with timestamps to answer questions from.

LANGUAGE RULES — follow these strictly:
- Match the student's language exactly and consistently
- Hindi question → answer in Hindi (Devanagari)
- English question → answer in English
- Mixed/Hinglish → answer in Hinglish (this is totally fine and natural for Indian students!)
- NEVER switch language mid-answer or between answers without reason
- Younger classes (4–7): friendly Hinglish often works best

ANSWER RULES:
1. Answer ONLY from the transcript — no outside knowledge
2. If not covered: say "Yeh video mein nahi bataya gaya 😊 Apne teacher se poochho!" \
   or "This wasn't in the video — ask your teacher!"
3. ALWAYS cite the timestamp: "[2:30–3:15] mein samjhaya gaya hai" or "explained at [2:30]"
4. Be warm like a favourite teacher — encouraging, never scolding
5. Use emojis occasionally ✨🎯 to keep it fun for kids
6. शाबाश, बहुत बढ़िया, Excellent! — celebrate effort genuinely
7. IMPORTANT — NO MARKDOWN: Do not use **, ##, -, *, or any markdown formatting.
   Write in plain flowing sentences only. The answer is read aloud by a text-to-speech
   engine — markdown symbols will be spoken literally as "asterisk", "hashtag" etc.\
"""


def _fmt(seconds: float) -> str:
    m, s = int(seconds // 60), int(seconds % 60)
    return f"{m}:{s:02d}"


def _build_context(chunks: List[dict]) -> str:
    parts = []
    for c in sorted(chunks, key=lambda x: x["start_time"]):
        parts.append(f"[{_fmt(c['start_time'])}–{_fmt(c['end_time'])}]\n{c['text']}")
    return "\n\n".join(parts)


# ── Translation ────────────────────────────────────────────────────────────────

def _lang_label(target_language: str, style: str) -> str:
    if target_language == "hi":
        return "Hindi (Devanagari script)"
    if style == "simple":
        return (
            "very simple, easy-to-understand English for primary/middle school students. "
            "Use short sentences, everyday vocabulary, and avoid jargon"
        )
    return "clear standard English"


async def _translate_batch(text: str, target_language: str, style: str) -> str:
    label = _lang_label(target_language, style)
    return await _create(
        system=(
            f"You are a translator. Translate the given transcript to {label}. "
            "Preserve every [mm:ss] timestamp marker exactly as it appears — "
            "do not translate, move, or remove them. Only translate the text between markers. "
            "Keep the same paragraph/newline structure."
        ),
        user=f"Translate to {label}:\n\n{text}",
        max_tokens=8192,
    )


async def translate_transcript(text: str, target_language: str = "en", style: str = "standard") -> str:
    """Translate a timestamped transcript. Batches long transcripts automatically."""
    paragraphs = [p for p in text.split('\n\n') if p.strip()]
    BATCH = 20  # ~4 000 words — well within 8 192 output tokens
    if len(paragraphs) <= BATCH:
        return await _translate_batch(text, target_language, style)
    parts = []
    for i in range(0, len(paragraphs), BATCH):
        chunk = '\n\n'.join(paragraphs[i:i + BATCH])
        parts.append(await _translate_batch(chunk, target_language, style))
    return '\n\n'.join(parts)


# ── Fun facts ──────────────────────────────────────────────────────────────────

async def generate_fun_facts(chunks: List[dict]) -> List[str]:
    context = _build_context(chunks[:6])
    raw = await _create(
        system=(
            "Generate exactly 3 fun, surprising facts for school students about the topic in the text. "
            "Return ONLY a JSON array: [\"fact1\", \"fact2\", \"fact3\"]. "
            "Each fact must be under 70 words. Make them genuinely interesting and wow-worthy. "
            "No markdown, no extra text."
        ),
        user=f"Generate 3 fun facts from this content:\n\n{context}",
        max_tokens=400,
    )
    raw = re.sub(r"^```(?:json)?\s*", "", raw)
    raw = re.sub(r"\s*```$", "", raw)
    result = json.loads(raw)
    return result if isinstance(result, list) else []


# ── Lesson pack ────────────────────────────────────────────────────────────────

LESSON_PACK_SYSTEM = """\
You are an educational content designer creating classroom materials for a teacher in India.
Based on the video transcript, generate a complete lesson pack.

Return ONLY valid JSON — no markdown fences, no commentary:
{
  "title": "concise video title inferred from content",
  "lesson_plan": {
    "grade_level": "e.g. Class 9-10",
    "learning_objectives": ["verb-led objective...", "..."],
    "key_concepts": ["concept1", "concept2"],
    "discussion_questions": ["open-ended question...", "..."]
  },
  "quiz_bank": [
    {
      "question": "...",
      "options": {"A": "...", "B": "...", "C": "...", "D": "..."},
      "correct": "B",
      "explanation": "cite the relevant part of the video..."
    }
  ],
  "vocabulary": [
    {"word": "...", "definition_en": "...", "definition_hi": "..."}
  ],
  "summary": "~150 word summary a teacher reads before showing the video"
}

Rules:
- Exactly 10 MCQs — include application and analysis questions, not just recall
- 8-10 vocabulary items — domain-specific or challenging words only
- Summary: approximately 150 words, factual and class-ready
- Learning objectives: 3-5, starting with Bloom's-taxonomy action verbs
- Discussion questions: 3-5, open-ended, encouraging critical thinking
- Hindi definitions should be simple and accurate\
"""


async def generate_lesson_pack(chunks: List[dict], language: str = "en") -> dict:
    context = _build_context(chunks)
    raw = await _create(
        system=LESSON_PACK_SYSTEM,
        user=f"Generate a complete lesson pack for this transcript:\n\n{context}",
        max_tokens=4096,
    )
    raw = re.sub(r"^```(?:json)?\s*", "", raw)
    raw = re.sub(r"\s*```$", "", raw)
    return json.loads(raw)


# ── Chapters ───────────────────────────────────────────────────────────────────

CHAPTERS_SYSTEM = """\
You analyze a video transcript to identify 4-6 logical chapter/topic breaks.

Return ONLY valid JSON — no markdown fences, no extra text:
[
  {"title": "Introduction", "start_time": 0.0, "timestamp": "0:00"},
  {"title": "Topic Name",   "start_time": 45.0, "timestamp": "0:45"}
]

Rules:
- 4 to 6 chapters maximum; don't create chapters for sections under 30 seconds
- Titles: 2-4 words, descriptive, match the language of the transcript
- start_time must be a real number of seconds, matching a timestamp in the content
- Order chronologically; first chapter always starts at 0\
"""


async def generate_chapters(chunks: List[dict]) -> List[dict]:
    context = _build_context(chunks)
    raw = await _create(
        system=CHAPTERS_SYSTEM,
        user=f"Generate chapter markers:\n\n{context}",
        max_tokens=512,
    )
    raw = re.sub(r"^```(?:json)?\s*", "", raw)
    raw = re.sub(r"\s*```$", "", raw)
    return json.loads(raw)


# ── Quiz ───────────────────────────────────────────────────────────────────────

QUIZ_SYSTEM = """\
You are a quiz generator for educational video content.
Generate exactly 5 multiple-choice questions that test understanding of the key concepts.

Return ONLY valid JSON — no markdown fences, no extra text, no commentary. \
Use this exact structure:
[
  {
    "question": "...",
    "options": {"A": "...", "B": "...", "C": "...", "D": "..."},
    "correct": "B",
    "explanation": "...",
    "timestamp": "2:30"
  }
]

Rules:
- Questions must be answerable from the transcript only — no outside knowledge.
- All four options must be plausible; only one is correct.
- explanation should cite where in the video the answer appears (1–2 sentences).
- timestamp should be the mm:ss closest to where the answer appears.
- Wrong options must be distinct, not trivially dismissible.
- If instructed to use Hindi, write question, options, and explanation fully in Hindi (Devanagari script).\
"""


async def generate_quiz(chunks: List[dict], language: str = "en") -> List[dict]:
    context = _build_context(chunks)
    lang_note = (
        "Generate all questions, options, and explanations in Hindi (Devanagari script)."
        if language == "hi"
        else "Generate in English."
    )
    raw = await _create(
        system=QUIZ_SYSTEM,
        user=f"{lang_note}\n\nTranscript:\n{context}",
        max_tokens=2048,
    )
    raw = re.sub(r"^```(?:json)?\s*", "", raw)
    raw = re.sub(r"\s*```$", "", raw)
    return json.loads(raw)


# ── Q&A streaming ──────────────────────────────────────────────────────────────

_CLASS_INFO = {
    4:  (9,  "CLASS 4 STUDENT (age ~9). STRICT RULES:\n- Use ONLY very simple everyday words\n- MAX 2-3 short sentences\n- Compare to things kids love: cricket, cartoons, food"),
    5:  (10, "CLASS 5 STUDENT (age ~10). STRICT RULES:\n- Simple friendly language\n- MAX 3-4 sentences\n- No jargon; explain any term immediately"),
    6:  (11, "CLASS 6 STUDENT (age ~11). STRICT RULES:\n- Clear simple language; introduce subject terms with explanation\n- MAX 4-5 sentences"),
    7:  (12, "CLASS 7 STUDENT (age ~12).\n- Friendly academic language; technical terms OK with brief explanation\n- 4-6 sentences"),
    8:  (13, "CLASS 8 STUDENT (age ~13).\n- Clear academic language; multi-step reasoning is fine\n- 5-7 sentences"),
    9:  (14, "CLASS 9 STUDENT (age ~14).\n- Standard academic language; board-exam relevant depth\n- 5-8 sentences"),
    10: (15, "CLASS 10 STUDENT (age ~15).\n- Full academic language; board-level depth and detail\n- Up to 8-10 sentences if the topic warrants it"),
}


async def answer_question_stream(
    question: str,
    chunks: List[dict],
    language: str = "en",
    class_level: int = 7,
) -> AsyncIterator[str]:
    client = _get_client()
    context = _build_context(chunks)
    _, class_instruction = _CLASS_INFO.get(class_level, _CLASS_INFO[7])
    lang_directive = (
        "Respond in Hindi (Devanagari)." if language == "hi"
        else "Respond in English. Hinglish is fine if the student mixed languages."
    )
    full_system = f"{class_instruction}\n\nLANGUAGE: {lang_directive}\n\n{SYSTEM_PROMPT}"
    user_msg = f"Transcript excerpts:\n\n{context}\n\nStudent question: {question}"

    models = list(dict.fromkeys([_PRIMARY, _FALLBACK]))
    last_err: Exception | None = None
    for model in models:
        yielded = False
        try:
            async with client.messages.stream(
                model=model,
                max_tokens=1024,
                system=full_system,
                messages=[{"role": "user", "content": user_msg}],
            ) as stream:
                async for text in stream.text_stream:
                    yielded = True
                    yield text
            return
        except Exception as e:
            if not yielded and _is_model_error(e):
                print(f"[claude] stream model {model} not available, trying fallback")
                last_err = e
                continue
            raise
    if last_err:
        raise last_err
