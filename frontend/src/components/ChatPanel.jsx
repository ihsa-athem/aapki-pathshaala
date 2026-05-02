import React, { useEffect, useRef, useState } from 'react'
import VoiceRecorder from './VoiceRecorder'
import { MessageWithTimestamps } from './TimestampBadge'
import QuizCard, { ScoreCard } from './QuizCard'
import { speakAnswer } from '../api'
import { stripForTTS } from '../utils'

// ── Language detector ────────────────────────────────────────────────────────
function detectLang(text) {
  return /[ऀ-ॿ]/.test(text) ? 'hi' : 'en'
}

// ── Paste-length nudge detector ──────────────────────────────────────────────
function looksLikePasted(text) {
  const words = text.trim().split(/\s+/)
  if (words.length > 50) return true
  const commas = (text.match(/,/g) || []).length
  return commas >= 5 || (text.match(/;/g) || []).length >= 2 || /[""].{10,}[""]/.test(text)
}

// ── Persona definitions ───────────────────────────────────────────────────────
// SVG avatars are inline so they work without any image hosting

function AartiSVG({ size = 40 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="40" cy="40" r="40" fill="#FFF7ED" />
      {/* Dupatta */}
      <ellipse cx="40" cy="17" rx="21" ry="12" fill="#F97316" />
      <path d="M19 17 Q12 30 17 50 Q20 54 23 51" fill="#F97316" opacity="0.75" />
      {/* Hair */}
      <ellipse cx="40" cy="26" rx="14" ry="10" fill="#1C1917" />
      {/* Face */}
      <circle cx="40" cy="33" r="13" fill="#FDE68A" />
      {/* Bindi */}
      <circle cx="40" cy="23" r="2" fill="#DC2626" />
      {/* Eyes */}
      <ellipse cx="35.5" cy="31" rx="2" ry="2.2" fill="#1C1917" />
      <ellipse cx="44.5" cy="31" rx="2" ry="2.2" fill="#1C1917" />
      <circle cx="36.3" cy="30.2" r="0.7" fill="white" />
      <circle cx="45.3" cy="30.2" r="0.7" fill="white" />
      {/* Nose */}
      <circle cx="40" cy="34" r="0.9" fill="#D97706" opacity="0.5" />
      {/* Smile */}
      <path d="M35 37 Q40 42 45 37" stroke="#92400E" strokeWidth="1.6" fill="none" strokeLinecap="round" />
      {/* Body/Saree */}
      <path d="M25 46 Q27 70 29 72 L51 72 Q53 70 55 46 Z" fill="#F97316" opacity="0.85" />
      <rect x="30" y="44" width="20" height="10" rx="3" fill="#FED7AA" />
    </svg>
  )
}

function RajeshSVG({ size = 40 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="40" cy="40" r="40" fill="#EEF2FF" />
      {/* Hair */}
      <ellipse cx="40" cy="22" rx="16" ry="10" fill="#1C1917" />
      {/* Face */}
      <circle cx="40" cy="32" r="14" fill="#FCD34D" opacity="0.9" />
      {/* Glasses */}
      <rect x="29" y="27" width="9" height="7" rx="2.5" stroke="#374151" strokeWidth="1.8" fill="white" fillOpacity="0.3" />
      <rect x="42" y="27" width="9" height="7" rx="2.5" stroke="#374151" strokeWidth="1.8" fill="white" fillOpacity="0.3" />
      <line x1="38" y1="30.5" x2="42" y2="30.5" stroke="#374151" strokeWidth="1.8" />
      <line x1="25" y1="29" x2="29" y2="30" stroke="#374151" strokeWidth="1.5" />
      <line x1="51" y1="29" x2="55" y2="30" stroke="#374151" strokeWidth="1.5" />
      {/* Eyes */}
      <circle cx="33.5" cy="31" r="1.8" fill="#1C1917" />
      <circle cx="46.5" cy="31" r="1.8" fill="#1C1917" />
      <circle cx="34.3" cy="30.2" r="0.6" fill="white" />
      <circle cx="47.3" cy="30.2" r="0.6" fill="white" />
      {/* Nose */}
      <circle cx="40" cy="34.5" r="0.9" fill="#D97706" opacity="0.4" />
      {/* Smile */}
      <path d="M35 38 Q40 43 45 38" stroke="#78350F" strokeWidth="1.5" fill="none" strokeLinecap="round" />
      {/* Shirt */}
      <path d="M24 72 L24 47 Q32 44 36 47 L40 54 L44 47 Q48 44 56 47 L56 72 Z" fill="#3730A3" />
      <path d="M36 47 L40 53 L44 47" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round" />
    </svg>
  )
}

