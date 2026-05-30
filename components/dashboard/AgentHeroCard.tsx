'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { AgentBriefing } from '@/lib/openai'

const STAGE_LABELS: Record<string, string> = {
  DISCOVERY:    'Review opportunity',
  ASSESSMENT:   'Run margin analysis',
  SOW_CREATION: 'Write SOW',
  SOW_REVIEW:   'Review SOW',
  BID_ASSEMBLY: 'Assemble bid',
  READY:        'Submit bid',
  SUBMITTED:    'View submission',
}

const STAGE_PANEL: Record<string, string> = {
  DISCOVERY:    '',
  ASSESSMENT:   '?panel=summary',
  SOW_CREATION: '?panel=sow',
  SOW_REVIEW:   '?panel=sow',
  BID_ASSEMBLY: '?panel=bid',
  READY:        '?panel=bid',
  SUBMITTED:    '',
}

interface HeroCardProps {
  id: string
  title: string
  agency: string
  responseDeadline: string | null
  stage: string | null
  agentBriefing?: AgentBriefing | null
}

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null
  const diff = new Date(dateStr).getTime() - Date.now()
  return Math.ceil(diff / (1000 * 60 * 60 * 24))
}

function deadlineColor(days: number | null): string {
  if (days === null) return 'text-stone-500'
  if (days <= 7) return 'text-red-600 font-semibold'
  if (days <= 14) return 'text-amber-600 font-semibold'
  return 'text-stone-600'
}

function deadlineLabel(days: number | null): string {
  if (days === null) return 'No deadline set'
  if (days < 0) return 'Past deadline'
  if (days === 0) return 'Due today'
  if (days === 1) return '1 day left'
  return `${days} days left`
}

export default function AgentHeroCard({
  id,
  title,
  agency,
  responseDeadline,
  stage,
  agentBriefing: initialBriefing,
}: HeroCardProps) {
  const [briefing, setBriefing] = useState<AgentBriefing | null>(initialBriefing ?? null)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const days = daysUntil(responseDeadline)
  const actionLabel = stage ? (STAGE_LABELS[stage] ?? 'Get started') : 'Get started'
  const panelSuffix = stage ? (STAGE_PANEL[stage] ?? '') : ''
  const href = `/opportunities/${id}${panelSuffix}`

  const handleGenerate = async () => {
    setGenerating(true)
    setError(null)
    try {
      const res = await fetch(`/api/opportunities/${id}/agent-briefing`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to generate')
      setBriefing(data.briefing)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="bg-white border border-stone-200 rounded-2xl p-8 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-widest text-stone-400 mb-3">Your next step</p>

      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
        <div className="flex-1 min-w-0">
          <p className="text-sm text-stone-500 mb-1">{agency}</p>
          <h2 className="text-xl font-semibold text-stone-900 leading-snug">{title}</h2>
        </div>
        <div className={`text-sm shrink-0 ${deadlineColor(days)}`}>
          {deadlineLabel(days)}
        </div>
      </div>

      {/* AI Briefing section */}
      {briefing ? (
        <div className="mb-6 border border-stone-100 rounded-xl p-5 bg-stone-50 space-y-4">
          {/* Summary */}
          <p className="text-sm text-stone-700 leading-relaxed">{briefing.summary}</p>

          {/* Qualifications */}
          {briefing.qualifications.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-2">To win, you need</p>
              <ul className="space-y-1">
                {briefing.qualifications.map((q, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-stone-700">
                    <span className="text-stone-400 mt-0.5 shrink-0">•</span>
                    <span>{q}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Compliance flags */}
          {briefing.complianceFlags.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-amber-600 uppercase tracking-wide mb-2">Watch out for</p>
              <ul className="space-y-1">
                {briefing.complianceFlags.map((f, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-stone-700">
                    <span className="text-amber-500 mt-0.5 shrink-0">!</span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <button
            onClick={handleGenerate}
            disabled={generating}
            className="text-xs text-stone-400 hover:text-stone-600 underline underline-offset-2 transition-colors"
          >
            {generating ? 'Refreshing...' : 'Refresh briefing'}
          </button>
        </div>
      ) : (
        <div className="mb-6 border border-stone-100 rounded-xl p-5 bg-stone-50 flex flex-col items-center gap-3 text-center">
          <p className="text-sm text-stone-500">Get an AI-generated plain-English briefing for this opportunity.</p>
          {error && <p className="text-xs text-red-500">{error}</p>}
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-stone-700 bg-white border border-stone-300 rounded-lg hover:bg-stone-50 disabled:opacity-50 transition-colors"
          >
            {generating ? (
              <>
                <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Generating briefing...
              </>
            ) : (
              'Generate Briefing'
            )}
          </button>
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="flex-1">
          <p className="text-sm text-stone-500">
            Current stage:{' '}
            <span className="font-medium text-stone-700">
              {stage ? (STAGE_LABELS[stage] ?? stage) : 'Getting started'}
            </span>
          </p>
        </div>
        <Link
          href={href}
          className="inline-flex items-center justify-center gap-2 px-6 py-3 text-sm font-semibold text-white bg-stone-800 rounded-xl hover:bg-stone-700 transition-colors"
        >
          {actionLabel}
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </Link>
      </div>
    </div>
  )
}
