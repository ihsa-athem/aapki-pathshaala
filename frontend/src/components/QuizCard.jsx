import React, { useEffect, useRef, useState } from 'react'
import TimestampBadge from './TimestampBadge'

// ── Confetti (loaded once from CDN on first correct answer) ─────────────────

let confettiLoading = false
let confettiReady = false

function loadConfetti() {
  if (confettiReady || confettiLoading) return
  confettiLoading = true
  const script = document.createElement('script')
  script.src = 'https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.2/dist/confetti.browser.min.js'
  script.onload = () => { confettiReady = true }
  document.head.appendChild(script)
}

function fireConfetti() {
  if (!window.confetti) return
  window.confetti({
    particleCount: 90,
    spread: 70,
    origin: { y: 0.55 },
    colors: ['#3730a3', '#f97316', '#fbbf24', '#34d399', '#818cf8'],
  })
}

// ── Feedback messages ────────────────────────────────────────────────────────

const CORRECT = [
  'शाबाश! 🌟',
  'Excellent! 🎉',
  'बहुत बढ़िया! 💪',
  'Perfect! Keep it up! ⭐',
  'वाह! बिल्कुल सही! 🥳',
  'Spot on! Great work! 🙌',
]
const WRONG = [
  'Almost! Try again 💙',
  'कोई बात नहीं, फिर कोशिश करो 🌱',
  "Don't give up! 💪",
  'हिम्मत रखो! 🌟',
  'Close — check the explanation below 👇',
  'हर गलती से सीखते हैं! 📖',
]

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)]

// ── Score card shown after all questions ─────────────────────────────────────

function ScoreCard({ questions, answers, language, onClose }) {
  const correct = questions.filter((q, i) => answers[i] === q.correct).length
  const total   = questions.length
  const pct     = (correct / total) * 100

  const getMessage = () => {
    if (language === 'hi') {
      if (pct === 100) return 'शानदार! आपने सब कुछ सही किया! 🏆'
      if (pct >= 80)  return 'बहुत अच्छा! आप लगभग परफेक्ट हैं! ⭐'
      if (pct >= 60)  return 'अच्छा प्रयास! थोड़ी और मेहनत करें! 👍'
      return 'हार मत मानो! वीडियो फिर से देखें और कोशिश करें! 💪'
    }
    if (pct === 100) return 'Perfect score! You nailed it! 🏆'
    if (pct >= 80)   return 'Great job! Almost there! ⭐'
    if (pct >= 60)   return 'Good effort! Keep it up! 👍'
    return "Don't give up! Re-watch the video and try again! 💪"
  }

  return (
    <div className="mx-1 rounded-2xl overflow-hidden shadow-lg">
      <div className="bg-gradient-to-br from-indigo-700 to-indigo-900 p-5 text-white text-center">
        <div className="text-5xl mb-2">{pct === 100 ? '🏆' : pct >= 60 ? '⭐' : '📚'}</div>
        <h3 className="text-2xl font-bold">
          {language === 'hi'
            ? `आपने ${correct}/${total} सही किए!`
            : `You got ${correct}/${total} correct!`}
        </h3>
        <p className="text-indigo-200 text-sm mt-1">{getMessage()}</p>
        <div className="flex justify-center gap-2 mt-3">
          {questions.map((q, i) => (
            <div
              key={i}
              className={`w-3 h-3 rounded-full border-2 border-white ${
                answers[i] === q.correct ? 'bg-green-400' : 'bg-red-400'
              }`}
            />
          ))}
        </div>
      </div>
      <div className="bg-white px-4 py-3 text-center">
        <button
          onClick={onClose}
          className="px-6 py-2 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-semibold text-sm transition-colors"
        >
          {language === 'hi' ? 'चैट पर वापस जाएं' : 'Back to Chat'}
        </button>
      </div>
    </div>
  )
}

// ── Single question card ──────────────────────────────────────────────────────

