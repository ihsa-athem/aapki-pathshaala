// In dev (no VITE_API_URL set), fall back to '' so requests go to /api/...
// and Vite's dev-server proxy forwards them to the backend — no CORS needed.
// In production, set VITE_API_URL to the deployed backend URL.
const API = import.meta.env.VITE_API_URL || ''

// Log the API base URL once at startup so it's visible in browser console
console.log('[api] VITE_API_URL =', import.meta.env.VITE_API_URL || '(not set — using Vite proxy)')
console.log('[api] API base =', API || '(relative URL — Vite proxy in dev, Vercel rewrite in prod)')

export async function loadVideo(videoUrl, { onStatus, onChunk, onCached, onDone, onError } = {}) {
  const endpoint = `${API}/api/load-video`
  console.log('[loadVideo] starting — endpoint:', endpoint, '| url:', videoUrl)

  let res
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ video_url: videoUrl }),
    })
  } catch (err) {
    console.error('[loadVideo] fetch threw (network/CORS?):', err)
    onError?.(err)
    return
  }

  console.log('[loadVideo] HTTP response:', res.status, res.statusText,
    '| content-type:', res.headers.get('content-type'))

  if (!res.ok) {
    let detail = res.statusText
    try { detail = (await res.json()).detail || detail } catch {}
    console.error('[loadVideo] non-200 response:', res.status, detail)
    onError?.(new Error(detail || 'Failed to load video'))
    return
  }

  // Confirm we're getting SSE — if we get HTML back VITE_API_URL is probably missing
  const ct = res.headers.get('content-type') || ''
  if (!ct.includes('text/event-stream')) {
    console.error('[loadVideo] Expected SSE but got:', ct,
      '— Is VITE_API_URL set correctly in Vercel env vars?')
    onError?.(new Error(
      `Wrong response type (got "${ct}"). ` +
      'Check that VITE_API_URL is set in your Vercel environment variables.'
    ))
    return
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let eventCount = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      console.log('[loadVideo] stream ended — total events received:', eventCount)
      break
    }
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const data = line.slice(6).trim()
      if (data === '[DONE]') {
        console.log('[loadVideo] [DONE] received after', eventCount, 'events')
        return
      }
      try {
        const ev = JSON.parse(data)
        eventCount++
        if (ev.type === 'status') {
          console.log('[loadVideo] status:', ev.message)
          onStatus?.(ev.message)
        } else if (ev.type === 'chunk') {
          onChunk?.(ev.chunk)
        } else if (ev.type === 'cached') {
          console.log('[loadVideo] cached — video_id:', ev.video_id, '| chunks:', ev.chunks?.length)
          onCached?.(ev.video_id, ev.chunks)
        } else if (ev.type === 'done') {
          console.log('[loadVideo] done — video_id:', ev.video_id)
          onDone?.(ev.video_id)
        } else if (ev.type === 'error') {
          console.error('[loadVideo] backend error event:', ev.message)
          onError?.(new Error(ev.message))
        } else {
          console.warn('[loadVideo] unknown event type:', ev)
        }
      } catch (parseErr) {
        console.error('[loadVideo] failed to parse SSE line:', JSON.stringify(line), parseErr)
      }
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
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.detail || `Translation request failed (HTTP ${res.status})`)
  }
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
