import React, { useCallback, useEffect, useRef, useState } from 'react'
import ChapterTimeline from './ChapterTimeline'
import { translateTranscript } from '../api'

// ── Animated book illustration (pure CSS, no external deps) ───────────────────

function BookAnimation() {
  return (
    <div className="relative w-20 h-14 flex-shrink-0">
      {/* Cover */}
      <div className="absolute inset-0 bg-indigo-700 rounded-lg shadow-md" />
      {/* Spine line */}
      <div className="absolute left-1/2 inset-y-0 w-0.5 bg-indigo-900 z-10" />
      {/* Left page */}
      <div className="absolute inset-y-1 left-1 right-1/2 bg-amber-50 rounded-l-md">
        <div className="p-1.5 space-y-1">
          {[80, 100, 70, 90].map((w, i) => (
            <div key={i} className="h-0.5 bg-gray-300 rounded-full" style={{ width: `${w}%` }} />
          ))}
        </div>
      </div>
      {/* Right page — flaps */}
      <div
        className="absolute inset-y-1 left-1/2 right-1 bg-orange-50 rounded-r-md origin-left"
        style={{ animation: 'pageFlap 1.8s ease-in-out infinite' }}
      >
        <div className="p-1.5 space-y-1">
          {[90, 70, 100, 60].map((w, i) => (
            <div key={i} className="h-0.5 bg-gray-300 rounded-full" style={{ width: `${w}%` }} />
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Loading overlay shown during translation ───────────────────────────────────

const LOADING_MSGS = [
  'थोड़ा इंतज़ार करें... 📚',
  'Almost ready!',
  'आपकी पाठशाला तैयार हो रही है ✨',
  'Preparing your translation...',
  'बस एक पल... 🌟',
  'Loading new language...',
]

function TranslationLoadingOverlay({ funFacts }) {
  const allItems = [
    ...LOADING_MSGS.map(t => ({ type: 'msg', text: t })),
    ...funFacts.map(t => ({ type: 'fact', text: t })),
  ]
  const [idx, setIdx] = useState(0)
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    if (!allItems.length) return
    const timer = setInterval(() => {
      setVisible(false)
      setTimeout(() => {
        setIdx(i => (i + 1) % allItems.length)
        setVisible(true)
      }, 320)
    }, 2600)
    return () => clearInterval(timer)
  }, [allItems.length]) // eslint-disable-line

  const current = allItems[idx % allItems.length] || { type: 'msg', text: 'Translating…' }

  return (
    <div className="absolute inset-0 z-20 bg-white/95 backdrop-blur-[1px] flex flex-col items-center justify-center gap-5 px-6">
      <BookAnimation />

      <div
        style={{
          opacity: visible ? 1 : 0,
          transform: visible ? 'translateY(0)' : 'translateY(6px)',
          transition: 'opacity 0.32s ease, transform 0.32s ease',
        }}
        className="w-full max-w-xs text-center"
      >
        {current.type === 'fact' ? (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 shadow-sm text-left">
            <div className="flex items-start gap-2.5">
              <span className="text-xl flex-shrink-0 mt-0.5">💡</span>
              <p className="text-sm text-amber-900 leading-relaxed">{current.text}</p>
            </div>
          </div>
        ) : (
          <p className="text-sm font-semibold text-indigo-700">{current.text}</p>
        )}
      </div>
    </div>
  )
}

function fmtTime(s) {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

function TranscriptSkeleton() {
  const rows = [[10,75],[10,90],[10,60],[10,85],[10,70],[10,95],[10,55],[10,80]]
  return (
    <div className="py-3 px-4 space-y-4">
      {rows.map(([ts, w], i) => (
        <div key={i} className="flex gap-3 items-start">
          <div className="skeleton flex-shrink-0 rounded" style={{ width: `${ts * 4}px`, height: '14px', marginTop: '2px' }} />
          <div className="flex-1 space-y-1.5">
            <div className="skeleton rounded" style={{ width: `${w}%`, height: '14px' }} />
            {w > 75 && <div className="skeleton rounded" style={{ width: `${w - 30}%`, height: '14px' }} />}
          </div>
        </div>
      ))}
    </div>
  )
}

async function fetchYouTubeTitle(videoId) {
  try {
    const res = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`)
    return (await res.json()).title || videoId
  } catch { return videoId }
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
}

const DEFAULT_VIDEO_HEIGHT = 280   // px — good starting point on most screens

export default function VideoPanel({ youtubeId, chunks, isLoading, language, onSeek, playerRef, chapters, loadingStatus, funFacts = [] }) {
  const iframeRef      = useRef(null)
  const panelRef       = useRef(null)
  const [currentTime, setCurrentTime]     = useState(0)
  const [videoHeight, setVideoHeight]     = useState(DEFAULT_VIDEO_HEIGHT)
  const transcriptRef  = useRef(null)
  const [isDownloading, setIsDownloading] = useState(false)
  // Translation state
  // transcriptLang: 'original' | 'en' | 'hi' | 'simple_en'
  const [transcriptLang, setTranscriptLang]   = useState('original')
  const [translations, setTranslations]       = useState({})  // cache per lang key
  const [isTranslating, setIsTranslating]     = useState(false)

  const visibleChunks = transcriptLang === 'original'
    ? chunks
    : (translations[transcriptLang] || chunks)

  // Reset when new video loads
  useEffect(() => {
    setTranscriptLang('original')
    setTranslations({})
  }, [chunks.length === 0 ? 0 : chunks[0]?.chunk_id])

  // Detect transition from translating → done to trigger stagger animation
  const wasTranslating = useRef(false)
  const [animateChunks, setAnimateChunks] = useState(false)
  useEffect(() => {
    if (wasTranslating.current && !isTranslating && transcriptLang !== 'original') {
      setAnimateChunks(true)
      const t = setTimeout(() => setAnimateChunks(false), 80 + visibleChunks.length * 60)
      return () => clearTimeout(t)
    }
    wasTranslating.current = isTranslating
  }, [isTranslating]) // eslint-disable-line

  const handleTranscriptLangChange = useCallback(async (lang) => {
    setTranscriptLang(lang)
    if (lang === 'original') return
    if (translations[lang]) return // already cached

    setIsTranslating(true)
    try {
      const src = chunks.map(c => `[${fmtTime(c.start_time)}] ${c.text}`).join('\n\n')
      const targetLang = lang === 'simple_en' ? 'en' : lang
      const style      = lang === 'simple_en' ? 'simple' : 'standard'
      const { translation } = await translateTranscript(src, targetLang, style)
      const lines = translation.split(/\n{2,}/).filter(Boolean)
      const translated = chunks.map((c, i) => ({
        ...c,
        text: (lines[i] || '').replace(/^\[\d+:\d+\]\s*/, '').trim() || c.text,
      }))
      setTranslations(prev => ({ ...prev, [lang]: translated }))
    } catch (e) {
      console.error('Translate failed:', e)
      setTranscriptLang('original')
    }
    setIsTranslating(false)
  }, [chunks, translations])

  // ── Drag-to-resize handle ─────────────────────────────────────────────────
  const startDrag = useCallback((e) => {
    e.preventDefault()
    const startY   = e.touches ? e.touches[0].clientY : e.clientY
    const startH   = videoHeight

    const onMove = (ev) => {
      const dy = (ev.touches ? ev.touches[0].clientY : ev.clientY) - startY
      const panelH = panelRef.current?.clientHeight ?? 600
      const next = Math.max(160, Math.min(panelH * 0.75, startH + dy))
      setVideoHeight(next)
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup',   onUp)
      document.removeEventListener('touchmove', onMove)
      document.removeEventListener('touchend',  onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup',   onUp)
    document.addEventListener('touchmove', onMove, { passive: false })
    document.addEventListener('touchend',  onUp)
  }, [videoHeight])

  // ── YouTube player control ────────────────────────────────────────────────
  // seekTo: reload the iframe src with ?start=N (autoplay=0 — user controls play/pause).
  // This is the ONLY approach that works reliably across all browsers —
  // postMessage seekTo silently fails when the player hasn't registered its
  // listener yet (a race condition that happens most of the time on first seek).
  const buildSrc = (videoId, startSeconds = 0) => {
    const base = `https://www.youtube.com/embed/${videoId}`
    const params = new URLSearchParams({
      enablejsapi: '1',
      controls: '1',        // always show YouTube controls
      rel: '0',
      modestbranding: '1',
      iv_load_policy: '3',
      autoplay: '0',        // never autoplay — user presses play when ready
      ...(startSeconds > 0 && { start: String(Math.floor(startSeconds)) }),
      origin: window.location.origin,
    })
    return `${base}?${params}`
  }

  useEffect(() => {
    if (!youtubeId) { playerRef.current = null; return }

    playerRef.current = {
      seekTo: (seconds) => {
        setCurrentTime(seconds) // instant transcript highlight
        if (!iframeRef.current) return
        // Reload iframe positioned at the correct time (autoplay=0).
        // Video is paused at that frame — user presses play when ready.
        iframeRef.current.src = buildSrc(youtubeId, seconds)
      },
    }

    // Receive currentTime updates while video plays (for transcript highlighting)
    const onMsg = (e) => {
      if (e.origin !== 'https://www.youtube.com') return
      try {
        const d = JSON.parse(e.data)
        if (d.event === 'onReady') {
          // Tell the iframe to send periodic state updates (currentTime etc.)
          iframeRef.current?.contentWindow?.postMessage(
            JSON.stringify({ event: 'listening' }),
            'https://www.youtube.com'
          )
        } else if (d.event === 'infoDelivery' && typeof d.info?.currentTime === 'number') {
          setCurrentTime(d.info.currentTime)
        }
      } catch {}
    }
    window.addEventListener('message', onMsg)
    return () => {
      window.removeEventListener('message', onMsg)
      playerRef.current = null
    }
  }, [youtubeId, playerRef])

  // Auto-scroll active transcript chunk
  const activeIdx = chunks.findIndex((c) => currentTime >= c.start_time && currentTime <= c.end_time)
  useEffect(() => {
    if (activeIdx >= 0 && transcriptRef.current) {
      const el = transcriptRef.current.querySelector(`[data-chunk="${activeIdx}"]`)
      el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [activeIdx])

  // ── Download handler ───────────────────────────────────────────────────────
  const handleDownload = async () => {
    setIsDownloading(true)
    try {
      const title = youtubeId ? await fetchYouTubeTitle(youtubeId) : 'transcript'
      const lines = chunks.map((c) => `[${fmtTime(c.start_time)}] ${c.text}`).join('\n\n')
      const D = '─'.repeat(52)
      const header = [`Aapki Pathshaala | आपकी पाठशाला`, `Video: ${title}`,
        `Date:  ${new Date().toLocaleDateString('en-IN', { dateStyle: 'long' })}`, D].join('\n')
      let body = `TRANSCRIPT\n${'─'.repeat(12)}\n\n${lines}`
      if (language === 'hi') {
        const { translation } = await translateTranscript(lines, 'en')
        body += `\n\n${D}\n\nENGLISH TRANSLATION\n${'─'.repeat(20)}\n\n${translation}`
      }
      const content = `${header}\n\n${body}\n\n${D}\nGenerated by Aapki Pathshaala | आपकी पाठशाला`
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
      const a = Object.assign(document.createElement('a'), {
        href: URL.createObjectURL(blob), download: `transcript-${slugify(title)}.txt`,
      })
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      URL.revokeObjectURL(a.href)
    } catch (err) { console.error('Download failed:', err) }
    finally { setIsDownloading(false) }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div ref={panelRef} className="flex flex-col h-full bg-white min-w-0" style={{ borderRight: '1px solid #e5e7eb' }}>

      {/* ── Video player (user-resizable height) ───────────────────────── */}
      <div
        className="relative flex-shrink-0 w-full bg-black overflow-hidden"
        style={{ height: `${videoHeight}px`, minHeight: '160px' }}
      >
        {youtubeId ? (
          <iframe
            ref={iframeRef}
            src={buildSrc(youtubeId)}
            title="YouTube video player"
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 'none' }}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-7xl opacity-20">▶</div>
          </div>
        )}
      </div>

      {/* ── Drag handle — grab to resize video vs transcript ───────────── */}
      <div
        className="flex-shrink-0 h-3 bg-gray-100 hover:bg-indigo-50 cursor-row-resize
                   flex items-center justify-center border-y border-gray-200 group select-none"
        onMouseDown={startDrag}
        onTouchStart={startDrag}
        title="Drag to resize"
      >
        <div className="w-8 h-1 rounded-full bg-gray-300 group-hover:bg-indigo-400 transition-colors" />
      </div>

      {/* Chapter timeline */}
      {chapters?.length > 0 && (
        <ChapterTimeline chapters={chapters} currentTime={currentTime} onSeek={onSeek} />
      )}

      {/* ── Transcript panel ─────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-h-0 relative">
        <div className="px-3 py-2 border-b border-gray-100 bg-gray-50 flex items-center gap-2 flex-shrink-0 min-w-0">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex-shrink-0">
            {language === 'hi' ? 'ट्रांसक्रिप्ट' : 'Transcript'}
          </h2>

          {isLoading && (
            <span className="text-xs text-indigo-600 flex items-center gap-1.5 min-w-0 flex-1">
              <span className="w-2 h-2 rounded-full bg-indigo-400 animate-ping flex-shrink-0" />
              <span className="truncate">{loadingStatus || (language === 'hi' ? 'प्रोसेसिंग…' : 'Processing…')}</span>
            </span>
          )}

          {/* Spacer */}
          {!isLoading && <span className="flex-1" />}

          {/* Transcript language dropdown */}
          {!isLoading && chunks.length > 0 && (
            <div className="flex items-center gap-1.5 flex-shrink-0">
              {isTranslating && (
                <span className="w-3 h-3 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />
              )}
              <select
                value={transcriptLang}
                onChange={e => handleTranscriptLangChange(e.target.value)}
                disabled={isTranslating}
                className="text-xs border border-gray-300 rounded-md px-1.5 py-0.5 bg-white
                           text-gray-700 focus:outline-none focus:ring-1 focus:ring-indigo-400
                           cursor-pointer disabled:opacity-50"
              >
                <option value="original">Original</option>
                <option value="en">English</option>
                <option value="hi">Hindi / हिंदी</option>
                <option value="simple_en">Simple English ✨</option>
              </select>
            </div>
          )}

          {/* Download */}
          {!isLoading && chunks.length > 0 && (
            <button
              onClick={handleDownload}
              disabled={isDownloading}
              className="flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold
                         text-white transition-all disabled:opacity-60 flex-shrink-0"
              style={{ backgroundColor: isDownloading ? '#9a3412' : '#F97316' }}
              title={language === 'hi' ? 'ट्रांसक्रिप्ट डाउनलोड करें' : 'Download transcript'}
            >
              {isDownloading
                ? <><span className="w-2.5 h-2.5 border-2 border-white border-t-transparent rounded-full animate-spin" /> {language === 'hi' ? 'डाउनलोड…' : 'Saving…'}</>
                : <>📥</>
              }
            </button>
          )}
        </div>

        {/* Translation progress bar — slim gradient bar below header */}
        {isTranslating && (
          <div className="h-0.5 bg-gray-100 flex-shrink-0 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-indigo-500 via-purple-400 to-orange-400"
              style={{ animation: 'translationProgress 20s ease-out forwards' }}
            />
          </div>
        )}

        <div ref={transcriptRef} className="flex-1 overflow-y-auto scrollbar-thin relative">
          {/* Translation loading overlay — covers the transcript while translating */}
          {isTranslating && <TranslationLoadingOverlay funFacts={funFacts} />}

          {isLoading && chunks.length === 0 ? (
            <TranscriptSkeleton />
          ) : chunks.length === 0 ? (
            <div className="flex items-center justify-center h-full text-gray-400 text-sm px-4 text-center">
              {language === 'hi'
                ? 'वीडियो लोड होने के बाद ट्रांसक्रिप्ट यहाँ दिखेगी'
                : 'Transcript will appear here after loading a video'}
            </div>
          ) : (
            <div className="py-1 fade-in">
              {visibleChunks.map((chunk, idx) => {
                const isActive = idx === activeIdx
                return (
                  <button
                    key={chunk.chunk_id ?? idx}
                    data-chunk={idx}
                    onClick={() => onSeek(chunk.start_time)}
                    className={[
                      'w-full text-left flex gap-3 px-4 py-2.5 border-l-4 transition-colors duration-200',
                      animateChunks ? 'transcript-line-in' : '',
                      isActive ? 'bg-yellow-50 border-yellow-400' : 'border-transparent hover:bg-gray-50',
                    ].join(' ')}
                    style={animateChunks ? { animationDelay: `${idx * 50}ms` } : {}}
                  >
                    <span className={[
                      'flex-shrink-0 text-xs font-mono mt-0.5 w-10 transition-colors duration-200',
                      isActive ? 'text-yellow-600 font-bold' : 'text-gray-400',
                    ].join(' ')}>
                      {fmtTime(chunk.start_time)}
                    </span>
                    <span className={[
                      'text-sm leading-relaxed transition-colors duration-200',
                      isActive ? 'text-gray-900 font-semibold' : 'text-gray-600',
                    ].join(' ')}>
                      {chunk.text}
                    </span>
                    {isActive && (
                      <span className="flex-shrink-0 ml-auto self-start mt-0.5">
                        <span className="w-2 h-2 rounded-full bg-yellow-400 inline-block animate-pulse" />
                      </span>
                    )}
                  </button>
                )
              })}
              {isLoading && (
                <div className="flex gap-3 px-4 py-3 animate-pulse">
                  <div className="skeleton w-10 h-3 flex-shrink-0 rounded mt-1" />
                  <div className="flex-1 space-y-2">
                    <div className="skeleton h-3 rounded w-4/5" />
                    <div className="skeleton h-3 rounded w-3/5" />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
