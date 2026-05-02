import json
import os
import re
from typing import List, AsyncIterator

import anthropic

_client: anthropic.AsyncAnthropic | None = None


def _get_client() -> anthropic.AsyncAnthropic:
    global _client
    if _client is None:
        _client = anthropic.AsyncAnthropic(api_key=os.getenv("ANTHROPIC_API_KEY", ""))
    return _client


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


async def translate_transcript(text: str, target_language: str = "en", style: str = "standard") -> str:
    """Translate a timestamped transcript, preserving [mm:ss] markers."""
    client = _get_client()
    if target_language == "hi":
        lang_label = "Hindi (Devanagari script)"
    elif style == "simple":
        lang_label = (
            "very simple, easy-to-understand English for primary/middle school students. "
            "Use short sentences, everyday vocabulary, and avoid jargon"
        )
    else:
        lang_label = "clear standard English"
    resp = await client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=4096,
        system=(
            f"You are a translator. Translate the given transcript to {lang_label}. "
            "Preserve every [mm:ss] timestamp marker exactly as it appears — "
            "do not translate, move, or remove them. Only translate the text between markers. "
            "Keep the same paragraph/newline structure."
        ),
        messages=[{"role": "user", "content": f"Translate to {lang_label}:\n\n{text}"}],
    )
    return resp.content[0].text.strip()


async def generate_fun_facts(chunks: List[dict]) -> List[str]:
    """Generate 3 fun facts about the video topic for display during translation loading."""
    client = _get_client()
    # Only need a few chunks to understand the topic
    context = _build_context(chunks[:6])
    resp = await client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=400,
        system=(
            "Generate exactly 3 fun, surprising facts for school students about the topic in the text. "
            "Return ONLY a JSON array: [\"fact1\", \"fact2\", \"fact3\"]. "
            "Each fact must be under 70 words. Make them genuinely interesting and wow-worthy. "
            "No markdown, no extra text."
        ),
        messages=[{"role": "user", "content": f"Generate 3 fun facts from this content:\n\n{context}"}],
    )
    raw = resp.content[0].text.strip()
    raw = re.sub(r"^```(?:json)?\s*", "", raw)
    raw = re.sub(r"\s*```$", "", raw)
    result = json.loads(raw)
    return result if isinstance(result, list) else []


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
    client = _get_client()
    context = _build_context(chunks)
    resp = await client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=4096,
        system=LESSON_PACK_SYSTEM,
        messages=[{"role": "user", "content": f"Generate a complete lesson pack for this transcript:\n\n{context}"}],
    )
    raw = resp.content[0].text.strip()
    raw = re.sub(r"^```(?:json)?\s*", "", raw)
    raw = re.sub(r"\s*```$", "", raw)
    return json.loads(raw)


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
    client = _get_client()
    context = _build_context(chunks)
    resp = await client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=512,
        system=CHAPTERS_SYSTEM,
        messages=[{"role": "user", "content": f"Generate chapter markers:\n\n{context}"}],
    )
    raw = resp.content[0].text.strip()
    raw = re.sub(r"^```(?:json)?\s*", "", raw)
    raw = re.sub(r"\s*```$", "", raw)
    return json.loads(raw)


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
    client = _get_client()
    context = _build_context(chunks)
    lang_note = (
        "Generate all questions, options, and explanations in Hindi (Devanagari script)."
        if language == "hi"
        else "Generate in English."
    )
    user_msg = f"{lang_note}\n\nTranscript:\n{context}"

    resp = await client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=2048,
        system=QUIZ_SYSTEM,
        messages=[{"role": "user", "content": user_msg}],
    )
    raw = resp.content[0].text.strip()
    # Strip markdown code fences if Claude wraps the JSON
    raw = re.sub(r"^```(?:json)?\s*", "", raw)
    raw = re.sub(r"\s*```$", "", raw)
    return json.loads(raw)


# Concrete per-class instructions that Claude must follow — placed FIRST in the system prompt
# so they take priority over the general rules.
_CLASS_INFO = {
    4:  (9,  """\
CLASS 4 STUDENT (age ~9). STRICT RULES:
- Use ONLY very simple everyday words — no science/technical terms at all
- MAX 2-3 short sentences in the whole answer
- Explain like talking to a curious younger sibling
- Compare everything to things kids love: cricket, cartoons, food, school friends
- Example style: "Bilkul simple baat hai! Paani upar jaata hai kyunki suraj use garam karta hai, \
jaise tawa pe roti phulti hai! ☀️ [1:20] pe dikha hai yeh."\
"""),
    5:  (10, """\
CLASS 5 STUDENT (age ~10). STRICT RULES:
- Simple friendly language — like a cool older didi/bhaiya explaining
- MAX 3-4 sentences
- No jargon; if you must use one term, explain it immediately in simple words
- Use relatable comparisons (toys, games, school, family)\
"""),
    6:  (11, """\
CLASS 6 STUDENT (age ~11). STRICT RULES:
- Clear simple language; can introduce subject terms IF explained right away
- MAX 4-5 sentences
- Conversational and encouraging tone\
"""),
    7:  (12, """\
CLASS 7 STUDENT (age ~12).
- Friendly academic language; technical terms OK with brief explanation
- 4-6 sentences\
"""),
    8:  (13, """\
CLASS 8 STUDENT (age ~13).
- Clear academic language; multi-step reasoning is fine
- 5-7 sentences\
"""),
    9:  (14, """\
CLASS 9 STUDENT (age ~14).
- Standard academic language; board-exam relevant depth
- 5-8 sentences\
"""),
    10: (15, """\
CLASS 10 STUDENT (age ~15).
- Full academic language; board-level depth and detail
- Up to 8-10 sentences if the topic warrants it\
"""),
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

    # Class instruction goes FIRST — highest priority for Claude
    lang_directive = (
        "Respond in Hindi (Devanagari)." if language == "hi"
        else "Respond in English. Hinglish is fine if the student mixed languages."
    )
    full_system = f"{class_instruction}\n\nLANGUAGE: {lang_directive}\n\n{SYSTEM_PROMPT}"

    user_msg = f"Transcript excerpts:\n\n{context}\n\nStudent question: {question}"

    async with client.messages.stream(
        model="claude-sonnet-4-6",
        max_tokens=1024,
        system=full_system,
        messages=[{"role": "user", "content": user_msg}],
    ) as stream:
        async for text in stream.text_stream:
            yield text
