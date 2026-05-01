import React, { useEffect, useRef, useState } from 'react'
import VoiceRecorder from './VoiceRecorder'
import { MessageWithTimestamps } from './TimestampBadge'

const PLACEHOLDER = {
  en: 'Ask a question about the video...',
  hi: 'वीडियो के बारे में सवाल पूछें...',
}
const SEND_LABEL = { en: 'Send', hi: 'भेजें' }
const NO_VIDEO = {
  en: 'Load a video first to start asking questions.',
  hi: 'सवाल पूछने के लिए पहले वीडियो लोड करें।',
}

function TutorAvatar() {
  return (
    <div className="w-8 h-8 rounded-full bg-indigo-700 flex items-center justify-center flex-shrink-0 text-white text-sm shadow">
      🎓
    </div>
  )
}

function MessageBubble({ msg, onSeekTo }) {
  const isUser = msg.role === 'user'
  return (
    <div className={`flex gap-2 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && <TutorAvatar />}
      <div
        className={[
          'max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm',
          isUser
            ? 'bg-indigo-600 text-white rounded-br-sm'
            : 'bg-white text-gray-800 border border-gray-100 rounded-bl-sm',
        ].join(' ')}
      >
        {isUser ? (
          <span style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</span>
        ) : (
          <MessageWithTimestamps content={msg.content} onSeek={onSeekTo} />
        )}
        {msg.isStreaming && (
          <span className="inline-block w-1.5 h-4 bg-indigo-400 ml-0.5 animate-pulse rounded-sm align-middle" />
        )}
      </div>
    </div>
  )
}

export default function ChatPanel({
  messages,
  videoId,
  language,
  onAskQuestion,
  onVoiceQuestion,
  onSeekTo,
  isVideoLoaded,
}) {
  const [input, setInput] = useState('')
  const [isBusy, setIsBusy] = useState(false)
  const bottomRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = async () => {
    const q = input.trim()
    if (!q || isBusy || !isVideoLoaded) return
    setInput('')
    setIsBusy(true)
    try {
      await onAskQuestion(q)
    } finally {
      setIsBusy(false)
      inputRef.current?.focus()
    }
  }

  const handleVoice = async (blob) => {
    if (isBusy || !isVideoLoaded) return
    setIsBusy(true)
    try {
      await onVoiceQuestion(blob)
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <div className="flex flex-col h-full bg-gray-50 min-w-0">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200 bg-white flex-shrink-0">
        <h2 className="text-sm font-semibold text-gray-700">
          {language === 'hi' ? 'AI शिक्षक से पूछें' : 'Ask Your AI Tutor'}
        </h2>
        <p className="text-xs text-gray-400 mt-0.5">
          {language === 'hi'
            ? 'अंग्रेजी या हिंदी में पूछें'
            : 'Ask in English or Hindi'}
        </p>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto scrollbar-thin px-4 py-4 space-y-4">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} msg={msg} onSeekTo={onSeekTo} />
        ))}
        {isBusy && messages[messages.length - 1]?.role === 'user' && (
          <div className="flex gap-2 items-center">
            <TutorAvatar />
            <div className="bg-white border border-gray-100 rounded-2xl rounded-bl-sm px-4 py-3 shadow-sm">
              <div className="flex gap-1.5">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce"
                    style={{ animationDelay: `${i * 0.15}s` }}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div className="px-4 py-3 border-t border-gray-200 bg-white flex-shrink-0">
        {!isVideoLoaded && (
          <p className="text-xs text-center text-gray-400 mb-2">{NO_VIDEO[language]}</p>
        )}
        <div className="flex gap-2 items-end">
          <textarea
            ref={inputRef}
            rows={1}
            className="flex-1 resize-none rounded-xl border border-gray-200 px-3 py-2.5 text-sm
                       focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent
                       disabled:opacity-50 min-h-[42px] max-h-32 leading-snug"
            placeholder={isVideoLoaded ? PLACEHOLDER[language] : NO_VIDEO[language]}
            value={input}
            disabled={!isVideoLoaded || isBusy}
            onChange={(e) => {
              setInput(e.target.value)
              e.target.style.height = 'auto'
              e.target.style.height = Math.min(e.target.scrollHeight, 128) + 'px'
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
          />
          <VoiceRecorder
            onRecordingComplete={handleVoice}
            disabled={!isVideoLoaded || isBusy}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || !isVideoLoaded || isBusy}
            className="px-4 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold
                       hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed
                       transition-colors flex-shrink-0"
          >
            {SEND_LABEL[language]}
          </button>
        </div>
      </div>
    </div>
  )
}
