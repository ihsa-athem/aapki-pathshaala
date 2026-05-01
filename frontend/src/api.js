// In dev (no VITE_API_URL set), fall back to '' so requests go to /api/...
// and Vite's dev-server proxy forwards them to the backend — no CORS needed.
// In production, set VITE_API_URL to the deployed backend URL.
const API = import.meta.env.VITE_API_URL || ''

export async function loadVideo(videoUrl) {
  const res = await fetch(`${API}/api/load-video`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ video_url: videoUrl }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || 'Failed to load video')
  }
  return res.json()
}

export async function askQuestion(question, videoId, language) {
  const res = await fetch(`${API}/api/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, video_id: videoId, language }),
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

export async function speakAnswer(text, language) {
  const res = await fetch(`${API}/api/speak-answer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, language }),
  })
  if (!res.ok) return { audio_base64: null }
  return res.json()
}
