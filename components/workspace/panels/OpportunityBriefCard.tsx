'use client'

import type { OpportunityBrief } from '@/lib/openai'

interface OpportunityBriefCardProps {
  brief: OpportunityBrief | null
  isGenerating: boolean
  onGenerate: () => void
  opportunityTitle?: string
  agency?: string
  error?: string | null
}

const HEADS_UP_ICONS: Record<string, string> = {
  bonding: '🔒',
  clearance: '🛡️',
  setaside: '🏷️',
  timeline: '⏰',
  onsite: '📍',
  other: '⚠️',
}

export default function OpportunityBriefCard({
  brief,
  isGenerating,
  onGenerate,
  opportunityTitle,
  agency,
  error = null,
}: OpportunityBriefCardProps) {
  if (!brief) {
    return (
      <div className="bg-stone-50 border border-stone-200 rounded-lg p-6 mb-6">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-sm font-semibold text-stone-900 uppercase tracking-wide mb-1">
              Opportunity Brief
            </h2>
            <p className="text-sm text-stone-500">
              Generate a plain-language summary before you start searching for subcontractors.
            </p>
          </div>
          <button
            onClick={onGenerate}
            disabled={isGenerating}
            className="flex items-center gap-2 px-4 py-2 bg-stone-800 text-white text-sm rounded hover:bg-stone-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors shrink-0 ml-4"
          >
            {isGenerating ? (
              <>
                <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Generating…
              </>
            ) : (
              'Generate Brief'
            )}
          </button>
        </div>
        {error && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-800">
            {error}
          </div>
        )}
      </div>
    )
  }

  const siteTypeLabel = {
    'on-site': 'On-site required',
    remote: 'Remote eligible',
    hybrid: 'Hybrid (on-site + remote)',
    unknown: 'Location TBD',
  }[brief.placeOfPerformance.siteType] ?? brief.placeOfPerformance.siteType

  return (
    <div className="bg-stone-50 border border-stone-200 rounded-lg p-6 mb-6">
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-0.5">
            Opportunity Brief
          </p>
          <h2 className="text-base font-semibold text-stone-900">
            {agency && <span className="text-stone-600">{agency} — </span>}
            {opportunityTitle}
          </h2>
        </div>
        <button
          onClick={onGenerate}
          disabled={isGenerating}
          title="Regenerate brief"
          className="text-xs text-stone-400 hover:text-stone-600 disabled:opacity-50 transition-colors ml-4 shrink-0"
        >
          {isGenerating ? 'Regenerating…' : 'Regenerate'}
        </button>
      </div>

      {/* What They're Buying */}
      <div className="mb-4">
        <h3 className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-1">
          What They're Buying
        </h3>
        <p className="text-sm text-stone-800 leading-relaxed">{brief.whatTheyAreBuying}</p>
        {brief.endUser && (
          <p className="text-xs text-stone-500 mt-1">End user: {brief.endUser}</p>
        )}
      </div>

      {/* Two-column grid: Place + Who Qualifies */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        {/* Place of Performance */}
        <div className="bg-white border border-stone-100 rounded p-3">
          <h3 className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-2">
            Where
          </h3>
          <p className="text-sm font-medium text-stone-900">{brief.placeOfPerformance.location}</p>
          <p className="text-xs text-stone-500 mt-0.5">{siteTypeLabel}</p>
          {brief.placeOfPerformance.travelRequired && (
            <p className="text-xs text-amber-700 mt-0.5">Travel required</p>
          )}
        </div>

        {/* Who Qualifies */}
        <div className="bg-white border border-stone-100 rounded p-3">
          <h3 className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-2">
            Who Qualifies
          </h3>
          {brief.whoQualifies.setAside && (
            <p className="text-xs text-stone-700 mb-1">
              <span className="font-medium">Set-aside:</span> {brief.whoQualifies.setAside}
            </p>
          )}
          {(brief.whoQualifies.licenses ?? []).length > 0 && (
            <p className="text-xs text-stone-700 mb-1">
              <span className="font-medium">Licenses:</span>{' '}
              {brief.whoQualifies.licenses!.join(', ')}
            </p>
          )}
          {(brief.whoQualifies.clearances ?? []).length > 0 && (
            <p className="text-xs text-stone-700 mb-1">
              <span className="font-medium">Clearances:</span>{' '}
              {brief.whoQualifies.clearances!.join(', ')}
            </p>
          )}
          {(brief.whoQualifies.certifications ?? []).length > 0 && (
            <p className="text-xs text-stone-700 mb-1">
              <span className="font-medium">Certs:</span>{' '}
              {brief.whoQualifies.certifications!.join(', ')}
            </p>
          )}
          {!brief.whoQualifies.setAside &&
            !(brief.whoQualifies.licenses?.length) &&
            !(brief.whoQualifies.clearances?.length) &&
            !(brief.whoQualifies.certifications?.length) && (
              <p className="text-xs text-stone-400">No restrictions identified</p>
            )}
        </div>
      </div>

      {/* Key Deliverables */}
      {(brief.keyDeliverables?.length ?? 0) > 0 && (
        <div className="mb-4">
          <h3 className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-2">
            Key Deliverables
          </h3>
          <div className="space-y-1">
            {brief.keyDeliverables.map((d, i) => (
              <div key={i} className="flex items-start gap-2 text-sm text-stone-700">
                <span className="text-stone-400 mt-0.5 shrink-0">{i + 1}.</span>
                <span>
                  {d.item}
                  {d.frequency && (
                    <span className="text-stone-400 ml-1 text-xs">— {d.frequency}</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Period + Value row */}
      <div className="flex flex-wrap gap-4 mb-4 text-sm">
        {brief.periodOfPerformance && (
        <div>
          <span className="text-xs font-semibold text-stone-500 uppercase tracking-wide block mb-0.5">
            Period
          </span>
          <span className="text-stone-800">{brief.periodOfPerformance.basePeriod}</span>
          {brief.periodOfPerformance.optionYears != null &&
            brief.periodOfPerformance.optionYears > 0 && (
              <span className="text-stone-500 ml-1 text-xs">
                + {brief.periodOfPerformance.optionYears} option year
                {brief.periodOfPerformance.optionYears !== 1 ? 's' : ''}
              </span>
            )}
        </div>
        )}
        {brief.estimatedValue && (
          <div>
            <span className="text-xs font-semibold text-stone-500 uppercase tracking-wide block mb-0.5">
              Value
            </span>
            <span className="text-stone-800">{brief.estimatedValue}</span>
          </div>
        )}
        {brief.contractType && (
          <div>
            <span className="text-xs font-semibold text-stone-500 uppercase tracking-wide block mb-0.5">
              Type
            </span>
            <span className="text-stone-800">{brief.contractType}</span>
          </div>
        )}
      </div>

      {/* Heads Up */}
      {(brief.headsUp?.length ?? 0) > 0 && (
        <div className="border border-amber-200 bg-amber-50 rounded p-3">
          <h3 className="text-xs font-semibold text-amber-800 uppercase tracking-wide mb-2">
            Heads Up
          </h3>
          <ul className="space-y-1">
            {brief.headsUp.map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-amber-900">
                <span className="shrink-0">{HEADS_UP_ICONS[item.type] ?? '⚠️'}</span>
                <span>{item.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
