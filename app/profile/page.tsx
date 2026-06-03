'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import AppLayout from '@/components/layout/AppLayout'

interface ProfileData {
  email: string
  name: string | null
  organization: string | null
  title: string | null
  phone: string | null
}

export default function ProfilePage() {
  const { update } = useSession()
  const [profile, setProfile] = useState<ProfileData | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/profile')
      .then((r) => r.json())
      .then((d) => setProfile(d.user))
      .catch(() => setError('Failed to load profile'))
  }, [])

  const onChange = (field: keyof ProfileData) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setProfile((p) => (p ? { ...p, [field]: e.target.value } : p))
  }

  const handleSave = async () => {
    if (!profile) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profile),
      })
      if (!res.ok) throw new Error('Save failed')
      const data = await res.json()
      setProfile(data.user)
      // Trigger NextAuth JWT update so the session reflects new org/title
      // immediately — without this the SOW still says "Admin User" until
      // re-login.
      await update()
      setSavedAt(new Date())
      setTimeout(() => setSavedAt(null), 3000)
    } catch {
      setError('Failed to save')
    } finally {
      setSaving(false)
    }
  }

  if (!profile) {
    return (
      <AppLayout>
        <div className="p-6 text-sm text-stone-500">Loading…</div>
      </AppLayout>
    )
  }

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto p-6 sm:p-10">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-stone-900">Profile</h1>
          <p className="text-sm text-stone-500 mt-1">
            Identity surfaced on every SOW you generate. The PDF&apos;s &quot;Prime Contractor&quot; block
            and &quot;Quote due to&quot; label use these fields.
          </p>
        </div>

        <div className="bg-white border border-stone-200 rounded-lg p-6 space-y-4">
          <Field label="Email" value={profile.email} readOnly />
          <Field
            label="Organization"
            placeholder="e.g. Acme Federal Solutions LLC"
            value={profile.organization || ''}
            onChange={onChange('organization')}
            hint="Your company name. This appears in PREPARED BY and as the prime contractor identity on every SOW."
          />
          <Field
            label="Your name"
            placeholder="e.g. Ashley White"
            value={profile.name || ''}
            onChange={onChange('name')}
          />
          <Field
            label="Title"
            placeholder="e.g. Director of Federal Programs"
            value={profile.title || ''}
            onChange={onChange('title')}
          />
          <Field
            label="Phone"
            placeholder="e.g. (913) 555-0110"
            value={profile.phone || ''}
            onChange={onChange('phone')}
          />

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex items-center justify-end gap-3 pt-2">
            {savedAt && (
              <span className="text-xs text-stone-400">Saved ✓</span>
            )}
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 text-sm font-medium text-white bg-stone-800 rounded hover:bg-stone-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </AppLayout>
  )
}

interface FieldProps {
  label: string
  value: string
  placeholder?: string
  hint?: string
  readOnly?: boolean
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void
}

function Field({ label, value, placeholder, hint, readOnly, onChange }: FieldProps) {
  return (
    <div>
      <label className="block text-xs font-medium text-stone-600 mb-1">{label}</label>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        readOnly={readOnly}
        onChange={onChange}
        className={`w-full px-3 py-2 text-sm border rounded outline-none focus:ring-1 focus:ring-stone-300 ${
          readOnly
            ? 'bg-stone-50 text-stone-500 border-stone-200'
            : 'bg-white text-stone-900 border-stone-300'
        }`}
      />
      {hint && <p className="text-xs text-stone-500 mt-1">{hint}</p>}
    </div>
  )
}
