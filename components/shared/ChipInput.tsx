'use client'

import { useState, useRef, KeyboardEvent } from 'react'

interface ChipInputProps {
  values: string[]
  onChange: (values: string[]) => void
  placeholder?: string
  validate?: (raw: string) => string | null
  className?: string
}

export default function ChipInput({
  values,
  onChange,
  placeholder,
  validate,
  className = '',
}: ChipInputProps) {
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const commit = (raw: string) => {
    const cleaned = raw.trim()
    if (!cleaned) return
    const valid = validate ? validate(cleaned) : cleaned
    if (!valid) {
      setError('Invalid value')
      return
    }
    if (values.includes(valid)) {
      setDraft('')
      return
    }
    onChange([...values, valid])
    setDraft('')
    setError(null)
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
      e.preventDefault()
      commit(draft)
    } else if (e.key === 'Backspace' && draft === '' && values.length > 0) {
      onChange(values.slice(0, -1))
    }
  }

  const removeChip = (idx: number) => {
    onChange(values.filter((_, i) => i !== idx))
    setError(null)
  }

  return (
    <div className={className}>
      <div
        className="flex flex-wrap gap-1 px-2 py-1.5 border border-stone-300 rounded-lg bg-white focus-within:ring-2 focus-within:ring-stone-400 focus-within:border-stone-400 cursor-text min-h-[38px]"
        onClick={() => inputRef.current?.focus()}
      >
        {values.map((v, i) => (
          <span
            key={`${v}-${i}`}
            className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-stone-100 text-stone-700 rounded"
          >
            {v}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); removeChip(i) }}
              className="text-stone-400 hover:text-stone-700"
              aria-label={`Remove ${v}`}
            >
              <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={(e) => { setDraft(e.target.value); setError(null) }}
          onKeyDown={handleKeyDown}
          onBlur={() => { if (draft) commit(draft) }}
          onPaste={(e) => {
            const text = e.clipboardData.getData('text')
            if (text.includes(',') || text.includes(' ')) {
              e.preventDefault()
              const next = [...values]
              text.split(/[,\s]+/).forEach((raw) => {
                const cleaned = raw.trim()
                if (!cleaned) return
                const valid = validate ? validate(cleaned) : cleaned
                if (valid && !next.includes(valid)) next.push(valid)
              })
              onChange(next)
              setDraft('')
            }
          }}
          placeholder={values.length === 0 ? placeholder : ''}
          className="flex-1 min-w-[80px] outline-none text-sm bg-transparent"
        />
      </div>
      {error && <p className="text-[10px] text-red-600 mt-1">{error}</p>}
    </div>
  )
}
