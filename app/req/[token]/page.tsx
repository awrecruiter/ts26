import { resolveMagicToken } from '@/lib/requirements/tokens'
import { getTemplate } from '@/lib/requirements/templates'
import RequirementForm from './RequirementForm'

interface PageProps {
  params: Promise<{ token: string }>
}

export const dynamic = 'force-dynamic'

export default async function RequirementAccessPage({ params }: PageProps) {
  const { token } = await params
  const result = await resolveMagicToken(token)

  if (!result.ok) {
    const message =
      result.reason === 'not_found'
        ? 'This link is not valid.'
        : result.reason === 'expired'
          ? 'This link has expired. Ask the prime contractor to resend it.'
          : 'This link has already been used and submitted.'
    return (
      <div className="min-h-[100dvh] bg-stone-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white border border-stone-200 rounded-lg p-8 text-center">
          <div className="mx-auto w-12 h-12 rounded-full bg-stone-100 flex items-center justify-center mb-4">
            <svg className="w-6 h-6 text-stone-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M12 8v4m0 4h.01M12 2a10 10 0 100 20 10 10 0 000-20z" />
            </svg>
          </div>
          <h1 className="text-lg font-semibold text-stone-900 mb-2">Link unavailable</h1>
          <p className="text-sm text-stone-600">{message}</p>
        </div>
      </div>
    )
  }

  const { record } = result
  const req_ = record.requirement
  const template = getTemplate(req_.templateKey)
  if (!template) {
    return (
      <div className="min-h-[100dvh] bg-stone-50 flex items-center justify-center p-6">
        <p className="text-sm text-stone-600">Template no longer available.</p>
      </div>
    )
  }
  // Prefill from what we already know about this specific sub. Only used when
  // the sub hasn't started answering yet — otherwise their prior responses win.
  // Keyed to the field keys defined in each template's formSchema.
  const sub = req_.subcontractor
  const priorResponses = (req_.responses as Record<string, unknown> | null) ?? null
  let prefill: Record<string, unknown> | null = priorResponses
  if (!priorResponses) {
    if (template.key === 'sub_quote') {
      prefill = {
        company_name: sub.name ?? '',
        address: sub.address ?? '',
        contact_name: sub.contactName ?? '',
        contact_email: sub.contactEmail ?? sub.email ?? '',
        contact_phone: sub.contactPhone ?? sub.phone ?? '',
      }
    }
  }

  return (
    <div className="min-h-[100dvh] bg-stone-50">
      <div className="max-w-2xl mx-auto p-4 sm:p-8">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold text-stone-900 mb-1">
            {req_.subcontractor.name}
          </h1>
          <p className="text-sm text-stone-600">{template.purpose}</p>
          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-xs text-stone-500 border-t border-stone-200 pt-3">
            <div>
              <span className="text-stone-400">Project · </span>
              <span className="text-stone-700">{req_.opportunity.title}</span>
            </div>
            {req_.opportunity.solicitationNumber && (
              <div>
                <span className="text-stone-400">Solicitation · </span>
                <span className="text-stone-700">{req_.opportunity.solicitationNumber}</span>
              </div>
            )}
            {req_.dueAt && (
              <div>
                <span className="text-stone-400">Due · </span>
                <span className="text-stone-700">
                  {new Date(req_.dueAt).toLocaleDateString('en-US', {
                    month: 'short', day: 'numeric', year: 'numeric',
                  })}
                </span>
              </div>
            )}
          </div>
        </header>

        <RequirementForm
          token={token}
          template={template}
          initialResponses={prefill}
          initialAttachments={req_.attachmentUrls}
          alreadySubmitted={req_.status === 'SUBMITTED' || req_.status === 'APPROVED'}
        />

        <footer className="mt-8 pt-6 border-t border-stone-200 text-xs text-stone-400 text-center">
          Secure one-time link. No login required. Your responses go directly to the prime contractor.
        </footer>
      </div>
    </div>
  )
}
