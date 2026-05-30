'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import AgentHeroCard from '@/components/dashboard/AgentHeroCard'
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

interface Opportunity {
  id: string
  title: string
  agency: string | null
  responseDeadline: string | null
  agentBriefing: AgentBriefing | null
  progress?: { currentStage: string } | null
}

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null
  const diff = new Date(dateStr).getTime() - Date.now()
  return Math.ceil(diff / (1000 * 60 * 60 * 24))
}

function deadlineColor(days: number | null): string {
  if (days === null) return 'text-stone-400'
  if (days <= 7) return 'text-red-600 font-medium'
  if (days <= 14) return 'text-amber-600 font-medium'
  return 'text-stone-500'
}

function deadlineLabel(days: number | null): string {
  if (days === null) return 'No deadline'
  if (days < 0) return 'Past deadline'
  if (days === 0) return 'Due today'
  if (days === 1) return '1 day left'
  return `${days} days left`
}

export default function AgentDashboard({ userName }: { userName?: string }) {
  const [opportunities, setOpportunities] = useState<Opportunity[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/opportunities?engaged=true&status=ACTIVE&sort=deadline_asc&limit=20')
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (data?.opportunities) setOpportunities(data.opportunities)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const [hero, ...rest] = opportunities

  if (loading) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <div className="inline-block animate-spin rounded-full h-10 w-10 border-b-2 border-stone-600" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-stone-50">
      <div className="max-w-2xl mx-auto px-4 py-10">
        {/* Greeting */}
        <h1 className="text-2xl font-bold text-stone-900 mb-8">
          {userName ? `Welcome back, ${userName.split(' ')[0]}` : 'Welcome back'}
        </h1>

        {/* Empty state */}
        {!hero && (
          <div className="text-center py-20">
            <p className="text-stone-500 text-lg font-medium">No active opportunities</p>
            <p className="text-stone-400 mt-2 text-sm">
              Your admin will assign opportunities here when they are ready for you.
            </p>
          </div>
        )}

        {/* Hero card — nearest deadline */}
        {hero && (
          <div className="mb-8">
            <AgentHeroCard
              id={hero.id}
              title={hero.title}
              agency={hero.agency || ''}
              responseDeadline={hero.responseDeadline}
              stage={hero.progress?.currentStage ?? null}
              agentBriefing={hero.agentBriefing}
            />
          </div>
        )}

        {/* Compact list — remaining opportunities */}
        {rest.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-stone-400 mb-3">
              Also in progress ({rest.length})
            </p>
            <div className="bg-white border border-stone-200 rounded-xl overflow-hidden divide-y divide-stone-100">
              {rest.map((opp) => {
                const stage = opp.progress?.currentStage ?? null
                const days = daysUntil(opp.responseDeadline)
                const panel = stage ? (STAGE_PANEL[stage] ?? '') : ''
                return (
                  <Link
                    key={opp.id}
                    href={`/opportunities/${opp.id}${panel}`}
                    className="flex items-center gap-4 px-5 py-4 hover:bg-stone-50 transition-colors group"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-stone-800 truncate">{opp.title}</p>
                      {opp.agency && (
                        <p className="text-xs text-stone-400 truncate">{opp.agency}</p>
                      )}
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-xs font-medium text-stone-600">
                        {stage ? (STAGE_LABELS[stage] ?? stage) : 'Get started'}
                      </p>
                      <p className={`text-xs mt-0.5 ${deadlineColor(days)}`}>
                        {deadlineLabel(days)}
                      </p>
                    </div>
                    <svg className="h-4 w-4 text-stone-300 group-hover:text-stone-500 transition-colors shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </Link>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
