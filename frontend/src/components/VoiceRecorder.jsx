import React, { useRef, useState } from 'react'

export default function VoiceRecorder({ onRecordingComplete, disabled }) {
  const [isRecording, setIsRecording] = useState(false)
  const mediaRecorderRef = useRef(null)
  const chunksRef = useRef([])

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      chunksRef.current = []
      const mr = new MediaRecorder(stream)
      mediaRecorderRef.current = mr

      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        onRecordingComplete(blob)
        stream.getTracks().forEach((t) => t.stop())
      }

      mr.start()
      setIsRecording(true)
    } catch {
      alert('Microphone access denied. Please allow microphone access.')
    }
  }

  const stop = () => {
    mediaRecorderRef.current?.stop()
    setIsRecording(false)
  }

  return (
    <button
      onClick={isRecording ? stop : start}
      disabled={disabled}
      title={isRecording ? 'Stop recording' : 'Ask by voice'}
      className={[
        'relative flex items-center justify-center w-10 h-10 rounded-full text-white',
        'transition-all duration-200 flex-shrink-0',
        isRecording
          ? 'bg-red-500 shadow-lg shadow-red-400/60 animate-pulse-fast scale-110'
          : 'bg-indigo-600 hover:bg-indigo-700 hover:scale-105',
        disabled ? 'opacity-40 cursor-not-allowed' : '',
      ].join(' ')}
    >
      {isRecording ? (
        <span className="text-lg">⏹</span>
      ) : (
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 1a4 4 0 0 1 4 4v7a4 4 0 0 1-8 0V5a4 4 0 0 1 4-4zm-1 18.93V21H9v2h6v-2h-2v-1.07A8 8 0 0 0 20 12h-2a6 6 0 0 1-12 0H4a8 8 0 0 0 7 7.93z" />
        </svg>
      )}
      {isRecording && (
        <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-red-400 border-2 border-white animate-ping" />
      )}
    </button>
  )
}
