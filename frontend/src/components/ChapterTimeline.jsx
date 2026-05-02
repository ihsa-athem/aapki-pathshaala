import React from 'react'

export default function ChapterTimeline({ chapters, currentTime, onSeek }) {
  if (!chapters.length) return null

  // Find active chapter = highest-index chapter whose start_time <= currentTime
  const activeIdx = chapters.reduce(
    (acc, ch, i) => (currentTime >= ch.start_time ? i : acc),
    -1
  )

  return (
    <div className="flex items-start overflow-x-auto scrollbar-thin bg-white border-b border-gray-100 px-3 py-2 gap-0 fade-in">
      {chapters.map((ch, i) => {
        const isPast = i <= activeIdx
        const isActive = i === activeIdx
        const isLast = i === chapters.length - 1

        return (
          <React.Fragment key={i}>
            <button
              onClick={() => onSeek(ch.start_time)}
              className="flex flex-col items-center gap-1 flex-shrink-0 group px-1 min-w-[64px] max-w-[90px]"
              title={ch.title}
            >
              {/* Dot */}
              <div
                className={[
                  'w-3 h-3 rounded-full transition-all duration-300',
                  isActive
                    ? 'bg-orange-500 ring-2 ring-orange-300 scale-125'
                    : isPast
                    ? 'bg-indigo-500 group-hover:bg-indigo-400'
                    : 'bg-gray-300 group-hover:bg-gray-400',
                ].join(' ')}
              />
              {/* Label */}
              <span
                className={[
                  'text-[10px] text-center leading-tight line-clamp-2 w-full transition-colors',
                  isActive ? 'text-orange-600 font-semibold' : isPast ? 'text-indigo-600' : 'text-gray-400',
                ].join(' ')}
              >
                {ch.title}
              </span>
              {/* Timestamp */}
              <span className="text-[9px] text-gray-400">{ch.timestamp}</span>
            </button>

            {/* Connecting line */}
            {!isLast && (
              <div className="flex-shrink-0 self-start mt-[5px] mx-0.5">
                <div
                  className={[
                    'h-0.5 w-6 transition-colors duration-300',
                    isPast && activeIdx > i ? 'bg-indigo-400' : 'bg-gray-200',
                  ].join(' ')}
                />
              </div>
            )}
          </React.Fragment>
        )
      })}
    </div>
  )
}
