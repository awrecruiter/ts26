import { prisma } from '@/lib/db'

/**
 * Rolls up DailyReport rows into the payment cycle's `payment_daily_logs`
 * RequirementInstance so the sub sees them pre-populated when closing the
 * monthly pay app. Called after any DailyReport upsert.
 *
 * Only touches responses on cycles that are still open (TODO or IN_PROGRESS).
 * Once the sub has submitted the task, we leave it alone — further edits go
 * through the standard portal flow so the audit trail is intact.
 */
export async function rollupDailyReportsToCycle(input: {
  opportunityId: string
  subcontractorId: string
  reportDate: Date
}): Promise<
  | { ok: true; requirementId: string; count: number }
  | { ok: false; reason: 'no_cycle' | 'no_requirement' | 'closed' | 'error'; error?: string }
> {
  try {
    const cycle = await prisma.paymentCycle.findFirst({
      where: {
        opportunityId: input.opportunityId,
        subcontractorId: input.subcontractorId,
        periodStart: { lte: input.reportDate },
        periodEnd: { gte: input.reportDate },
      },
      select: { id: true, periodStart: true, periodEnd: true },
    })
    if (!cycle) return { ok: false, reason: 'no_cycle' }

    const requirement = await prisma.requirementInstance.findFirst({
      where: {
        paymentCycleId: cycle.id,
        templateKey: 'payment_daily_logs',
      },
      select: { id: true, status: true, responses: true },
    })
    if (!requirement) return { ok: false, reason: 'no_requirement' }
    if (requirement.status === 'SUBMITTED' || requirement.status === 'APPROVED') {
      return { ok: false, reason: 'closed' }
    }

    const reports = await prisma.dailyReport.findMany({
      where: {
        opportunityId: input.opportunityId,
        subcontractorId: input.subcontractorId,
        reportDate: { gte: cycle.periodStart, lte: cycle.periodEnd },
      },
      orderBy: { reportDate: 'asc' },
      select: {
        id: true,
        reportDate: true,
        hoursWorked: true,
        workPerformed: true,
        superintendentName: true,
        photoUrls: true,
        attachmentUrls: true,
      },
    })

    const existing = (requirement.responses ?? {}) as Record<string, unknown>
    const rollup = {
      generatedAt: new Date().toISOString(),
      count: reports.length,
      reports: reports.map(r => ({
        id: r.id,
        date: r.reportDate.toISOString().slice(0, 10),
        hours: r.hoursWorked,
        workPerformed: r.workPerformed,
        superintendent: r.superintendentName,
        photos: r.photoUrls,
        attachments: r.attachmentUrls,
      })),
    }

    const nextResponses = {
      ...existing,
      work_days_covered: reports.length,
      daily_reports_rollup: rollup,
    }

    await prisma.requirementInstance.update({
      where: { id: requirement.id },
      data: {
        responses: nextResponses,
        status: requirement.status === 'TODO' ? 'IN_PROGRESS' : requirement.status,
      },
    })

    return { ok: true, requirementId: requirement.id, count: reports.length }
  } catch (e) {
    return { ok: false, reason: 'error', error: e instanceof Error ? e.message : String(e) }
  }
}
