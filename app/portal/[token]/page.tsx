import { resolvePortalToken } from '@/lib/requirements/portal-tokens'
import { getTemplate } from '@/lib/requirements/templates'
import type { RequirementTemplate } from '@/lib/requirements/types'
import PortalDashboard from './PortalDashboard'

interface PageProps {
  params: Promise<{ token: string }>
}

export const dynamic = 'force-dynamic'

export default async function PaymentPortalPage({ params }: PageProps) {
  const { token } = await params
  const result = await resolvePortalToken(token)

  if (!result.ok) {
    const message =
      result.reason === 'not_found'
        ? 'This portal link is not valid.'
        : 'This link has expired. Ask the prime contractor to resend it.'
    return (
      <div className="min-h-[100dvh] bg-stone-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white border border-stone-200 rounded-lg p-8 text-center">
          <div className="mx-auto w-12 h-12 rounded-full bg-stone-100 flex items-center justify-center mb-4">
            <svg className="w-6 h-6 text-stone-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M12 8v4m0 4h.01M12 2a10 10 0 100 20 10 10 0 000-20z" />
            </svg>
          </div>
          <h1 className="text-lg font-semibold text-stone-900 mb-2">Portal unavailable</h1>
          <p className="text-sm text-stone-600">{message}</p>
        </div>
      </div>
    )
  }

  const { cycle } = result.record
  const templates: RequirementTemplate[] = []
  for (const req_ of cycle.requirements) {
    const t = getTemplate(req_.templateKey)
    if (t) templates.push(t)
  }

  return (
    <div className="min-h-[100dvh] bg-stone-50">
      <div className="max-w-5xl mx-auto p-4 sm:p-8">
        <header className="mb-6">
          <p className="text-xs uppercase tracking-wide text-stone-400 mb-1">
            Payment Package · {cycle.periodLabel}
          </p>
          <h1 className="text-2xl font-semibold text-stone-900 mb-1">
            {cycle.subcontractor.name}
          </h1>
          <p className="text-sm text-stone-600">
            Submit each task to be included in this pay application.
          </p>
          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-xs text-stone-500 border-t border-stone-200 pt-3">
            <div>
              <span className="text-stone-400">Project · </span>
              <span className="text-stone-700">{cycle.opportunity.title}</span>
            </div>
            {cycle.opportunity.solicitationNumber && (
              <div>
                <span className="text-stone-400">Solicitation · </span>
                <span className="text-stone-700">{cycle.opportunity.solicitationNumber}</span>
              </div>
            )}
            <div>
              <span className="text-stone-400">Period · </span>
              <span className="text-stone-700">
                {new Date(cycle.periodStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                {' – '}
                {new Date(cycle.periodEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </span>
            </div>
          </div>
        </header>

        <PortalDashboard
          token={token}
          cycle={{
            id: cycle.id,
            periodLabel: cycle.periodLabel,
            status: cycle.status,
          }}
          initialRequirements={cycle.requirements.map(r => ({
            id: r.id,
            templateKey: r.templateKey,
            status: r.status,
            responses: (r.responses as Record<string, unknown> | null) ?? null,
            attachmentUrls: r.attachmentUrls,
            submittedAt: r.submittedAt ? r.submittedAt.toISOString() : null,
            reviewedAt: r.reviewedAt ? r.reviewedAt.toISOString() : null,
            reviewNotes: r.reviewNotes ?? null,
            rejectionReason: r.rejectionReason ?? null,
          }))}
          templates={templates}
        />

        <footer className="mt-8 pt-6 border-t border-stone-200 text-xs text-stone-400 text-center">
          Portal link stays valid for this pay period. Come back any time to add more.
        </footer>
      </div>
    </div>
  )
}
