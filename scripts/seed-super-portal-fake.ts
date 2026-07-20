/**
 * Puts one sub in the full "selected for bid + super portal active + a few
 * daily reports already filed" state so the whole flow is testable without
 * clicking through the workspace. Run with:
 *
 *   npx tsx scripts/seed-super-portal-fake.ts
 *
 * Prints two ready-to-open URLs at the end:
 *   1. The workspace tile URL (admin login required) — verifies the mint UI.
 *   2. The super portal URL (no login) — verifies the daily-report form,
 *      calendar, and pay-app rollup.
 *
 * Idempotent — re-running just rotates the token and refreshes the reports.
 */

import { randomBytes } from 'crypto'
import { prisma } from '../lib/db'
import { PAYMENT_PACKAGE_TEMPLATE_KEYS, getTemplate } from '../lib/requirements/templates'
import { rollupDailyReportsToCycle } from '../lib/requirements/daily-log-rollup'

const SUB_ID = 'cmlmovid20034kbvimfzu9gh6' // Same sub the payment-portal seed uses

async function main() {
  const sub = await prisma.subcontractor.findUnique({
    where: { id: SUB_ID },
    select: { id: true, name: true, opportunityId: true, email: true, contactEmail: true, contactName: true },
  })
  if (!sub) throw new Error(`Sub ${SUB_ID} not found — run seed-payment-portal-fake.ts first, or update SUB_ID.`)

  const email = sub.contactEmail ?? sub.email
  const opp = await prisma.opportunity.findUnique({
    where: { id: sub.opportunityId },
    select: { id: true, title: true },
  })
  if (!opp) throw new Error(`Opportunity ${sub.opportunityId} missing`)

  // 1. Ensure an open PaymentCycle for the current calendar month exists so
  //    the rollup has something to write into. Same shape as the API route
  //    at /api/opportunities/[id]/subcontractors/[subId]/payment-cycles.
  const now = new Date()
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59))
  const periodLabel = periodStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })

  let cycle = await prisma.paymentCycle.findUnique({
    where: {
      opportunityId_subcontractorId_periodStart: {
        opportunityId: sub.opportunityId,
        subcontractorId: sub.id,
        periodStart,
      },
    },
    select: { id: true },
  })
  if (!cycle) {
    const dueAt = new Date(periodEnd.getTime() + 14 * 24 * 60 * 60 * 1000)
    cycle = await prisma.paymentCycle.create({
      data: {
        opportunityId: sub.opportunityId,
        subcontractorId: sub.id,
        periodLabel,
        periodStart,
        periodEnd,
        requirements: {
          create: PAYMENT_PACKAGE_TEMPLATE_KEYS.map(key => {
            const template = getTemplate(key)!
            return {
              opportunityId: sub.opportunityId,
              subcontractorId: sub.id,
              templateKey: key,
              submittalGroup: template.submittalGroup,
              assignedEmail: email ?? 'noone@example.com',
              assignedName: sub.contactName ?? null,
              dueAt,
            }
          }),
        },
      },
      select: { id: true },
    })
    console.log(`✓ Created PaymentCycle for ${periodLabel}`)
  } else {
    console.log(`· PaymentCycle for ${periodLabel} already exists`)
  }

  // 2. Rotate any existing super token so the new one is the sole active one.
  const existingToken = await prisma.superPortalToken.findFirst({
    where: {
      opportunityId: sub.opportunityId,
      subcontractorId: sub.id,
      revokedAt: null,
    },
    select: { id: true },
  })
  if (existingToken) {
    await prisma.superPortalToken.update({
      where: { id: existingToken.id },
      data: { revokedAt: new Date() },
    })
  }
  const token = randomBytes(32).toString('hex')
  await prisma.superPortalToken.create({
    data: {
      opportunityId: sub.opportunityId,
      subcontractorId: sub.id,
      token,
      sentToEmail: email ?? null,
      sentToName: sub.contactName ?? 'Site Superintendent',
    },
  })
  console.log(existingToken ? '✓ Rotated super token' : '✓ Minted super token')

  // 3. Seed 5 fake daily reports across the last 7 work days so the calendar
  //    lights up green and the rollup has content to summarize.
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)
  const reportDays: Date[] = []
  for (let i = 1; i <= 7 && reportDays.length < 5; i++) {
    const d = new Date(today)
    d.setUTCDate(today.getUTCDate() - i)
    const dow = d.getUTCDay()
    if (dow === 0 || dow === 6) continue // Skip weekends
    reportDays.push(d)
  }

  const workNotes = [
    'Site clearing complete, staged material at bay 3. Utility locate confirmed.',
    'Set forms for footing 3, poured 12 cy of ready-mix, stripped forms on footing 2.',
    'Rebar cage tied for column line B. Concrete inspection passed, no re-work.',
    'Backfill and compaction to 95 % — density test 98 %. Rain 2–3:30 pm, no work loss.',
    'MEP rough-in continued; hung 220 lf of EMT. Owner walkthrough at 10 am — no issues.',
  ]

  for (let i = 0; i < reportDays.length; i++) {
    const reportDate = reportDays[i]
    await prisma.dailyReport.upsert({
      where: {
        opportunityId_subcontractorId_reportDate: {
          opportunityId: sub.opportunityId,
          subcontractorId: sub.id,
          reportDate,
        },
      },
      create: {
        opportunityId: sub.opportunityId,
        subcontractorId: sub.id,
        reportDate,
        weatherConditions: i % 2 === 0 ? 'Partly cloudy' : 'Clear',
        weatherTempHigh: `${78 + i}°F`,
        weatherTempLow: `${62 + i}°F`,
        precipitation: i === 3 ? '0.2 in (afternoon)' : 'None',
        windSpeed: `${8 + i} mph SW`,
        workHoursStart: '07:00',
        workHoursEnd: '16:30',
        hoursWorked: 9.5,
        personnel: [
          { label: 'Foreman', count: 1, hours: 9.5 },
          { label: 'Laborer', count: 4, hours: 9 },
          { label: 'Operator', count: 1, hours: 9 },
        ],
        equipment: [
          { label: 'Skid steer', count: 1, hours: 6 },
          { label: 'Concrete truck', count: 1, hours: 2 },
        ],
        workPerformed: workNotes[i],
        clinsWorked: 'CLIN 0001',
        percentComplete: 15 + i * 8,
        materialsReceived: i === 1 ? '12 cy of 4000 psi concrete (ticket #12345)' : '—',
        materialsUsed: i === 1 ? '12 cy poured, no waste' : '—',
        safetyIncidents: 'None',
        delays: i === 3 ? 'Rain 2:00–3:30 pm' : 'None',
        visitors: i === 4 ? 'Owner rep site walk 10 am' : 'None',
        photoUrls: [],
        attachmentUrls: [],
        superintendentName: 'Marcus Whitfield',
      },
      update: {
        workPerformed: workNotes[i],
        percentComplete: 15 + i * 8,
      },
    })
  }
  console.log(`✓ Seeded ${reportDays.length} daily reports`)

  // 4. Fire the rollup once so payment_daily_logs on the cycle is pre-filled.
  const rollup = await rollupDailyReportsToCycle({
    opportunityId: sub.opportunityId,
    subcontractorId: sub.id,
    reportDate: reportDays[0],
  })
  if (rollup.ok) {
    console.log(`✓ Rolled up ${rollup.count} reports into payment_daily_logs (${rollup.requirementId})`)
  } else {
    console.log(`· Rollup skipped: ${rollup.reason}`)
  }

  const baseUrl = process.env.NEXTAUTH_URL?.trim() || 'http://localhost:3000'
  console.log('')
  console.log('─── Ready to test ─────────────────────────────────────')
  console.log('')
  console.log('Super portal (no login, opens straight to the calendar):')
  console.log(`  ${baseUrl}/super/${token}`)
  console.log('')
  console.log('Workspace tile (admin login required — the mint UI lives here):')
  console.log(`  ${baseUrl}/opportunities/${opp.id}`)
  console.log('  → Subcontractors → Trades Outreached tile for the sub')
  console.log('  → "Daily-reports link" row → Copy link / Rotate + resend')
  console.log('')
}

main().catch(e => {
  console.error(e)
  process.exit(1)
}).finally(() => prisma.$disconnect())
