import React, { useCallback, useEffect, useRef, useState } from 'react'
import ChatPanel from './components/ChatPanel'
import LanguageToggle from './components/LanguageToggle'
import VideoPanel from './components/VideoPanel'
import { askQuestion, loadVideo, speakAnswer, transcribeQuestion } from './api'

function extractYouTubeId(url) {
  const patterns = [
    /[?&]v=([^&#]+)/,
    /youtu\.be\/([^?&#]+)/,
    /embed\/([^?&#]+)/,
    /shorts\/([^?&#]+)/,
  ]
  for (const p of patterns) {
    const m = url.match(p)
    if (m) return m[1]
  }
  return null
}

const WELCOME = {
  en: "👋 Hello! I'm your AI tutor. Paste a YouTube URL above, load the video, then ask me anything about it — in English or Hindi!",
  hi: "👋 नमस्ते! मैं आपका AI शिक्षक हूँ। ऊपर YouTube URL डालें, वीडियो लोड करें, फिर अंग्रेजी या हिंदी में कोई भी सवाल पूछें!",
}

export default function App() {
  const [videoUrl, setVideoUrl] = useState('')
  const [videoId, setVideoId] = useState(null)
  const [chunks, setChunks] = useState([])
  const [messages, setMessages] = useState([])
  const [language, setLanguage] = useState('en')
  const [isLoading, setIsLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const playerRef = useRef(null)

  const youtubeId = videoUrl ? extractYouTubeId(videoUrl) : null

  // Reset welcome message when language toggles
  useEffect(() => {
    setMessages((prev) => {
      const filtered = prev.filter((m) => m.id !== '__welcome__')
      return [{ role: 'bot', content: WELCOME[language], id: '__welcome__' }, ...filtered]
    })
  }, [language])

  const handleLoadVideo = async () => {
    if (!videoUrl.trim() || isLoading) return
    setIsLoading(true)
    setLoadError('')
    setChunks([])
    setVideoId(null)

    try {
      const result = await loadVideo(videoUrl.trim())
      setVideoId(result.video_id)
      setChunks(result.chunks || [])
      const count = result.chunks?.length ?? 0
      setMessages((prev) => [
        ...prev,
        {
          role: 'bot',
          id: `load-${Date.now()}`,
          content:
            language === 'hi'
              ? `✅ वीडियो लोड हो गया! ${count} अनुभाग मिले। अब कोई भी सवाल पूछें!`
              : `✅ Video loaded! Found ${count} transcript segments. Ask me anything!`,
        },
      ])
    } catch (err) {
      setLoadError(err.message || 'Failed to load video')
    } finally {
      setIsLoading(false)
    }
  }

  const handleAskQuestion = useCallback(
    async (questionText, detectedLang) => {
      const lang = detectedLang || language
      const userMsgId = `user-${Date.now()}`
      const botMsgId = `bot-${Date.now()}`

      setMessages((prev) => [
        ...prev,
        { role: 'user', content: questionText, id: userMsgId },
        { role: 'bot', content: '', id: botMsgId, isStreaming: true },
      ])

      let fullAnswer = ''

      try {
        const response = await askQuestion(questionText, videoId, lang)
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })

          // Process complete SSE lines
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            const data = line.slice(6).trim()
            if (data === '[DONE]') break
            try {
              const { text } = JSON.parse(data)
              fullAnswer += text
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === botMsgId ? { ...m, content: fullAnswer, isStreaming: true } : m
                )
              )
            } catch {}
          }
        }
      } catch (err) {
        fullAnswer = `❌ ${err.message}`
        setMessages((prev) =>
          prev.map((m) => (m.id === botMsgId ? { ...m, content: fullAnswer } : m))
        )
      }

      // Mark streaming done
      setMessages((prev) =>
        prev.map((m) => (m.id === botMsgId ? { ...m, content: fullAnswer, isStreaming: false } : m))
      )

      // TTS playback in background
      if (fullAnswer && !fullAnswer.startsWith('❌')) {
        speakAnswer(fullAnswer, lang)
          .then(({ audio_base64 }) => {
            if (audio_base64) {
              const audio = new Audio(`data:audio/wav;base64,${audio_base64}`)
              audio.play().catch(() => {})
            }
          })
          .catch(() => {})
      }
    },
    [videoId, language]
  )

  const handleVoiceQuestion = useCallback(
    async (audioBlob) => {
      if (!videoId) return
      const processingId = `processing-${Date.now()}`
      setMessages((prev) => [
        ...prev,
        { role: 'bot', content: '🎙️ Transcribing your question...', id: processingId },
      ])
      try {
        const { question_text, detected_language } = await transcribeQuestion(audioBlob)
        setMessages((prev) => prev.filter((m) => m.id !== processingId))
        if (question_text?.trim()) {
          await handleAskQuestion(question_text, detected_language)
        } else {
          setMessages((prev) => [
            ...prev.filter((m) => m.id !== processingId),
            {
              role: 'bot',
              id: `err-${Date.now()}`,
              content:
                language === 'hi'
                  ? "❌ आवाज़ नहीं सुनाई दी। फिर से कोशिश करें।"
                  : "❌ Couldn't hear your question. Please try again.",
            },
          ])
        }
      } catch (err) {
        setMessages((prev) => [
          ...prev.filter((m) => m.id !== processingId),
          { role: 'bot', id: `err-${Date.now()}`, content: `❌ Voice error: ${err.message}` },
        ])
      }
    },
    [videoId, language, handleAskQuestion]
  )

  const seekTo = useCallback((seconds) => {
    playerRef.current?.seekTo(seconds, true)
  }, [])

  return (
    <div className="h-screen flex flex-col" style={{ fontFamily: "'Segoe UI', system-ui, sans-serif" }}>
      {/* ── Top bar ────────────────────────────────────────────── */}
      <header className="bg-indigo-700 text-white px-3 py-2 flex items-center gap-3 shadow-md flex-shrink-0">
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-xl">🎓</span>
          <div className="hidden sm:block leading-tight">
            <p className="text-sm font-bold">AI Office Hours</p>
            <p className="text-indigo-200 text-xs">AI ऑफिस आवर्स</p>
          </div>
        </div>

        <LanguageToggle language={language} onChange={setLanguage} />

        <div className="flex flex-1 gap-2 min-w-0">
          <input
            className="flex-1 min-w-0 rounded-lg px-3 py-1.5 text-sm text-gray-900 bg-white
                       placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-400"
            placeholder={language === 'hi' ? 'YouTube URL डालें...' : 'Paste YouTube URL...'}
            value={videoUrl}
            onChange={(e) => setVideoUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleLoadVideo()}
            disabled={isLoading}
          />
          <button
            onClick={handleLoadVideo}
            disabled={isLoading || !videoUrl.trim()}
            className="px-3 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-600
                       disabled:opacity-50 disabled:cursor-not-allowed
                       text-sm font-semibold text-white transition-colors whitespace-nowrap flex-shrink-0"
          >
            {isLoading
              ? language === 'hi' ? 'लोड हो रहा है...' : 'Loading…'
              : language === 'hi' ? 'लोड करें' : 'Load Video'}
          </button>
        </div>
      </header>

      {loadError && (
        <div className="bg-red-50 border-b border-red-200 px-4 py-2 text-red-700 text-sm flex items-center gap-2 flex-shrink-0">
          <span>⚠️</span>
          <span>{loadError}</span>
          <button onClick={() => setLoadError('')} className="ml-auto text-red-400 hover:text-red-600">✕</button>
        </div>
      )}

      {/* ── Main layout ─────────────────────────────────────────── */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: video + transcript */}
        <div className="flex flex-col w-full md:w-1/2 h-full overflow-hidden">
          <VideoPanel
            youtubeId={youtubeId}
            chunks={chunks}
            isLoading={isLoading}
            language={language}
            onSeek={seekTo}
            playerRef={playerRef}
          />
        </div>

        {/* Right: chat */}
        <div className="hidden md:flex flex-col w-1/2 h-full overflow-hidden">
          <ChatPanel
            messages={messages}
            videoId={videoId}
            language={language}
            onAskQuestion={handleAskQuestion}
            onVoiceQuestion={handleVoiceQuestion}
            onSeekTo={seekTo}
            isVideoLoaded={!!videoId}
          />
        </div>
      </div>

      {/* Mobile: chat below video (shown only on small screens) */}
      <div className="md:hidden flex flex-col flex-shrink-0 border-t border-gray-200" style={{ height: '45vh' }}>
        <ChatPanel
          messages={messages}
          videoId={videoId}
          language={language}
          onAskQuestion={handleAskQuestion}
          onVoiceQuestion={handleVoiceQuestion}
          onSeekTo={seekTo}
          isVideoLoaded={!!videoId}
        />
      </div>
    </div>
  )
}
