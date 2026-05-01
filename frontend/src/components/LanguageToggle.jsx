import React from 'react'

export default function LanguageToggle({ language, onChange }) {
  return (
    <div className="flex items-center bg-indigo-800 rounded-lg p-0.5 flex-shrink-0">
      <button
        onClick={() => onChange('en')}
        className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
          language === 'en'
            ? 'bg-white text-indigo-700 shadow-sm'
            : 'text-indigo-200 hover:text-white'
        }`}
      >
        EN
      </button>
      <button
        onClick={() => onChange('hi')}
        className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
          language === 'hi'
            ? 'bg-white text-indigo-700 shadow-sm'
            : 'text-indigo-200 hover:text-white'
        }`}
      >
        हि
      </button>
    </div>
  )
}