export const PERSONAS = {
  aarti: {
    id: 'aarti',
    name: "Aarti Ma'am",
    shortName: 'Aarti',
    voice: 'manisha',   // valid Sarvam bulbul:v2 female voice ('meera' is v1-only)
    gender: 'female',
    Avatar: AartiSVG,
    color: 'orange',
  },
  rajesh: {
    id: 'rajesh',
    name: 'Rajesh Sir',
    shortName: 'Rajesh',
    voice: 'abhilash',  // valid Sarvam bulbul:v2 male voice ('arjun' is v1-only)
    gender: 'male',
    Avatar: RajeshSVG,
    color: 'indigo',
  },
}

// ── Persona selector cards ───────────────────────────────────────────────────

function PersonaSelector({ personaId, onChange }) {
  return (
    <div className="flex gap-2 px-3 py-2.5 border-b border-gray-100 bg-white">
      {Object.values(PERSONAS).map((p) => {
        const active = personaId === p.id
        return (
          <button
            key={p.id}
            onClick={() => onChange(p.id)}
            className={[
              'relative flex flex-col items-center gap-1 py-2 px-2 rounded-xl border-2',
              'transition-all duration-200 flex-1 text-center min-w-0',
              active
                ? 'border-orange-400 bg-orange-50 shadow-sm shadow-orange-100'
                : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50',
            ].join(' ')}
          >
            {active && (
              <span className="absolute top-1 right-1.5 flex items-center gap-0.5 text-xs text-green-600 font-semibold">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
                <span className="hidden sm:inline">Active</span>
              </span>
            )}
            {/* Avatar — compact to keep header tight */}
            <div className="w-7 h-7 sm:w-9 sm:h-9">
              <p.Avatar size={28} />
            </div>
            {/* Name hidden on very small screens to save space */}
            <span className={`text-xs font-bold truncate w-full hidden sm:block ${active ? 'text-orange-700' : 'text-gray-700'}`}>
              {p.name}
            </span>
            {/* Mobile: just first-name abbreviation */}
            <span className={`text-xs font-bold sm:hidden ${active ? 'text-orange-700' : 'text-gray-500'}`}>
              {p.shortName}
            </span>
          </button>
        )
      })}
    </div>
  )
}

// ── Empty state when no video is loaded ──────────────────────────────────────

function NoVideoWelcome() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-6 py-8 fade-in">
      {/* Both teachers waving */}
      <div className="flex items-end justify-center gap-6 mb-5">
        {Object.values(PERSONAS).map((p) => (
          <div key={p.id} className="flex flex-col items-center gap-1.5">
            <div className="w-12 h-12 drop-shadow-md">
              <p.Avatar size={48} />
            </div>
            <span className="text-xs font-semibold text-gray-600">{p.name}</span>
          </div>
        ))}
      </div>
      <p className="text-3xl mb-3">Namaste! 🙏</p>
      <p className="text-sm font-medium text-gray-700 mb-1">
        Load a video above to start your lesson
      </p>
      <p className="text-sm text-gray-500" lang="hi">
        ऊपर वीडियो लोड करें और पढ़ाई शुरू करें
      </p>
    </div>
  )
}

// ── Tutor avatar (small, for message bubbles) ────────────────────────────────

function TutorAvatar({ isThinking = false, personaId = 'aarti' }) {
  const p = PERSONAS[personaId] || PERSONAS.aarti
  return (
    <div className="relative flex-shrink-0">
      <div
        className={[
          'w-8 h-8 rounded-full overflow-hidden shadow flex items-center justify-center',
          'bg-orange-50 transition-all duration-300',
          isThinking ? 'ring-2 ring-indigo-400 ring-offset-1 ring-offset-white' : '',
        ].join(' ')}
        title={p.name}
      >
        <p.Avatar size={32} />
      </div>
      {isThinking && (
        <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-orange-400 border border-white animate-ping" />
      )}
    </div>
  )
}

// ── Speaker icon ─────────────────────────────────────────────────────────────

function SpeakerIcon({ playing }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4" aria-hidden="true">
      <path d="M10 3.75a.75.75 0 00-1.264-.546L4.703 7H3.167a.75.75 0 00-.7.484A6.984 6.984 0 002 10c0 .887.165 1.737.468 2.516.104.27.37.484.7.484h1.535l4.033 3.796A.75.75 0 0010 16.25V3.75z" />
      {playing && (
        <path d="M13.024 7.975a.75.75 0 111.06-1.06 5.5 5.5 0 010 7.77.75.75 0 01-1.06-1.06 4 4 0 000-5.65z" />
      )}
    </svg>
  )
}

