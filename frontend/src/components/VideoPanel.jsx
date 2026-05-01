import React, { useEffect, useRef, useState } from 'react'

function fmtTime(s) {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

function TranscriptSkeleton() {
  return (
    <div className="space-y-3 p-4 animate-pulse">
      {[100, 80, 90, 70, 85].map((w, i) => (
        <div key={i} className="flex gap-3">
          <div className="w-12 h-4 bg-indigo-100 rounded flex-shrink-0" />
          <div className="flex-1 h-4 bg-gray-200 rounded" style={{ width: `${w}%` }} />
        </div>
      ))}
    </div>
  )
}

export default function VideoPanel({ youtubeId, chunks, isLoading, language, onSeek, playerRef }) {
  const containerRef = useRef(null)
  const playerInstanceRef = useRef(null)
  const timerRef = useRef(null)
  const [currentTime, setCurrentTime] = useState(0)
  const transcriptRef = useRef(null)

  // Load and init YouTube IFrame Player
  useEffect(() => {
    if (!youtubeId) return

    const initPlayer = () => {
      if (playerInstanceRef.current) {
        try { playerInstanceRef.current.destroy() } catch {}
      }
      if (!containerRef.current) return

      playerInstanceRef.current = new window.YT.Player(containerRef.current, {
        videoId: youtubeId,
        height: '100%',
        width: '100%',
        playerVars: { rel: 0, modestbranding: 1, iv_load_policy: 3 },
        events: {
          onReady: () => {
            playerRef.current = {
              seekTo: (s, a) => playerInstanceRef.current?.seekTo(s, a),
            }
            timerRef.current = setInterval(() => {
              try {
                const t = playerInstanceRef.current?.getCurrentTime?.() ?? 0
                setCurrentTime(t)
              } catch {}
            }, 500)
          },
        },
      })
    }

    if (window.YT?.Player) {
      initPlayer()
    } else {
      if (!document.getElementById('yt-iframe-api')) {
        const script = document.createElement('script')
        script.id = 'yt-iframe-api'
        script.src = 'https://www.youtube.com/iframe_api'
        document.head.appendChild(script)
      }
      window.onYouTubeIframeAPIReady = initPlayer
    }

    return () => {
      clearInterval(timerRef.current)
      try { playerInstanceRef.current?.destroy() } catch {}
      playerInstanceRef.current = null
      playerRef.current = null
    }
  }, [youtubeId, playerRef])

  // Auto-scroll active transcript chunk into view
  const activeIdx = chunks.findIndex(
    (c) => currentTime >= c.start_time && currentTime <= c.end_time
  )
  useEffect(() => {
    if (activeIdx >= 0 && transcriptRef.current) {
      const el = transcriptRef.current.querySelector(`[data-chunk="${activeIdx}"]`)
      el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [activeIdx])

  const emptyLabel = language === 'hi' ? 'वीडियो URL डालें और "लोड करें" दबाएं' : 'Paste a YouTube URL above and click "Load Video"'

  return (
    <div className="flex flex-col h-full border-r border-gray-200 bg-white min-w-0">
      {/* Video player */}
      <div className="relative bg-black flex-shrink-0" style={{ paddingBottom: '56.25%', height: 0 }}>
        {youtubeId ? (
          <div ref={containerRef} className="absolute inset-0" />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400">
            <span className="text-5xl mb-3">🎓</span>
            <p className="text-sm text-center px-4">{emptyLabel}</p>
          </div>
        )}
      </div>

      {/* Transcript panel */}
      <div className="flex-1 flex flex-col min-h-0">
        <div className="px-4 py-2 border-b border-gray-100 bg-gray-50 flex items-center justify-between flex-shrink-0">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            {language === 'hi' ? 'ट्रांसक्रिप्ट' : 'Transcript'}
          </h2>
          {chunks.length > 0 && (
            <span className="text-xs text-gray-400">{chunks.length} segments</span>
          )}
        </div>

        <div ref={transcriptRef} className="flex-1 overflow-y-auto scrollbar-thin">
          {isLoading ? (
            <TranscriptSkeleton />
          ) : chunks.length === 0 ? (
            <div className="flex items-center justify-center h-full text-gray-400 text-sm px-4 text-center">
              {language === 'hi'
                ? 'वीडियो लोड होने के बाद ट्रांसक्रिप्ट यहाँ दिखेगी'
                : 'Transcript will appear here after loading a video'}
            </div>
          ) : (
            <div className="py-2">
              {chunks.map((chunk, idx) => {
                const isActive = idx === activeIdx
                return (
                  <button
                    key={chunk.chunk_id ?? idx}
                    data-chunk={idx}
                    onClick={() => onSeek(chunk.start_time)}
                    className={[
                      'w-full text-left flex gap-3 px-4 py-2 transition-colors',
                      isActive
                        ? 'bg-indigo-50 border-l-4 border-indigo-600'
                        : 'hover:bg-gray-50 border-l-4 border-transparent',
                    ].join(' ')}
                  >
                    <span
                      className={[
                        'flex-shrink-0 text-xs font-mono mt-0.5 w-10',
                        isActive ? 'text-indigo-600 font-semibold' : 'text-gray-400',
                      ].join(' ')}
                    >
                      {fmtTime(chunk.start_time)}
                    </span>
                    <span
                      className={[
                        'text-sm leading-relaxed',
                        isActive ? 'text-indigo-900 font-medium' : 'text-gray-700',
                      ].join(' ')}
                    >
                      {chunk.text}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
