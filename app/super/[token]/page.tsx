import { prisma } from '@/lib/db'
import { resolveSuperToken } from '@/lib/requirements/super-tokens'
import SuperDashboard from './SuperDashboard'

interface PageProps {
  params: Promise<{ token: string }>
}

export const dynamic = 'force-dynamic'

export default async function SuperPortalPage({ params }: PageProps) {
  const { token } = await params
  const result = await resolveSuperToken(token)

  if (!result.ok) {
    const message =
      result.reason === 'not_found'
        ? 'This portal link is not valid.'
        : 'This link has been rotated. Ask the prime contractor for the new one.'
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

  const { opportunity, subcontractor } = result.record

  const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000)
  const reports = await prisma.dailyReport.findMany({
    where: {
      opportunityId: opportunity.id,
      subcontractorId: subcontractor.id,
      reportDate: { gte: sixtyDaysAgo },
    },
    orderBy: { reportDate: 'desc' },
  })

  return (
    <div className="min-h-[100dvh] bg-stone-50">
      <div className="max-w-6xl mx-auto p-4 sm:p-8">
        <header className="mb-6">
          <p className="text-xs uppercase tracking-wide text-stone-400 mb-1">
            Daily Reports · Superintendent
          </p>
          <h1 className="text-2xl font-semibold text-stone-900 mb-1">
            {subcontractor.name}
          </h1>
          <p className="text-sm text-stone-600">
            File one report per work day. Rolls up into the monthly pay application.
          </p>
          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-xs text-stone-500 border-t border-stone-200 pt-3">
            <div>
              <span className="text-stone-400">Project · </span>
              <span className="text-stone-700">{opportunity.title}</span>
            </div>
            {opportunity.solicitationNumber && (
              <div>
                <span className="text-stone-400">Solicitation · </span>
                <span className="text-stone-700">{opportunity.solicitationNumber}</span>
              </div>
            )}
            {subcontractor.service && (
              <div>
                <span className="text-stone-400">Trade · </span>
                <span className="text-stone-700">{subcontractor.service}</span>
              </div>
            )}
          </div>
        </header>

        <SuperDashboard
          token={token}
          initialReports={reports.map(r => ({
            id: r.id,
            reportDate: r.reportDate.toISOString().slice(0, 10),
            weatherConditions: r.weatherConditions,
            weatherTempHigh: r.weatherTempHigh,
            weatherTempLow: r.weatherTempLow,
            precipitation: r.precipitation,
            windSpeed: r.windSpeed,
            workHoursStart: r.workHoursStart,
            workHoursEnd: r.workHoursEnd,
            hoursWorked: r.hoursWorked,
            personnel: (r.personnel as Array<{ label?: string; count?: number; hours?: number }> | null) ?? [],
            equipment: (r.equipment as Array<{ label?: string; count?: number; hours?: number }> | null) ?? [],
            workPerformed: r.workPerformed,
            clinsWorked: r.clinsWorked,
            percentComplete: r.percentComplete,
            materialsReceived: r.materialsReceived,
            materialsUsed: r.materialsUsed,
            safetyIncidents: r.safetyIncidents,
            delays: r.delays,
            visitors: r.visitors,
            photoUrls: r.photoUrls,
            attachmentUrls: r.attachmentUrls,
            superintendentName: r.superintendentName,
            submittedAt: r.submittedAt.toISOString(),
          }))}
          defaultSuperName={subcontractor.contactName ?? ''}
        />

        <footer className="mt-8 pt-6 border-t border-stone-200 text-xs text-stone-400 text-center">
          Persistent portal — bookmark and come back every work day.
        </footer>
      </div>
    </div>
  )
}
