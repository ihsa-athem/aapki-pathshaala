import React from 'react'

function parseSeconds(timeStr) {
  const parts = timeStr.split(':').map(Number)
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  return 0
}

export default function TimestampBadge({ start, end, onSeek }) {
  const label = end ? `${start}–${end}` : start
  const seconds = parseSeconds(start)

  return (
    <button
      onClick={() => onSeek?.(seconds)}
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold
                 bg-orange-500 text-white hover:bg-orange-600 active:scale-95
                 transition-all mx-0.5 shadow-sm"
      title={`Jump to ${label}`}
    >
      ▶ {label}
    </button>
  )
}

/**
 * Renders message text with [mm:ss–mm:ss] patterns replaced by clickable TimestampBadge chips.
 */
export function MessageWithTimestamps({ content, onSeek }) {
  // Match [2:30–3:15], [2:30], [2:30-3:15]
  const PATTERN = /\[(\d+:\d+)(?:[–\-](\d+:\d+))?\]/g
  const parts = []
  let last = 0
  let match

  while ((match = PATTERN.exec(content)) !== null) {
    if (match.index > last) {
      parts.push({ type: 'text', value: content.slice(last, match.index) })
    }
    parts.push({ type: 'ts', start: match[1], end: match[2] || null })
    last = match.index + match[0].length
  }
  if (last < content.length) {
    parts.push({ type: 'text', value: content.slice(last) })
  }

  return (
    <span>
      {parts.map((p, i) =>
        p.type === 'text' ? (
          <span key={i} style={{ whiteSpace: 'pre-wrap' }}>{p.value}</span>
        ) : (
          <TimestampBadge key={i} start={p.start} end={p.end} onSeek={onSeek} />
        )
      )}
    </span>
  )
}
