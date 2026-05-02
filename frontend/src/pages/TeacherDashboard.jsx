import React, { useRef, useState } from 'react'
import { loadVideo, generateLessonPack } from '../api'

// ── Collapsible section card ──────────────────────────────────────────────────

function Section({ id, icon, title, open, onToggle, children }) {
  return (
    <div className="print-card bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
      <button
        onClick={onToggle}
        className="no-print w-full flex items-center justify-between px-6 py-4
                   hover:bg-gray-50 transition-colors"
      >
        <span className="flex items-center gap-2.5 text-base font-semibold text-gray-900">
          <span className="text-xl">{icon}</span>
          {title}
        </span>
        <svg
          className={`w-5 h-5 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {/* Section header shown in print even if collapsed on screen */}
      <div className="hidden print:block px-6 py-3 border-b border-gray-200">
        <span className="flex items-center gap-2 text-base font-semibold text-gray-900">
          <span>{icon}</span> {title}
        </span>
      </div>
      {open && <div className="px-6 pb-6 pt-1 border-t border-gray-100">{children}</div>}
    </div>
  )
}

// ── Lesson plan ───────────────────────────────────────────────────────────────

function LessonPlan({ data, title }) {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-3 text-sm">
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-100 text-indigo-800 font-medium">
          🎓 {data.grade_level}
        </span>
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-gray-100 text-gray-700 font-medium">
          📹 {title}
        </span>
      </div>

      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
          Learning Objectives
        </h4>
        <ul className="space-y-1.5">
          {data.learning_objectives.map((obj, i) => (
            <li key={i} className="flex gap-2 text-sm text-gray-700">
              <span className="text-indigo-500 font-bold mt-0.5">•</span>
              <span>{obj}</span>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
          Key Concepts
        </h4>
        <div className="flex flex-wrap gap-2">
          {data.key_concepts.map((c, i) => (
            <span key={i} className="px-2.5 py-1 bg-indigo-50 border border-indigo-200 text-indigo-800 rounded-lg text-sm font-medium">
              {c}
            </span>
          ))}
        </div>
      </div>

      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
          Discussion Questions
        </h4>
        <ol className="space-y-2">
          {data.discussion_questions.map((q, i) => (
            <li key={i} className="flex gap-2.5 text-sm text-gray-700">
              <span className="flex-shrink-0 w-5 h-5 rounded-full bg-orange-100 text-orange-700 font-bold text-xs flex items-center justify-center mt-0.5">
                {i + 1}
              </span>
              <span>{q}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}

// ── Quiz bank ─────────────────────────────────────────────────────────────────

function QuizBank({ questions }) {
  return (
    <div className="space-y-5">
      {questions.map((q, i) => (
        <div key={i} className="quiz-item p-4 border border-gray-200 rounded-xl">
          <p className="font-semibold text-gray-900 text-sm mb-3">
            <span className="text-indigo-600 font-bold mr-1">{i + 1}.</span>
            {q.question}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
            {Object.entries(q.options).map(([letter, text]) => {
              const isCorrect = letter === q.correct
              return (
                <div
                  key={letter}
                  className={`flex items-start gap-2 p-2.5 rounded-lg text-sm border ${
                    isCorrect
                      ? 'bg-green-50 border-green-300 text-green-800'
                      : 'bg-gray-50 border-gray-200 text-gray-700'
                  }`}
                >
                  <span className={`flex-shrink-0 w-5 h-5 rounded-full text-xs font-bold flex items-center justify-center ${
                    isCorrect ? 'bg-green-500 text-white' : 'bg-gray-300 text-gray-600'
                  }`}>{letter}</span>
                  <span className="flex-1">{text}</span>
                  {isCorrect && <span className="flex-shrink-0 text-green-600 font-bold">✓</span>}
                </div>
              )
            })}
          </div>
          <div className="text-xs text-gray-500 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
            <span className="font-semibold text-amber-700">Explanation: </span>
            {q.explanation}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Vocabulary list ───────────────────────────────────────────────────────────

function VocabularyList({ items }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-indigo-700 text-white">
            <th className="text-left px-4 py-2.5 rounded-tl-lg font-semibold">Word</th>
            <th className="text-left px-4 py-2.5 font-semibold">English Definition</th>
            <th className="text-left px-4 py-2.5 rounded-tr-lg font-semibold">Hindi — परिभाषा</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, i) => (
            <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
              <td className="px-4 py-3 font-semibold text-indigo-800 border-b border-gray-100">
                {item.word}
              </td>
              <td className="px-4 py-3 text-gray-700 border-b border-gray-100">
                {item.definition_en}
              </td>
              <td className="px-4 py-3 text-gray-700 border-b border-gray-100">
                {item.definition_hi}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Progress step indicator ───────────────────────────────────────────────────

function ProgressBar({ step, total, message }) {
  const pct = total > 0 ? Math.round((step / total) * 100) : 0
  return (
    <div className="space-y-2">
      <div className="flex justify-between text-sm text-gray-600">
        <span>{message}</span>
        {total > 0 && <span>{pct}%</span>}
      </div>
      <div className="w-full bg-gray-200 rounded-full h-2">
        <div
          className="bg-indigo-600 h-2 rounded-full transition-all duration-500"
          style={{ width: total > 0 ? `${pct}%` : '100%', animation: total === 0 ? 'shimmer 1.4s infinite' : 'none' }}
        />
      </div>
    </div>
  )
}

// ── Main dashboard ────────────────────────────────────────────────────────────

export default function TeacherDashboard() {
  const [videoUrl, setVideoUrl]     = useState('')
  const [status, setStatus]         = useState('')        // SSE progress message
  const [segProgress, setSegProgress] = useState({ current: 0, total: 0 })
  const [isLoading, setIsLoading]   = useState(false)
  const [pack, setPack]             = useState(null)
  const [error, setError]           = useState('')
  const [copied, setCopied]         = useState(false)
  const [openSections, setOpenSections] = useState({
    lesson_plan: true, quiz_bank: true, vocabulary: true, summary: true,
  })
  const printRef = useRef(null)

  const toggle = (key) => setOpenSections((p) => ({ ...p, [key]: !p[key] }))

  const handleGenerate = async () => {
    const url = videoUrl.trim()
    if (!url || isLoading) return
    setIsLoading(true)
    setError('')
    setPack(null)
    setStatus('⬇️ Downloading audio...')
    setSegProgress({ current: 0, total: 0 })

    let videoId = null
    let loadErr = null   // captured here because onError throw is swallowed by loadVideo's catch{}

    try {
      // Step 1: transcribe the video (reuse existing SSE endpoint)
      await loadVideo(url, {
        onStatus: (msg) => {
          setStatus(msg)
          const m = msg.match(/part (\d+) of (\d+)/)
          if (m) setSegProgress({ current: parseInt(m[1]), total: parseInt(m[2]) })
        },
        onChunk: () => {},   // teacher view doesn't display transcript
        onCached: (vid)       => { videoId = vid },
        onDone:   (vid)       => { videoId = vid },
        onError:  (err)       => { loadErr = err },
      })

      if (loadErr) throw loadErr
      if (!videoId) throw new Error('Video processing returned no ID — the URL may be invalid or the video has no speech')

      // Step 2: generate lesson pack via Claude
      setStatus('🤖 Generating lesson plan, quiz, vocabulary, and summary...')
      setSegProgress({ current: 0, total: 0 })
      const result = await generateLessonPack(videoId)
      setPack(result)
      setStatus('')
    } catch (err) {
      setError(err.message || 'Generation failed')
    } finally {
      setIsLoading(false)
    }
  }

  const handleExportPDF = () => {
    // Open all sections so they print
    setOpenSections({ lesson_plan: true, quiz_bank: true, vocabulary: true, summary: true })
    setTimeout(() => window.print(), 120)
  }

  const handleShare = () => {
    const shareUrl = `${window.location.origin}/?video=${encodeURIComponent(videoUrl)}`
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    })
  }

  return (
    <div className="min-h-screen bg-gray-50 teacher-print-root" style={{ fontFamily: "'Segoe UI', system-ui, sans-serif" }}>

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="no-print bg-indigo-700 text-white shadow-lg">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">👩‍🏫</span>
            <div className="leading-tight">
              <p className="text-sm font-bold">Aapki Pathshaala — Teacher View</p>
              <p className="text-indigo-200 text-xs">आपकी पाठशाला</p>
            </div>
          </div>
          <a
            href="/"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-800 hover:bg-indigo-600
                       text-indigo-100 text-sm font-medium transition-colors"
          >
            ← Student View
          </a>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8 space-y-6" ref={printRef}>

        {/* ── Print-only header ─────────────────────────────────────────── */}
        <div className="hidden print:block mb-6">
          <h1 className="text-2xl font-bold text-gray-900">
            {pack?.title || 'Lesson Pack'}
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            Generated by Aapki Pathshaala | आपकी पाठशाला · {new Date().toLocaleDateString('en-IN', { dateStyle: 'long' })}
          </p>
          <hr className="mt-4 border-gray-300" />
        </div>

        {/* ── URL input card ───────────────────────────────────────────── */}
        <div className="no-print bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-1">Generate Lesson Pack</h2>
          <p className="text-sm text-gray-500 mb-4">
            Paste a YouTube lesson URL and get a complete teacher resource pack — lesson plan, quiz, vocabulary, and summary.
          </p>
          <div className="flex gap-3">
            <input
              type="url"
              className="flex-1 rounded-xl border border-gray-300 px-4 py-2.5 text-sm
                         focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:opacity-50"
              placeholder="https://www.youtube.com/watch?v=..."
              value={videoUrl}
              onChange={(e) => setVideoUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleGenerate()}
              disabled={isLoading}
            />
            <button
              onClick={handleGenerate}
              disabled={isLoading || !videoUrl.trim()}
              className="px-5 py-2.5 rounded-xl bg-indigo-700 hover:bg-indigo-800 text-white font-semibold
                         text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
            >
              {isLoading ? 'Generating…' : '⚡ Generate Lesson Pack'}
            </button>
          </div>

          {/* Progress */}
          {isLoading && status && (
            <div className="mt-4">
              <ProgressBar
                message={status}
                step={segProgress.current}
                total={segProgress.total}
              />
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="mt-3 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
              ⚠️ {error}
            </div>
          )}
        </div>

        {/* ── Action bar (shown when pack is ready) ─────────────────────── */}
        {pack && (
          <div className="no-print flex flex-wrap gap-3">
            <button
              onClick={handleExportPDF}
              className="flex items-center gap-2 px-4 py-2 rounded-xl border-2 border-indigo-700
                         text-indigo-700 hover:bg-indigo-700 hover:text-white font-semibold text-sm transition-colors"
            >
              📄 Export as PDF
            </button>
            <button
              onClick={handleShare}
              className="flex items-center gap-2 px-4 py-2 rounded-xl border-2 border-orange-500
                         text-orange-600 hover:bg-orange-500 hover:text-white font-semibold text-sm transition-colors"
            >
              {copied ? '✅ Link Copied!' : '🔗 Share with Students'}
            </button>
            {copied && (
              <p className="text-xs text-gray-500 self-center">
                Students click the link → video loads automatically in the student view.
              </p>
            )}
          </div>
        )}

        {/* ── Lesson Pack sections ─────────────────────────────────────── */}
        {pack && (
          <>
            <Section
              id="lesson_plan"
              icon="📋"
              title="Lesson Plan"
              open={openSections.lesson_plan}
              onToggle={() => toggle('lesson_plan')}
            >
              <LessonPlan data={pack.lesson_plan} title={pack.title} />
            </Section>

            <Section
              id="quiz_bank"
              icon="📝"
              title={`Quiz Bank (${pack.quiz_bank.length} questions)`}
              open={openSections.quiz_bank}
              onToggle={() => toggle('quiz_bank')}
            >
              <QuizBank questions={pack.quiz_bank} />
            </Section>

            <Section
              id="vocabulary"
              icon="📖"
              title="Vocabulary List"
              open={openSections.vocabulary}
              onToggle={() => toggle('vocabulary')}
            >
              <VocabularyList items={pack.vocabulary} />
            </Section>

            <Section
              id="summary"
              icon="📄"
              title="Video Summary"
              open={openSections.summary}
              onToggle={() => toggle('summary')}
            >
              <p className="text-sm text-gray-700 leading-relaxed">{pack.summary}</p>
            </Section>

            {/* Bottom action bar */}
            <div className="no-print flex flex-wrap gap-3 pb-8">
              <button
                onClick={handleExportPDF}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-700 hover:bg-indigo-800
                           text-white font-semibold text-sm transition-colors shadow-sm"
              >
                📄 Export as PDF
              </button>
              <button
                onClick={handleShare}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600
                           text-white font-semibold text-sm transition-colors shadow-sm"
              >
                {copied ? '✅ Copied!' : '🔗 Share with Students'}
              </button>
            </div>
          </>
        )}

        {/* ── Empty state ──────────────────────────────────────────────── */}
        {!pack && !isLoading && (
          <div className="no-print text-center py-20 text-gray-400">
            <div className="text-6xl mb-4">📚</div>
            <p className="text-lg font-medium text-gray-500">Paste a YouTube URL above to get started</p>
            <p className="text-sm mt-1">
              The app will transcribe the video and generate a complete lesson pack using AI.
            </p>
          </div>
        )}
      </main>
    </div>
  )
}
