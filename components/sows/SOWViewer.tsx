'use client'

import { useState } from 'react'

// New structured section format
interface StructuredSection {
  title: string
  summary: string
  bullets: string[]
  details: string
}

// Legacy flat section format
interface LegacySection {
  title: string
  content: string
}

type Section = StructuredSection | LegacySection

function isStructuredSection(section: Section): section is StructuredSection {
  return 'bullets' in section && Array.isArray((section as any).bullets)
}

interface SOWContent {
  // New format fields
  opportunity?: {
    title?: string
    solicitationNumber?: string
    agency?: string
    naicsCode?: string
    setAside?: string
    responseDeadline?: string
    postedDate?: string | null
    placeOfPerformance?: string
    pointOfContact?: string | null
    classificationCode?: string | null
    type?: string | null
  }
  // Legacy format fields
  header?: {
    title: string
    date: string
    sow_id: string
    prepared_for: string
    prepared_by: string
  }
  project?: {
    title: string
    solicitation_number: string
    agency: string
    naics_code: string
  }
  sections: Section[]
  attachments?: Array<{ name: string; url: string }>
  sourceEnhanced?: boolean
}

interface SOWViewerProps {
  content: SOWContent
  opportunityId?: string
}

export default function SOWViewer({ content, opportunityId }: SOWViewerProps) {
  if (!content) {
    return (
      <div className="p-8 text-center text-stone-500">
        No content available
      </div>
    )
  }

  // Detect format: new (has opportunity) vs legacy (has header/project)
  const isNewFormat = !!content.opportunity
  const opp = content.opportunity

  return (
    <div className="bg-stone-50 h-[600px] overflow-y-auto">
      {isNewFormat && opp ? (
        /* === NEW FORMAT: Key Info Card + Structured Sections === */
        <div className="max-w-4xl mx-auto p-6 space-y-4">
          {/* Key Info Card */}
          <div className="bg-white border border-stone-200 rounded-lg p-5">
            <h1 className="text-lg font-bold text-stone-900 mb-3 leading-tight">
              {opp.title}
            </h1>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
              <InfoChip label="Solicitation" value={opp.solicitationNumber} />
              <InfoChip label="Agency" value={opp.agency} />
              <InfoChip label="Deadline" value={opp.responseDeadline} highlight />
              {opp.placeOfPerformance && <InfoChip label="Location" value={opp.placeOfPerformance} />}
              {opp.setAside && <InfoChip label="Set-Aside" value={opp.setAside} />}
              {opp.naicsCode && <InfoChip label="NAICS" value={opp.naicsCode} />}
              {opp.postedDate && <InfoChip label="Posted" value={opp.postedDate} />}
              {opp.pointOfContact && <InfoChip label="Point of Contact" value={opp.pointOfContact} />}
            </div>
            {content.sourceEnhanced && (
              <div className="mt-3 flex items-center gap-1.5 text-xs text-stone-600">
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Enhanced with parsed attachment data
              </div>
            )}
          </div>

          {/* Sections */}
          {content.sections.map((section, index) => (
            <SectionCard key={index} section={section} />
          ))}

          {/* Attachments */}
          {content.attachments && content.attachments.length > 0 && (
            <div className="bg-white border border-stone-200 rounded-lg p-5">
              <h2 className="text-sm font-semibold text-stone-700 mb-3">Referenced Documents</h2>
              <div className="space-y-1.5">
                {content.attachments.map((att, idx) => {
                  const href = opportunityId
                    ? `/api/opportunities/${opportunityId}/attachments/${encodeURIComponent((att as any).id || `resource-${idx}`)}/proxy`
                    : att.url
                  return (
                    <a
                      key={idx}
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 text-sm text-stone-600 hover:text-stone-900 py-1"
                    >
                      <svg className="h-4 w-4 text-stone-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                      </svg>
                      {att.name}
                    </a>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      ) : (
        /* === LEGACY FORMAT: Original rendering === */
        <div className="bg-stone-100 p-6">
          <div className="bg-white p-8 max-w-4xl mx-auto shadow-lg">
            {content.header && (
              <div className="text-center mb-8 pb-6 border-b-2 border-stone-300">
                <h1 className="text-3xl font-bold text-stone-900 mb-4">
                  {content.header.title}
                </h1>
                <div className="space-y-1 text-sm text-stone-600">
                  <p><span className="font-semibold">Date:</span> {content.header.date}</p>
                  <p><span className="font-semibold">SOW ID:</span> {content.header.sow_id}</p>
                  <p><span className="font-semibold">Prepared For:</span> {content.header.prepared_for}</p>
                  <p><span className="font-semibold">Prepared By:</span> {content.header.prepared_by}</p>
                </div>
              </div>
            )}
            {content.project && (
              <div className="mb-8 pb-6 border-b border-stone-200">
                <div className="space-y-2 text-sm">
                  <p><span className="font-semibold">Project:</span> {content.project.title}</p>
                  <p><span className="font-semibold">Solicitation Number:</span> {content.project.solicitation_number}</p>
                  <p><span className="font-semibold">Government Agency:</span> {content.project.agency}</p>
                  <p><span className="font-semibold">NAICS Code:</span> {content.project.naics_code}</p>
                </div>
              </div>
            )}
            <div className="space-y-6">
              {content.sections.map((section, index) => (
                <div key={index} className="mb-6">
                  <h2 className="text-xl font-bold text-stone-900 mb-3">
                    {section.title}
                  </h2>
                  {isStructuredSection(section) ? (
                    <>
                      {section.summary && (
                        <p className="text-sm text-stone-500 mb-3">{section.summary}</p>
                      )}
                      {section.bullets && section.bullets.length > 0 && (
                        <ul className="space-y-1.5 mb-3">
                          {section.bullets.map((bullet, idx) => (
                            <li key={idx} className="flex items-start gap-2 text-sm text-stone-700">
                              <span className="text-stone-400 mt-1 flex-shrink-0">&#8226;</span>
                              <span className="leading-relaxed">{bullet}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                      {section.details && (
                        <p className="text-sm text-stone-600 leading-relaxed whitespace-pre-wrap">{section.details}</p>
                      )}
                    </>
                  ) : (
                    <p className="text-stone-700 leading-relaxed whitespace-pre-wrap">{section.content}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function InfoChip({ label, value, highlight }: { label: string; value?: string | null; highlight?: boolean }) {
  if (!value) return null
  return (
    <div className={`px-3 py-2 rounded ${highlight ? 'bg-stone-800 text-white' : 'bg-stone-50'}`}>
      <p className={`text-xs ${highlight ? 'text-stone-300' : 'text-stone-400'}`}>{label}</p>
      <p className={`text-sm font-medium ${highlight ? 'text-white' : 'text-stone-800'} truncate`}>{value}</p>
    </div>
  )
}

function SectionCard({ section }: { section: Section }) {
  const [showDetails, setShowDetails] = useState(false)

  if (!isStructuredSection(section)) {
    // Legacy section: render as before
    return (
      <div className="bg-white border border-stone-200 rounded-lg p-5">
        <h2 className="text-base font-bold text-stone-900 mb-2">{section.title}</h2>
        <p className="text-sm text-stone-700 leading-relaxed whitespace-pre-wrap">{section.content}</p>
      </div>
    )
  }

  // Guard: if bullets is missing/empty treat it as an empty array
  const bullets = Array.isArray(section.bullets) ? section.bullets : []

  return (
    <div className="bg-white border border-stone-200 rounded-lg p-5">
      {/* Section header */}
      <h2 className="text-base font-bold text-stone-900 mb-1">{section.title}</h2>

      {/* Summary line */}
      {section.summary && (
        <p className="text-sm text-stone-500 mb-3">{section.summary}</p>
      )}

      {/* Bullet list — always rendered when non-empty */}
      {bullets.length > 0 && (
        <ul className="space-y-1.5 mb-2">
          {bullets.map((bullet, idx) => (
            <li key={idx} className="flex items-start gap-2 text-sm text-stone-700">
              <span className="text-stone-400 mt-1 flex-shrink-0">&#8226;</span>
              <span className="leading-relaxed">{bullet}</span>
            </li>
          ))}
        </ul>
      )}

      {/* Details toggle — only show if details adds substance beyond bullets */}
      {section.details && section.details.trim() !== bullets.join('\n').trim() && (
        <button
          onClick={() => setShowDetails(!showDetails)}
          className="text-xs text-stone-400 hover:text-stone-600 mt-2 flex items-center gap-1"
        >
          <svg className={`h-3 w-3 transition-transform ${showDetails ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          {showDetails ? 'Hide full text' : 'Show full text'}
        </button>
      )}

      {showDetails && (
        <div className="mt-3 pt-3 border-t border-stone-100">
          <p className="text-sm text-stone-600 leading-relaxed whitespace-pre-wrap">{section.details}</p>
        </div>
      )}
    </div>
  )
}
