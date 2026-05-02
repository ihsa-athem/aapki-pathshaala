// In dev (no VITE_API_URL set), fall back to '' so requests go to /api/...
// and Vite's dev-server proxy forwards them to the backend — no CORS needed.
// In production, set VITE_API_URL to the deployed backend URL.
const API = import.meta.env.VITE_API_URL || ''

export async function loadVideo(videoUrl, { onStatus, onChunk, onCached, onDone, onError } = {}) {
  let res
  try {
    res = await fetch(`${API}/api/load-video`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ video_url: videoUrl }),
    })
  } catch (err) {
    onError?.(err); return
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    onError?.(new Error(err.detail || 'Failed to load video')); return
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const data = line.slice(6).trim()
      if (data === '[DONE]') return
      try {
        const ev = JSON.parse(data)
        if (ev.type === 'status') onStatus?.(ev.message)
        else if (ev.type === 'chunk')  onChunk?.(ev.chunk)
        else if (ev.type === 'cached') onCached?.(ev.video_id, ev.chunks)
        else if (ev.type === 'done')   onDone?.(ev.video_id)
        else if (ev.type === 'error')  onError?.(new Error(ev.message))
      } catch {}
    }
  }
}

export async function askQuestion(question, videoId, language, { answerLanguage = 'auto', classLevel = 7 } = {}) {
  const res = await fetch(`${API}/api/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      question, video_id: videoId, language,
      answer_language: answerLanguage,
      class_level: classLevel,
    }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || 'Failed to get answer')
  }
  return res // Return raw response for streaming
}

export async function transcribeQuestion(audioBlob) {
  const form = new FormData()
  form.append('audio', audioBlob, 'question.webm')
  const res = await fetch(`${API}/api/transcribe-question`, { method: 'POST', body: form })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || 'Transcription failed')
  }
  return res.json()
}

export async function translateTranscript(text, targetLanguage = 'en', style = 'standard') {
  const res = await fetch(`${API}/api/translate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, target_language: targetLanguage, style }),
  })
  if (!res.ok) throw new Error('Translation failed')
  return res.json()
}

export async function generateFunFacts(videoId) {
  const res = await fetch(`${API}/api/fun-facts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ video_id: videoId }),
  })
  if (!res.ok) return { facts: [] }
  return res.json()
}

export async function generateChapters(videoId) {
  const res = await fetch(`${API}/api/chapters`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ video_id: videoId }),
  })
  if (!res.ok) return { chapters: [] }
  return res.json()
}

export async function generateQuiz(videoId, language) {
  const res = await fetch(`${API}/api/quiz`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ video_id: videoId, language }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || 'Quiz generation failed')
  }
  return res.json()
}

export async function generateLessonPack(videoId, language = 'en') {
  const res = await fetch(`${API}/api/lesson-pack`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ video_id: videoId, language }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || 'Lesson pack generation failed')
  }
  return res.json()
}

export async function speakAnswer(text, language, voice = 'meera') {
  const res = await fetch(`${API}/api/speak-answer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, language, voice }),
  })
  if (!res.ok) return { audio_base64: null }
  return res.json()
}
