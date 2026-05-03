import React, { useCallback, useEffect, useRef, useState } from 'react'
import ChatPanel from './components/ChatPanel'
import { PERSONAS } from './components/ChatPanel'
import { stripForTTS } from './utils'
import VideoPanel from './components/VideoPanel'
import { askQuestion, generateChapters, generateFunFacts, generateQuiz, loadVideo, speakAnswer, transcribeQuestion } from './api'

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
  en: "👋 Hello! I'm your teacher. Load a video above, then ask me anything about it — in English or Hindi!",
  hi: "👋 नमस्ते! मैं आपकी पाठशाला में आपका स्वागत करती हूँ। वीडियो लोड करें और कोई भी सवाल पूछें!",
}

const SAMPLES = [
  { label: '⚗️ Periodic Table', url: 'https://www.youtube.com/watch?v=t_f8bB1kf6M' },
  { label: '🌿 Photosynthesis', url: 'https://www.youtube.com/watch?v=OOgnG3yz4fA' },
  { label: '🧬 Cell Structure',  url: 'https://www.youtube.com/watch?v=URUJD5NEXC8' },
]

// ── Hero landing screen ──────────────────────────────────────────────────────

function HeroScreen({ videoUrl, setVideoUrl, onLoad, isLoading, language }) {
  return (
    <div className="flex-1 flex items-center justify-center relative overflow-hidden fade-in"
         style={{ background: 'linear-gradient(135deg, #1e1b4b 0%, #3730a3 50%, #4338ca 100%)' }}>
      {/* Subtle grid overlay */}
      <div className="absolute inset-0 opacity-10"
           style={{ backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)', backgroundSize: '32px 32px' }} />

      <div className="relative z-10 text-center px-6 w-full max-w-lg">
        {/* Logo */}
        <div className="text-7xl mb-5 fade-in-up" style={{ '--i': 0 }}>🎓</div>

        <h1 className="stagger text-4xl sm:text-5xl font-extrabold text-white tracking-tight" style={{ '--i': 1 }}>
          Aapki Pathshaala
        </h1>
        <p className="stagger text-2xl text-indigo-200 mt-1 mb-1" style={{ '--i': 2 }}>
          आपकी पाठशाला
        </p>
        <p className="stagger text-indigo-300 text-sm mb-8" style={{ '--i': 3 }}>
          हर सवाल का जवाब — Your teacher for every video lesson
        </p>

        {/* URL input */}
        <div className="stagger flex bg-white rounded-2xl shadow-2xl overflow-hidden mb-5" style={{ '--i': 4 }}>
          <input
            className="flex-1 min-w-0 px-4 py-3.5 text-sm text-gray-900 focus:outline-none placeholder-gray-400"
            placeholder={language === 'hi' ? 'YouTube URL यहाँ डालें…' : 'Paste any YouTube URL to get started…'}
            value={videoUrl}
            onChange={(e) => setVideoUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onLoad()}
            autoFocus
          />
          <button
            onClick={() => onLoad()}
            disabled={!videoUrl.trim() || isLoading}
            className="px-6 py-3.5 bg-orange-500 hover:bg-orange-600 disabled:opacity-50
                       text-white font-bold text-sm transition-colors whitespace-nowrap flex-shrink-0"
          >
            {isLoading
              ? (language === 'hi' ? 'लोड हो रहा है…' : 'Loading…')
              : (language === 'hi' ? 'शुरू करें' : 'Start')}
          </button>
        </div>

        {/* Sample chips */}
        <div className="stagger flex flex-wrap justify-center gap-2" style={{ '--i': 5 }}>
          <span className="text-indigo-400 text-xs self-center mr-1">
            {language === 'hi' ? 'या आज़माएं:' : 'Try:'}
          </span>
          {SAMPLES.map((s) => (
            <button
              key={s.url}
              onClick={() => { setVideoUrl(s.url); onLoad(s.url) }}
              disabled={isLoading}
              className="px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/25 border border-white/20
                         text-white text-xs font-medium transition-colors disabled:opacity-50"
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Font-size toggle ─────────────────────────────────────────────────────────

const FONT_SIZES = [
  { label: 'A-', value: 14, title: 'Small text' },
  { label: 'A',  value: 16, title: 'Default text' },
  { label: 'A+', value: 20, title: 'Large text' },
]

function FontSizeToggle({ size, onChange }) {
  return (
    <div className="flex items-center bg-indigo-800 rounded-lg p-0.5 flex-shrink-0" title="Text size">
      {FONT_SIZES.map(({ label, value, title }) => (
        <button
          key={value}
          onClick={() => onChange(value)}
          title={title}
          className={[
            'px-2 py-1 rounded-md font-bold transition-colors leading-none',
            size === value
              ? 'bg-white text-indigo-700 shadow-sm'
              : 'text-indigo-200 hover:text-white',
          ].join(' ')}
          style={{ fontSize: `${value - 4}px` }}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

// ── Mobile tab bar ───────────────────────────────────────────────────────────

function MobileTabBar({ activeTab, onChange, language }) {
  return (
    <div className="md:hidden flex-shrink-0 flex border-t border-gray-200 bg-white">
      {[
        { id: 'video', icon: '▶', label: language === 'hi' ? 'वीडियो' : 'Video' },
        { id: 'chat',  icon: '💬', label: language === 'hi' ? 'चैट' : 'Chat' },
      ].map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={[
            'flex-1 flex flex-col items-center gap-0.5 py-2.5 text-xs font-semibold transition-colors',
            activeTab === tab.id
              ? 'text-indigo-700 border-t-2 border-indigo-700 bg-indigo-50'
              : 'text-gray-500 border-t-2 border-transparent',
          ].join(' ')}
        >
          <span className="text-base">{tab.icon}</span>
          {tab.label}
        </button>
      ))}
    </div>
  )
}

// ── Root App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [videoUrl, setVideoUrl] = useState('')
  const [videoId, setVideoId]   = useState(null)
  const [chunks, setChunks]     = useState([])
  const [chapters, setChapters] = useState([])
  const [messages, setMessages] = useState([])
  const [language, setLanguage] = useState('en')
  const [isLoading, setIsLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [quiz, setQuiz]               = useState(null)
  const [activeTab, setActiveTab]     = useState('video')
  const [loadingStatus, setLoadingStatus] = useState(null)
  const [personaId, setPersonaId]       = useState(() => localStorage.getItem('persona-id') || 'aarti')
  const [funFacts, setFunFacts]         = useState([])
  const [answerLanguage, setAnswerLanguage] = useState('auto')
  const [voiceEnabled, setVoiceEnabled] = useState(false)  // off by default — user clicks 🔊
  const [classLevel, setClassLevel]     = useState(7)
  const [fontSize, setFontSize]   = useState(() => {
    const saved = localStorage.getItem('aoh-font-size')
    if (saved) return parseInt(saved, 10)
    return window.innerWidth < 768 ? 20 : 16   // mobile defaults large
  })
  // Left panel width as a percentage — persisted so the user's preference is remembered
  const [leftPct, setLeftPct] = useState(() => {
    const saved = localStorage.getItem('aoh-panel-split')
    return saved ? parseFloat(saved) : 42
  })
  const panelContainerRef = useRef(null)
  const playerRef = useRef(null)

  useEffect(() => {
    document.documentElement.style.fontSize = fontSize + 'px'
    localStorage.setItem('aoh-font-size', fontSize)
  }, [fontSize])

  useEffect(() => {
    localStorage.setItem('aoh-panel-split', leftPct)
  }, [leftPct])

  const handleSplitDrag = useCallback((e) => {
    e.preventDefault()
    const container = panelContainerRef.current
    if (!container) return
    const onMove = (ev) => {
      const rect = container.getBoundingClientRect()
      const pct = ((ev.clientX - rect.left) / rect.width) * 100
      setLeftPct(Math.max(22, Math.min(72, pct)))
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [])

  // Auto-load video when teacher shares a ?video= URL
  useEffect(() => {
    const v = new URLSearchParams(window.location.search).get('video')
    if (v) handleLoadVideo(v)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const youtubeId = videoUrl ? extractYouTubeId(videoUrl) : null
  const showHero  = !videoId && !isLoading

  // Welcome message tracks language toggle
  useEffect(() => {
    setMessages((prev) => {
      const rest = prev.filter((m) => m.id !== '__welcome__')
      return [{ role: 'bot', content: WELCOME[language], id: '__welcome__' }, ...rest]
    })
  }, [language])

  // ── Load video ────────────────────────────────────────────────────────────
  const handleLoadVideo = useCallback(async (overrideUrl) => {
    const url = (typeof overrideUrl === 'string' ? overrideUrl : videoUrl).trim()
    if (!url || isLoading) return
    setVideoUrl(url)
    setIsLoading(true)
    setLoadError('')
    setChunks([])
    setChapters([])
    setVideoId(null)
    setQuiz(null)
    setActiveTab('video')
    setLoadingStatus('⬇️ Downloading audio...')

    const afterLoad = (vid) => {
      generateChapters(vid)
        .then(({ chapters: ch }) => { if (ch?.length) setChapters(ch) })
        .catch(() => {})
      // Generate fun facts to show during translation loading — silent failure OK
      setFunFacts([])
      generateFunFacts(vid)
        .then(({ facts }) => { if (facts?.length) setFunFacts(facts) })
        .catch(() => {})
    }

    try {
      await loadVideo(url, {
        onStatus: setLoadingStatus,

        onChunk: (chunk) => setChunks((prev) => [...prev, chunk]),

        onCached: (vid, cachedChunks) => {
          setVideoId(vid)
          setChunks(cachedChunks)
          setMessages((prev) => [
            ...prev,
            {
              role: 'bot', id: `load-${Date.now()}`,
              content: language === 'hi'
                ? `⚡ कैश से लोड हुआ! ${cachedChunks.length} अनुभाग मिले। कोई भी सवाल पूछें!`
                : `⚡ Loaded from cache! ${cachedChunks.length} segments ready. Ask me anything!`,
            },
          ])
          afterLoad(vid)
        },

        onDone: (vid) => {
          setVideoId(vid)
          setMessages((prev) => [
            ...prev,
            {
              role: 'bot', id: `load-${Date.now()}`,
              content: language === 'hi'
                ? '✅ तैयार! कोई भी सवाल पूछें।'
                : '✅ Ready! Ask me anything.',
            },
          ])
          afterLoad(vid)
        },

        onError: (err) => setLoadError(err.message || 'Failed to load video'),
      })
    } catch (err) {
      setLoadError(err.message || 'Failed to load video')
    } finally {
      setIsLoading(false)
      setLoadingStatus(null)
    }
  }, [videoUrl, isLoading, language])

  // ── Ask question (streaming) ──────────────────────────────────────────────
  const handleAskQuestion = useCallback(async (questionText, detectedLang) => {
    const lang = detectedLang || language
    const userMsgId = `user-${Date.now()}`
    const botMsgId  = `bot-${Date.now()}`

    setMessages((prev) => [
      ...prev,
      { role: 'user', content: questionText, id: userMsgId },
      { role: 'bot', content: '', id: botMsgId, isStreaming: true },
    ])

    let fullAnswer = ''
    try {
      const response = await askQuestion(questionText, videoId, lang, { answerLanguage, classLevel })
      const reader = response.body.getReader()
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
          if (data === '[DONE]') break
          try {
            const { text } = JSON.parse(data)
            fullAnswer += text
            setMessages((prev) =>
              prev.map((m) => m.id === botMsgId ? { ...m, content: fullAnswer, isStreaming: true } : m)
            )
          } catch {}
        }
      }
    } catch (err) {
      fullAnswer = `❌ ${err.message}`
      setMessages((prev) =>
        prev.map((m) => m.id === botMsgId ? { ...m, content: fullAnswer } : m)
      )
    }

    setMessages((prev) =>
      prev.map((m) => m.id === botMsgId ? { ...m, content: fullAnswer, isStreaming: false } : m)
    )

    // Auto-play TTS when voiceEnabled (default OFF)
    if (voiceEnabled && fullAnswer && !fullAnswer.startsWith('❌')) {
      const voice = PERSONAS[personaId]?.voice || 'manisha'
      speakAnswer(stripForTTS(fullAnswer), lang, voice)
        .then(({ audio_base64 }) => {
          if (audio_base64) new Audio(`data:audio/wav;base64,${audio_base64}`).play().catch(() => {})
        })
        .catch(() => {})
    }
  }, [videoId, language, answerLanguage, classLevel, voiceEnabled, personaId])

  // ── Voice question ────────────────────────────────────────────────────────
  const handleVoiceQuestion = useCallback(async (audioBlob) => {
    if (!videoId) return
    const pid = `processing-${Date.now()}`
    setMessages((prev) => [
      ...prev,
      { role: 'bot', content: '🎙️ Transcribing your question…', id: pid },
    ])
    try {
      const { question_text, detected_language } = await transcribeQuestion(audioBlob)
      setMessages((prev) => prev.filter((m) => m.id !== pid))
      if (question_text?.trim()) {
        await handleAskQuestion(question_text, detected_language)
      } else {
        setMessages((prev) => [
          ...prev.filter((m) => m.id !== pid),
          {
            role: 'bot', id: `err-${Date.now()}`,
            content: language === 'hi'
              ? "❌ आवाज़ नहीं सुनाई दी। फिर से कोशिश करें।"
              : "❌ Couldn't hear your question. Please try again.",
          },
        ])
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev.filter((m) => m.id !== pid),
        { role: 'bot', id: `err-${Date.now()}`, content: `❌ Voice error: ${err.message}` },
      ])
    }
  }, [videoId, language, handleAskQuestion])

  // ── Seek ──────────────────────────────────────────────────────────────────
  const seekTo = useCallback((seconds) => {
    // Stop any TTS playback first
    window.dispatchEvent(new CustomEvent('aapki-stop-tts'))

    if (playerRef.current) {
      // Desktop: VideoPanel already mounted — seek immediately
      playerRef.current.seekTo(seconds)
      setActiveTab('video')
    } else {
      // Mobile: user is on chat tab so VideoPanel is unmounted (playerRef = null).
      // Switch to video tab first; React will mount VideoPanel synchronously,
      // but its useEffect (which sets playerRef) runs after paint — hence the delay.
      setActiveTab('video')
      setTimeout(() => playerRef.current?.seekTo(seconds), 150)
    }
  }, [])

  // ── Quiz handlers ─────────────────────────────────────────────────────────
  const handleStartQuiz = useCallback(async () => {
    if (!videoId) return
    setQuiz({ status: 'loading' })
    try {
      const { questions } = await generateQuiz(videoId, language)
      setQuiz({ status: 'active', questions, current: 0, answers: {} })
    } catch (err) {
      setQuiz(null)
      setMessages((prev) => [
        ...prev,
        { role: 'bot', id: `quiz-err-${Date.now()}`, content: `❌ Quiz generation failed: ${err.message}` },
      ])
    }
  }, [videoId, language])

  const handleQuizAnswer = useCallback((letter) => {
    setQuiz((prev) =>
      prev?.status === 'active'
        ? { ...prev, answers: { ...prev.answers, [prev.current]: letter } }
        : prev
    )
  }, [])

  const handleQuizNext = useCallback((isLast) => {
    setQuiz((prev) =>
      prev?.status === 'active'
        ? isLast ? { ...prev, status: 'done' } : { ...prev, current: prev.current + 1 }
        : prev
    )
  }, [])

  const handleQuizClose = useCallback(() => {
    setQuiz(null)
    setMessages((prev) => [
      ...prev,
      {
        role: 'bot', id: `post-quiz-${Date.now()}`,
        content: language === 'hi'
          ? '🎉 क्विज़ पूरी हुई! कोई और सवाल पूछें।'
          : '🎉 Quiz complete! Feel free to ask more questions.',
      },
    ])
  }, [language])

  // ── Shared panel props ────────────────────────────────────────────────────
  const chatPanelProps = {
    messages, videoId, language,
    onAskQuestion: handleAskQuestion,
    onVoiceQuestion: handleVoiceQuestion,
    onSeekTo: seekTo,
    isVideoLoaded: !!videoId,
    quiz, onStartQuiz: handleStartQuiz,
    onQuizAnswer: handleQuizAnswer,
    onQuizNext: handleQuizNext,
    onQuizClose: handleQuizClose,
    personaId,
    onPersonaChange: (id) => { setPersonaId(id); localStorage.setItem('persona-id', id) },
    answerLanguage, onAnswerLanguageChange: setAnswerLanguage,
    voiceEnabled,   onVoiceToggle: () => setVoiceEnabled(v => !v),
    classLevel,     onClassLevelChange: setClassLevel,
  }

  const videoPanelProps = {
    youtubeId, chunks, isLoading, language,
    onSeek: seekTo, playerRef, chapters, loadingStatus, funFacts,
  }

  return (
    <div className="h-screen flex flex-col">
      {/* ── Top bar (hidden on hero) ───────────────────────────────────────── */}
      <header className="bg-indigo-700 text-white px-3 py-2 flex items-center gap-3 shadow-md flex-shrink-0">
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-xl">🎓</span>
          <div className="hidden sm:block leading-tight">
            <p className="text-sm font-bold">Aapki Pathshaala</p>
            <p className="text-indigo-200 text-xs">आपकी पाठशाला</p>
          </div>
        </div>

        <FontSizeToggle size={fontSize} onChange={setFontSize} />
        <a
          href="/teacher"
          className="hidden sm:flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-800
                     hover:bg-indigo-600 text-indigo-100 text-xs font-medium transition-colors
                     flex-shrink-0 whitespace-nowrap"
        >
          📚 Teacher View
        </a>

        {/* URL bar — only shown after a video is (or was) loaded */}
        {!showHero && (
          <div className="flex flex-1 gap-2 min-w-0">
            <input
              className="flex-1 min-w-0 rounded-lg px-3 py-1.5 text-sm text-gray-900 bg-white
                         placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-400"
              placeholder={language === 'hi' ? 'YouTube URL डालें…' : 'Paste YouTube URL…'}
              value={videoUrl}
              onChange={(e) => setVideoUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleLoadVideo()}
              disabled={isLoading}
            />
            <button
              onClick={() => handleLoadVideo()}
              disabled={isLoading || !videoUrl.trim()}
              className="px-3 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-600
                         disabled:opacity-50 disabled:cursor-not-allowed
                         text-sm font-semibold text-white transition-colors whitespace-nowrap flex-shrink-0"
            >
              {isLoading
                ? (language === 'hi' ? 'लोड हो रहा है…' : 'Loading…')
                : (language === 'hi' ? 'लोड करें' : 'Load Video')}
            </button>
          </div>
        )}
      </header>

      {loadError && (
        <div className="bg-red-50 border-b border-red-200 px-4 py-2 text-red-700 text-sm flex items-center gap-2 flex-shrink-0">
          <span className="flex-shrink-0">⚠️</span>
          <span>{friendlyError(loadError)}</span>
          <button onClick={() => setLoadError('')} className="ml-auto text-red-400 hover:text-red-600 flex-shrink-0">✕</button>
        </div>
      )}

      {/* ── Main content ──────────────────────────────────────────────────── */}
      {showHero ? (
        <HeroScreen
          videoUrl={videoUrl}
          setVideoUrl={setVideoUrl}
          onLoad={handleLoadVideo}
          isLoading={isLoading}
          language={language}
        />
      ) : (
        <>
          {/* Desktop: side-by-side with draggable divider */}
          <div ref={panelContainerRef} className="hidden md:flex flex-1 overflow-hidden select-none">
            <div style={{ width: `${leftPct}%` }} className="flex flex-col h-full overflow-hidden flex-shrink-0 min-w-0">
              <VideoPanel {...videoPanelProps} />
            </div>

            {/* Drag handle — grab and pull left/right to resize panels */}
            <div
              onMouseDown={handleSplitDrag}
              className="w-1.5 flex-shrink-0 bg-gray-200 hover:bg-indigo-400 active:bg-indigo-500
                         cursor-col-resize transition-colors duration-150 group relative"
              title="Drag to resize"
            >
              <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-4 flex flex-col
                              items-center justify-center gap-0.5 opacity-0 group-hover:opacity-100
                              transition-opacity pointer-events-none">
                {[0,1,2,3,4].map(i => (
                  <div key={i} className="w-0.5 h-3 bg-white/80 rounded-full" />
                ))}
              </div>
            </div>

            <div className="flex-1 flex flex-col h-full overflow-hidden min-w-0">
              <ChatPanel {...chatPanelProps} />
            </div>
          </div>

          {/* Mobile: full-screen tabs */}
          <div className="md:hidden flex-1 overflow-hidden">
            {activeTab === 'video'
              ? <VideoPanel {...videoPanelProps} />
              : <ChatPanel {...chatPanelProps} />
            }
          </div>
          <MobileTabBar activeTab={activeTab} onChange={setActiveTab} language={language} />
        </>
      )}

      {/* Footer — desktop only, slim */}
      <footer className="no-print hidden md:flex flex-shrink-0 items-center justify-center
                         py-1.5 px-4 border-t border-gray-100 bg-white">
        <p className="text-xs text-gray-400">
          Aapki Pathshaala | <span lang="hi">आपकी पाठशाला</span>
          {' '}—{' '}
          <span className="text-gray-500 font-medium">Powered by Sarvam AI</span>
        </p>
      </footer>
    </div>
  )
}

// ── Friendly error messages ───────────────────────────────────────────────────

function friendlyError(msg = '') {
  const m = msg.toLowerCase()
  if (m.includes('vite_api_url') || m.includes('wrong response type') || m.includes('event-stream'))
    return '⚙️ API URL not configured — Set VITE_API_URL in your Vercel environment variables'
  if (m.includes('internal server') || m.includes('500') || m.includes('server error'))
    return 'कुछ गड़बड़ हो गई 😅 — Please try again!'
  if (m.includes('failed to fetch') || m.includes('networkerror') || m.includes('load failed'))
    return '🌐 Connection issue — कृपया internet check करें और retry करें'
  if (m.includes('cors') || m.includes('cross-origin'))
    return '🔒 CORS error — The backend needs to allow your frontend domain (check ALLOWED_ORIGINS in Railway)'
  if (m.includes('404') || m.includes('not found'))
    return '🔍 Video not found — कृपया YouTube URL check करें'
  // 429 = YouTube blocks entire Railway datacenter IP ranges — cookies don't help.
  // Permanent fix: set SUPADATA_API_KEY (free at supadata.ai) in Railway env vars.
  if (m.includes('429') || m.includes('rate-limiting') || m.includes('too many requests') || m.includes('supadata_api_key'))
    return '🚫 YouTube is blocking this server\'s IP (HTTP 429). Permanent fix: get a free API key at supadata.ai and set SUPADATA_API_KEY in your Railway environment variables.'
  // Other yt-dlp errors — show the actual reason rather than blaming the URL
  if (m.includes('yt-dlp error'))
    return `⬇️ Video download failed — ${msg.replace(/^yt-dlp error[:\s]*/i, '').trim().slice(0, 150)}`
  if (m.includes('400') || m.includes('invalid'))
    return '🔗 Could not load this video — कृपया एक valid YouTube link paste करें'
  if (m.includes('timeout') || m.includes('timed out'))
    return '⏱️ Request timed out — Please try again!'
  if (msg.length > 100)
    return 'कुछ गड़बड़ हो गई 😅 — Please try again!'
  return `कुछ गड़बड़ हो गई 😅 — ${msg}`
}