// ── Message bubble ───────────────────────────────────────────────────────────

function MessageBubble({ msg, onSeekTo, onSpeak, playingId, loadingVoiceId, personaId }) {
  const isUser      = msg.role === 'user'
  const isPlaying   = playingId === msg.id
  const isLoading   = loadingVoiceId === msg.id
  const showSpeaker = !isUser && !!msg.content && !msg.isStreaming

  return (
    <div className={`flex gap-2.5 fade-in-up ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && <TutorAvatar personaId={personaId} />}
      <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} max-w-[78%]`}>
        <div className={[
          'rounded-2xl px-4 py-3 text-sm leading-relaxed',
          isUser
            ? 'bg-indigo-600 text-white rounded-br-none shadow-md shadow-indigo-200'
            : 'bg-white text-gray-800 border border-gray-100 rounded-bl-none shadow-sm',
        ].join(' ')}>
          {isUser
            ? <span style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</span>
            : <MessageWithTimestamps content={msg.content} onSeek={onSeekTo} />
          }
          {msg.isStreaming && (
            <span className="inline-block w-1.5 h-4 bg-indigo-400 ml-0.5 animate-pulse rounded-sm align-middle" />
          )}
        </div>
        {showSpeaker && (
          <button
            onClick={() => onSpeak(msg.id, msg.content)}
            disabled={isLoading}
            title={isPlaying ? 'Stop' : isLoading ? 'Loading audio…' : 'Read aloud'}
            className={[
              'mt-0.5 w-11 h-11 flex items-center justify-center rounded-full',
              'transition-all duration-200 self-start',
              isPlaying ? 'animate-pulse' : 'hover:bg-gray-100',
            ].join(' ')}
            style={{ color: isPlaying ? '#F97316' : isLoading ? '#818cf8' : '#9ca3af' }}
          >
            {isLoading
              ? <span className="w-3.5 h-3.5 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
              : <SpeakerIcon playing={isPlaying} />
            }
          </button>
        )}
      </div>
    </div>
  )
}

// ── Thinking bubble ──────────────────────────────────────────────────────────

