'use client'

import { useState, useCallback } from 'react'
import type { RequirementTemplate, FormField } from '@/lib/requirements/types'

interface Attachment {
  url: string
  filename?: string
}

interface Props {
  token: string
  template: RequirementTemplate
  initialResponses: Record<string, unknown> | null
  initialAttachments: string[]
  alreadySubmitted: boolean
}

type Value = string | number | string[] | null

export default function RequirementForm({
  token,
  template,
  initialResponses,
  initialAttachments,
  alreadySubmitted,
}: Props) {
  const [values, setValues] = useState<Record<string, Value>>(() => {
    const initial: Record<string, Value> = {}
    if (initialResponses) {
      for (const [k, v] of Object.entries(initialResponses)) {
        initial[k] = (v ?? null) as Value
      }
    }
    return initial
  })
  const [attachments, setAttachments] = useState<Attachment[]>(
    initialAttachments.map(url => ({ url })),
  )
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [missing, setMissing] = useState<string[]>([])
  const [done, setDone] = useState(alreadySubmitted)
  const [uploadingField, setUploadingField] = useState<string | null>(null)
  const [autoFilled, setAutoFilled] = useState<string[]>([])

  const setField = useCallback((key: string, v: Value) => {
    setValues(prev => ({ ...prev, [key]: v }))
  }, [])

  const uploadFile = useCallback(async (field: FormField, file: File) => {
    setUploadingField(field.key)
    setError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch(`/api/requirements/access/${token}/upload`, {
        method: 'POST',
        body: form,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.message || data?.error || `Upload failed (${res.status})`)
        return
      }
      setAttachments(prev => [...prev, { url: data.url, filename: data.filename }])
      // Also record the URL under the field key so response payload references it,
      // and drop any server-extracted candidate values into empty fields.
      setValues(prev => {
        const existing = prev[field.key]
        const next = { ...prev }
        if (field.multiple) {
          const arr = Array.isArray(existing) ? existing : []
          next[field.key] = [...arr, data.url]
        } else {
          next[field.key] = data.url
        }
        const filled: string[] = []
        const extracted = data?.extracted as Record<string, string | number | null> | undefined
        if (extracted && typeof extracted === 'object') {
          for (const [k, v] of Object.entries(extracted)) {
            if (v === null || v === undefined || v === '') continue
            const current = next[k]
            const isEmpty = current === null || current === undefined || current === ''
            if (isEmpty) {
              next[k] = typeof v === 'number' ? v : String(v)
              filled.push(k)
            }
          }
        }
        if (filled.length > 0) setAutoFilled(f => Array.from(new Set([...f, ...filled])))
        return next
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploadingField(null)
    }
  }, [token])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    setMissing([])
    try {
      const res = await fetch(`/api/requirements/access/${token}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          responses: values,
          attachmentUrls: attachments.map(a => a.url),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (data?.error === 'validation' && Array.isArray(data.missing)) {
          setMissing(data.missing)
          setError(data.message || 'Please complete required fields.')
        } else {
          setError(data?.message || data?.error || `Submit failed (${res.status})`)
        }
        return
      }
      setDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submit failed')
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <div className="bg-white border border-stone-200 rounded-lg p-8 text-center">
        <div className="mx-auto w-12 h-12 rounded-full bg-emerald-50 flex items-center justify-center mb-4">
          <svg className="w-6 h-6 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-lg font-semibold text-stone-900 mb-2">Submitted</h2>
        <p className="text-sm text-stone-600">
          Thanks — your response has been sent to the prime contractor.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {template.formSchema.map(section => (
        <section key={section.title} className="bg-white border border-stone-200 rounded-lg p-5 sm:p-6">
          <h2 className="text-base font-semibold text-stone-900 mb-1">{section.title}</h2>
          {section.description && (
            <p className="text-xs text-stone-500 mb-4">{section.description}</p>
          )}
          <div className="space-y-4">
            {section.fields.map(field => (
              <FieldRenderer
                key={field.key}
                field={field}
                value={values[field.key] ?? null}
                onChange={v => {
                  setField(field.key, v)
                  if (autoFilled.includes(field.key)) {
                    setAutoFilled(f => f.filter(k => k !== field.key))
                  }
                }}
                onUpload={file => uploadFile(field, file)}
                uploading={uploadingField === field.key}
                attachments={attachments}
                highlight={missing.includes(field.label)}
                autoFilled={autoFilled.includes(field.key)}
              />
            ))}
          </div>
        </section>
      ))}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-800 text-sm rounded-md p-3">
          {error}
          {missing.length > 0 && (
            <ul className="list-disc list-inside mt-2 text-xs">
              {missing.map(m => <li key={m}>{m}</li>)}
            </ul>
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-4">
        <p className="text-xs text-stone-500">
          {attachments.length > 0 && `${attachments.length} file${attachments.length === 1 ? '' : 's'} attached`}
        </p>
        <button
          type="submit"
          disabled={submitting}
          className="bg-stone-800 hover:bg-stone-700 text-white text-sm font-medium px-5 py-2.5 rounded-md disabled:opacity-50 min-h-[44px]"
        >
          {submitting ? 'Submitting…' : 'Submit response'}
        </button>
      </div>
    </form>
  )
}

interface FieldProps {
  field: FormField
  value: Value
  onChange: (v: Value) => void
  onUpload: (file: File) => void
  uploading: boolean
  attachments: Attachment[]
  highlight: boolean
  autoFilled?: boolean
}

function FieldRenderer({ field, value, onChange, onUpload, uploading, attachments, highlight, autoFilled }: FieldProps) {
  const label = (
    <label className={`block text-sm font-medium mb-1.5 ${highlight ? 'text-red-700' : 'text-stone-800'}`}>
      {field.label}
      {field.required && <span className="text-red-500 ml-1">*</span>}
      {autoFilled && (
        <span className="ml-2 inline-block px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 text-[10px] font-medium border border-emerald-200 align-middle">
          Auto-filled — please verify
        </span>
      )}
    </label>
  )
  const help = field.helpText ? (
    <p className="text-xs text-stone-500 mt-1">{field.helpText}</p>
  ) : null

  const baseInput = `w-full border rounded-md px-3 py-2 text-sm bg-white ${
    highlight ? 'border-red-300' : 'border-stone-300'
  } focus:outline-none focus:ring-2 focus:ring-stone-400`

  if (field.type === 'textarea') {
    return (
      <div>
        {label}
        <textarea
          className={baseInput + ' min-h-[100px] resize-y'}
          placeholder={field.placeholder}
          value={typeof value === 'string' ? value : ''}
          onChange={e => onChange(e.target.value)}
        />
        {help}
      </div>
    )
  }

  if (field.type === 'select') {
    return (
      <div>
        {label}
        <select
          className={baseInput}
          value={typeof value === 'string' ? value : ''}
          onChange={e => onChange(e.target.value)}
        >
          <option value="">Select…</option>
          {(field.options ?? []).map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        {help}
      </div>
    )
  }

  if (field.type === 'file') {
    // Files uploaded via this field, matched by URL substring or presence in value
    const uploadedUrls = Array.isArray(value)
      ? value
      : typeof value === 'string' && value
        ? [value]
        : []
    return (
      <div>
        {label}
        <div className="border border-dashed border-stone-300 rounded-md p-4 bg-stone-50">
          <input
            type="file"
            accept={field.accept}
            multiple={field.multiple}
            disabled={uploading}
            onChange={e => {
              const files = Array.from(e.target.files ?? [])
              for (const file of files) onUpload(file)
              e.target.value = ''
            }}
            className="block w-full text-sm text-stone-700 file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:bg-stone-800 file:text-white file:text-xs file:font-medium hover:file:bg-stone-700"
          />
          {uploading && (
            <p className="text-xs text-stone-500 mt-2">Uploading…</p>
          )}
          {uploadedUrls.length > 0 && (
            <ul className="mt-3 space-y-1 text-xs">
              {uploadedUrls.map(url => {
                const match = attachments.find(a => a.url === url)
                const name = match?.filename ?? url.split('/').pop() ?? url
                return (
                  <li key={url} className="flex items-center gap-2">
                    <svg className="w-3.5 h-3.5 text-stone-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                            d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                    </svg>
                    <a href={url} target="_blank" rel="noopener noreferrer" className="text-stone-700 underline">
                      {name}
                    </a>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
        {help}
      </div>
    )
  }

  // text / email / phone / date / number / currency
  const htmlType =
    field.type === 'email' ? 'email'
    : field.type === 'phone' ? 'tel'
    : field.type === 'date' ? 'date'
    : field.type === 'number' || field.type === 'currency' ? 'number'
    : 'text'

  const step = field.type === 'currency' ? '0.01' : undefined

  return (
    <div>
      {label}
      <input
        type={htmlType}
        step={step}
        className={baseInput}
        placeholder={field.placeholder}
        value={typeof value === 'string' || typeof value === 'number' ? String(value) : ''}
        onChange={e => onChange(e.target.value)}
      />
      {help}
    </div>
  )
}