export default function QuizCard({ quiz, onAnswer, onNext, onClose, onSeekTo, language }) {
  const { questions, current, answers } = quiz
  const q        = questions[current]
  const selected = answers[current]
  const answered = selected !== undefined
  const isLast   = current === questions.length - 1

  const [feedback, setFeedback] = useState(null)

  // Preload confetti script as soon as quiz mounts
  useEffect(() => { loadConfetti() }, [])

  // Reset feedback when question changes
  useEffect(() => { setFeedback(null) }, [current])

  // Fire feedback + confetti when an answer is recorded
  useEffect(() => {
    if (selected === undefined) return
    if (selected === q.correct) {
      setFeedback({ correct: true,  msg: pick(CORRECT) })
      // Short delay so the option colour renders first
      setTimeout(fireConfetti, 150)
    } else {
      setFeedback({ correct: false, msg: pick(WRONG) })
    }
  }, [selected]) // eslint-disable-line react-hooks/exhaustive-deps

  const optionStyle = (letter) => {
    const base = 'w-full text-left flex items-start gap-3 p-3 rounded-xl border-2 text-sm transition-all duration-150'
    if (!answered)         return `${base} border-gray-200 hover:border-indigo-400 hover:bg-indigo-50 cursor-pointer`
    if (letter === q.correct) return `${base} border-green-500 bg-green-50 text-green-800 font-medium`
    if (letter === selected)  return `${base} border-red-400 bg-red-50 text-red-700`
    return `${base} border-gray-100 text-gray-400`
  }

  const optionBadge = (letter) => {
    if (!answered)            return 'bg-indigo-100 text-indigo-700'
    if (letter === q.correct) return 'bg-green-500 text-white'
    if (letter === selected)  return 'bg-red-400 text-white'
    return 'bg-gray-100 text-gray-400'
  }

  return (
    <div className="mx-1 rounded-2xl overflow-hidden shadow-lg border border-indigo-100">
      {/* Header */}
      <div className="bg-gradient-to-r from-indigo-700 to-indigo-600 px-4 py-3 text-white">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-indigo-200">
            {language === 'hi' ? 'प्रश्नोत्तरी' : 'Quiz Time'}
          </span>
          <span className="text-xs font-bold bg-indigo-800 px-2 py-0.5 rounded-full">
            {current + 1} / {questions.length}
          </span>
        </div>
        <div className="w-full bg-indigo-800 rounded-full h-1.5">
          <div
            className="bg-orange-400 h-1.5 rounded-full transition-all duration-500"
            style={{ width: `${((current + (answered ? 1 : 0)) / questions.length) * 100}%` }}
          />
        </div>
      </div>

      {/* Body */}
      <div className="bg-white px-4 pt-4 pb-3">
        <p className="font-semibold text-gray-900 text-sm leading-snug mb-4">{q.question}</p>

        {/* Options */}
        <div className="space-y-2">
          {Object.entries(q.options).map(([letter, text]) => (
            <button
              key={letter}
              onClick={() => !answered && onAnswer(letter)}
              disabled={answered}
              className={optionStyle(letter)}
            >
              <span className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${optionBadge(letter)}`}>
                {letter}
              </span>
              <span className="flex-1">{text}</span>
              {answered && letter === q.correct && <span className="ml-auto text-green-600 flex-shrink-0 font-bold">✓</span>}
              {answered && letter === selected && letter !== q.correct && <span className="ml-auto text-red-500 flex-shrink-0 font-bold">✗</span>}
            </button>
          ))}
        </div>

        {/* Feedback message — appears right after answering */}
        {feedback && (
          <div
            className={`mt-3 px-4 py-2.5 rounded-xl text-sm font-semibold text-center fade-in ${
              feedback.correct
                ? 'bg-green-100 text-green-800 border border-green-200'
                : 'bg-blue-50 text-blue-700 border border-blue-200'
            }`}
          >
            {feedback.msg}
          </div>
        )}

        {/* Explanation */}
        {answered && (
          <div className="mt-2 bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-900">
            <p className="leading-relaxed">{q.explanation}</p>
            {q.timestamp && (
              <div className="mt-1.5">
                <TimestampBadge start={q.timestamp} onSeek={onSeekTo} />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      {answered && (
        <div className="bg-gray-50 border-t border-gray-100 px-4 py-3 flex justify-end">
          <button
            onClick={() => onNext(isLast)}
            className="px-5 py-2 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold transition-colors flex items-center gap-1.5"
          >
            {isLast
              ? (language === 'hi' ? 'परिणाम देखें' : 'See Results')
              : (language === 'hi' ? 'अगला प्रश्न' : 'Next Question')}
            <span>{isLast ? '🏁' : '→'}</span>
          </button>
        </div>
      )}
    </div>
  )
}

export { ScoreCard }
