import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { resolveSuperToken } from '@/lib/requirements/super-tokens'
import { rollupDailyReportsToCycle } from '@/lib/requirements/daily-log-rollup'

interface Body {
  reportDate?: string // YYYY-MM-DD
  weatherConditions?: string
  weatherTempHigh?: string
  weatherTempLow?: string
  precipitation?: string
  windSpeed?: string
  workHoursStart?: string
  workHoursEnd?: string
  hoursWorked?: number | string
  personnel?: Array<{ label?: string; count?: number | string; hours?: number | string }>
  equipment?: Array<{ label?: string; count?: number | string; hours?: number | string }>
  workPerformed?: string
  clinsWorked?: string
  percentComplete?: number | string
  materialsReceived?: string
  materialsUsed?: string
  safetyIncidents?: string
  delays?: string
  visitors?: string
  photoUrls?: string[]
  attachmentUrls?: string[]
  superintendentName?: string
}

function parseDateOnly(s: string | undefined): Date | null {
  if (!s) return null
  // YYYY-MM-DD → midnight UTC on that day
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim())
  if (!m) {
    const d = new Date(s)
    if (isNaN(d.getTime())) return null
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  }
  const [, y, mo, dd] = m
  return new Date(Date.UTC(Number(y), Number(mo) - 1, Number(dd)))
}

function num(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v.replace(/[^\d.-]/g, ''))
    return Number.isFinite(n) ? n : undefined
  }
  return undefined
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params
  const result = await resolveSuperToken(token)
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 410 })

  let body: Body
  try { body = (await req.json()) as Body } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const reportDate = parseDateOnly(body.reportDate)
  if (!reportDate) {
    return NextResponse.json({ error: 'reportDate is required (YYYY-MM-DD).' }, { status: 400 })
  }
  if (!body.superintendentName?.trim()) {
    return NextResponse.json({ error: 'superintendentName is required.' }, { status: 400 })
  }

  const { opportunity, subcontractor } = result.record

  const data = {
    weatherConditions: body.weatherConditions ?? null,
    weatherTempHigh: body.weatherTempHigh ?? null,
    weatherTempLow: body.weatherTempLow ?? null,
    precipitation: body.precipitation ?? null,
    windSpeed: body.windSpeed ?? null,
    workHoursStart: body.workHoursStart ?? null,
    workHoursEnd: body.workHoursEnd ?? null,
    hoursWorked: num(body.hoursWorked) ?? null,
    personnel: (body.personnel ?? null) as unknown as object,
    equipment: (body.equipment ?? null) as unknown as object,
    workPerformed: body.workPerformed ?? null,
    clinsWorked: body.clinsWorked ?? null,
    percentComplete: num(body.percentComplete) ?? null,
    materialsReceived: body.materialsReceived ?? null,
    materialsUsed: body.materialsUsed ?? null,
    safetyIncidents: body.safetyIncidents ?? null,
    delays: body.delays ?? null,
    visitors: body.visitors ?? null,
    photoUrls: body.photoUrls ?? [],
    attachmentUrls: body.attachmentUrls ?? [],
    superintendentName: body.superintendentName.trim(),
  }

  const report = await prisma.dailyReport.upsert({
    where: {
      opportunityId_subcontractorId_reportDate: {
        opportunityId: opportunity.id,
        subcontractorId: subcontractor.id,
        reportDate,
      },
    },
    create: {
      opportunityId: opportunity.id,
      subcontractorId: subcontractor.id,
      reportDate,
      ...data,
    },
    update: data,
  })

  // Best-effort — a missing/closed cycle is not an error from the super's
  // perspective. They should always be able to file a report; the pay-app
  // rollup happens if and when a matching open cycle exists.
  const rollup = await rollupDailyReportsToCycle({
    opportunityId: opportunity.id,
    subcontractorId: subcontractor.id,
    reportDate,
  })

  return NextResponse.json({ success: true, report, rollup })
}