function ThinkingBubble({ language, personaId }) {
  return (
    <div className="flex gap-2 items-start fade-in">
      <TutorAvatar isThinking personaId={personaId} />
      <div className="bg-white border border-gray-100 rounded-2xl rounded-bl-none px-4 py-3 shadow-sm">
        <div className="flex gap-1.5 items-center">
          {[0, 1, 2].map((i) => (
            <div key={i} className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce"
              style={{ animationDelay: `${i * 0.15}s` }} />
          ))}
          <span className="text-xs text-gray-400 ml-1.5">
            {language === 'hi' ? 'सोच रहे हैं…' : 'Thinking…'}
          </span>
        </div>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

const CLASS_OPTIONS = [4,5,6,7,8,9,10]

export default function ChatPanel({
  messages, videoId, language,
  onAskQuestion, onVoiceQuestion, onSeekTo, isVideoLoaded,
  quiz, onStartQuiz, onQuizAnswer, onQuizNext, onQuizClose,
  personaId = 'aarti', onPersonaChange,
  answerLanguage = 'auto', onAnswerLanguageChange,
  voiceEnabled = true, onVoiceToggle,
  classLevel = 7, onClassLevelChange,
}) {
  const [input, setInput]           = useState('')
  const [isBusy, setIsBusy]         = useState(false)
  const [playingId, setPlayingId]   = useState(null)
  const [loadingVoiceId, setLoadingVoiceId] = useState(null)  // TTS fetch in progress
  const [showNudge, setShowNudge]   = useState(false)
  const audioRef   = useRef(null)
  const bottomRef  = useRef(null)
  const inputRef   = useRef(null)

  const persona    = PERSONAS[personaId] || PERSONAS.aarti
  const quizActive  = quiz && (quiz.status === 'active' || quiz.status === 'done')
  const quizLoading = quiz?.status === 'loading'
  const showThinking = isBusy && !quizActive

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, quiz])

  // ── Read-aloud ────────────────────────────────────────────────────────────
  const handleSpeak = async (msgId, text) => {
    if (playingId === msgId) {
      audioRef.current?.pause(); audioRef.current = null
      setPlayingId(null); setLoadingVoiceId(null); return
    }
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null }
    setPlayingId(null)
    setLoadingVoiceId(msgId)
    try {
      const lang = detectLang(text)
      // Strip markdown before TTS — prevents "asterisk asterisk" / "hashtag" being spoken
      const { audio_base64 } = await speakAnswer(stripForTTS(text), lang, persona.voice)
      setLoadingVoiceId(null)
      if (!audio_base64) return
      setPlayingId(msgId)
      const audio = new Audio(`data:audio/wav;base64,${audio_base64}`)
      audioRef.current = audio
      audio.onended = () => { audioRef.current = null; setPlayingId(null) }
      audio.onerror = () => { audioRef.current = null; setPlayingId(null) }
      await audio.play()
    } catch { setLoadingVoiceId(null); setPlayingId(null) }
  }
  useEffect(() => () => { audioRef.current?.pause() }, [])

  // Stop TTS when the user clicks a timestamp and the video starts playing
  useEffect(() => {
    const stop = () => {
      audioRef.current?.pause()
      audioRef.current = null
      setPlayingId(null)
      setLoadingVoiceId(null)
    }
    window.addEventListener('aapki-stop-tts', stop)
    return () => window.removeEventListener('aapki-stop-tts', stop)
  }, [])

  // ── Send ──────────────────────────────────────────────────────────────────
  const handleSend = async (force = false) => {
    const q = input.trim()
    if (!q || isBusy || !isVideoLoaded || quizActive) return
    if (!force && looksLikePasted(q)) { setShowNudge(true); return }
    setShowNudge(false); setInput(''); setIsBusy(true)
    try { await onAskQuestion(q) } finally { setIsBusy(false); inputRef.current?.focus() }
  }

  const handleVoice = async (blob) => {
    if (isBusy || !isVideoLoaded || quizActive) return
    setIsBusy(true)
    try { await onVoiceQuestion(blob) } finally { setIsBusy(false) }
  }

  const PLACEHOLDER = { en: 'Ask a question about the video...', hi: 'वीडियो के बारे में सवाल पूछें...' }
  const SEND_LABEL  = { en: 'Send', hi: 'भेजें' }
  const NO_VIDEO    = { en: 'Load a video first to start asking questions.', hi: 'सवाल पूछने के लिए पहले वीडियो लोड करें।' }

  return (
    <div className="flex flex-col h-full bg-gray-50 min-w-0">

      {/* ── ROW 1: Persona selector cards ───────────────────────────── */}
      <PersonaSelector personaId={personaId} onChange={onPersonaChange} />

      {/* ── ROW 2: Compact controls ─────────────────────────────────── */}
      <div className="px-3 py-2 border-b border-gray-200 bg-white flex-shrink-0 flex items-center gap-2 flex-wrap">
        {/* Answer language */}
        <label className="flex items-center gap-1 flex-shrink-0">
          <span className="text-xs text-gray-500 font-medium whitespace-nowrap">Answer:</span>
          <select
            value={answerLanguage}
            onChange={e => onAnswerLanguageChange?.(e.target.value)}
            className="text-xs border border-gray-300 rounded-md px-1.5 py-0.5 bg-white
                       text-gray-700 focus:outline-none focus:ring-1 focus:ring-indigo-400 cursor-pointer"
          >
            <option value="auto">Auto</option>
            <option value="en">English</option>
            <option value="hi">Hindi / हिंदी</option>
          </select>
        </label>

        {/* Voice auto-play toggle */}
        <button
          onClick={onVoiceToggle}
          title={voiceEnabled ? 'Auto-play on — click to mute' : 'Auto-play off — click to enable'}
          className={`flex-shrink-0 flex items-center gap-1 px-2 py-0.5 rounded-md border text-xs font-medium transition-all ${
            voiceEnabled
              ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
              : 'border-gray-300 bg-white text-gray-400'
          }`}
        >
          {voiceEnabled ? '🔊' : '🔇'}
        </button>

        {/* Class level */}
        <label className="flex items-center gap-1 flex-shrink-0">
          <span className="text-xs text-gray-500 font-medium">Class:</span>
          <select
            value={classLevel}
            onChange={e => onClassLevelChange?.(parseInt(e.target.value))}
            className="text-xs border border-gray-300 rounded-md px-1.5 py-0.5 bg-white
                       text-gray-700 focus:outline-none focus:ring-1 focus:ring-indigo-400 cursor-pointer"
          >
            {CLASS_OPTIONS.map(c => (
              <option key={c} value={c}>Class {c}</option>
            ))}
          </select>
        </label>

      </div>

      {/* ── Quiz banner — full-width prominent CTA ───────────────────── */}
      {isVideoLoaded && !quizActive && !quizLoading && (
        <button
          onClick={onStartQuiz}
          className="no-print flex-shrink-0 w-full py-2.5 flex items-center justify-center gap-2
                     bg-gradient-to-r from-indigo-600 via-purple-600 to-indigo-600
                     hover:from-indigo-700 hover:to-indigo-700
                     text-white text-sm font-semibold transition-all
                     border-b border-indigo-800/20"
        >
          ✨ Ready to test yourself? Take the Quiz!
        </button>
      )}
      {quizLoading && (
        <div className="flex-shrink-0 w-full py-2 bg-orange-50 border-b border-orange-100
                        flex items-center justify-center gap-1.5 text-xs text-orange-600 font-medium">
          <div className="w-3 h-3 border-2 border-orange-400 border-t-transparent rounded-full animate-spin" />
          Generating your quiz…
        </div>
      )}

      {/* ── Messages ────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto scrollbar-thin px-4 py-4 space-y-3">
        {!isVideoLoaded ? (
          <NoVideoWelcome />
        ) : (
          <>
            {messages.map((msg) => (
              <MessageBubble key={msg.id} msg={msg} onSeekTo={onSeekTo}
                onSpeak={handleSpeak} playingId={playingId} loadingVoiceId={loadingVoiceId} personaId={personaId} />
            ))}
            {showThinking && <ThinkingBubble language={language} personaId={personaId} />}
            {quiz?.status === 'active' && (
              <div className="fade-in-up">
                <QuizCard quiz={quiz} onAnswer={onQuizAnswer} onNext={onQuizNext}
                  onClose={onQuizClose} onSeekTo={onSeekTo} language={language} />
              </div>
            )}
            {quiz?.status === 'done' && (
              <div className="fade-in-up">
                <ScoreCard questions={quiz.questions} answers={quiz.answers}
                  language={language} onClose={onQuizClose} />
              </div>
            )}
          </>
        )}
        <div ref={bottomRef} />
      </div>

      {/* ── Input area ──────────────────────────────────────────────── */}
      <div className="px-4 py-3 border-t border-gray-200 bg-white flex-shrink-0">
        {!isVideoLoaded && (
          <p className="text-xs text-center text-gray-400 mb-2">{NO_VIDEO[language]}</p>
        )}
        {quizActive && (
          <p className="text-xs text-center text-orange-500 mb-2 font-medium">
            🧠 {language === 'hi' ? 'क्विज़ जारी है — पहले इसे पूरा करें' : 'Quiz in progress — finish it first'}
          </p>
        )}

        {/* Paste nudge */}
        {showNudge && (
          <div className="mb-2 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-xl fade-in">
            <p className="text-xs text-amber-800">
              ✏️ {language === 'hi'
                ? 'अपने शब्दों में पूछें — इससे समझना आसान होता है!'
                : 'Try asking this in your own words — it helps you learn better!'}
            </p>
            <div className="flex gap-2 mt-2">
              <button onClick={() => { setInput(''); setShowNudge(false); inputRef.current?.focus() }}
                className="px-3 py-1 rounded-lg bg-amber-200 hover:bg-amber-300 text-amber-900 text-xs font-semibold">
                {language === 'hi' ? 'फिर से लिखें' : 'Rephrase'}
              </button>
              <button onClick={() => handleSend(true)}
                className="px-3 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold">
                {language === 'hi' ? 'फिर भी भेजें' : 'Send Anyway'}
              </button>
            </div>
          </div>
        )}

        <div className="flex gap-2 items-end">
          <textarea ref={inputRef} rows={1}
            className="flex-1 resize-none rounded-xl border border-gray-200 px-3 py-2.5 text-sm
                       focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent
                       disabled:opacity-40 min-h-[42px] max-h-32 leading-snug"
            placeholder={isVideoLoaded && !quizActive ? PLACEHOLDER[language] : NO_VIDEO[language]}
            value={input}
            disabled={!isVideoLoaded || isBusy || quizActive}
            onChange={(e) => {
              setInput(e.target.value)
              if (showNudge) setShowNudge(false)
              e.target.style.height = 'auto'
              e.target.style.height = Math.min(e.target.scrollHeight, 128) + 'px'
            }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
          />
          <VoiceRecorder onRecordingComplete={handleVoice} disabled={!isVideoLoaded || isBusy || quizActive} />
          <button onClick={handleSend}
            disabled={!input.trim() || !isVideoLoaded || isBusy || quizActive}
            className="px-4 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold
                       hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed
                       transition-colors flex-shrink-0">
            {SEND_LABEL[language]}
          </button>
        </div>
      </div>
    </div>
  )
}
