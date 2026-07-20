/**
 * Puts one existing sub in the "outreached + intake submitted" state so the
 * Select-for-bid button appears on their tile. Run with:
 *
 *   npx tsx scripts/seed-payment-portal-fake.ts
 */

import { prisma } from '../lib/db'

const SUB_ID = 'cmlmovid20034kbvimfzu9gh6' // Health Care Sys USA of Dade

async function main() {
  const sub = await prisma.subcontractor.findUnique({
    where: { id: SUB_ID },
    select: { id: true, name: true, opportunityId: true, email: true, contactEmail: true },
  })
  if (!sub) throw new Error(`Sub ${SUB_ID} not found`)

  const email = sub.contactEmail ?? sub.email
  if (!email) throw new Error(`Sub ${SUB_ID} has no email on file`)

  const opp = await prisma.opportunity.findUnique({
    where: { id: sub.opportunityId },
    select: { id: true, title: true, solicitationNumber: true },
  })
  if (!opp) throw new Error(`Opportunity ${sub.opportunityId} not found`)

  const now = new Date()

  // 1. Mark them as outreached so they show up under "Trades Outreached".
  await prisma.subcontractor.update({
    where: { id: sub.id },
    data: {
      sowSentAt: now,
      contactName: sub.contactEmail ? undefined : 'Alex Vendor',
      service: 'Vehicle & fleet services',
    },
  })

  // 2. Fabricate a fully-filled, SUBMITTED sub_quote requirement so the
  //    tile's intake bar shows 100 % and canSelect flips true.
  const existingQuote = await prisma.requirementInstance.findFirst({
    where: {
      opportunityId: sub.opportunityId,
      subcontractorId: sub.id,
      templateKey: 'sub_quote',
      paymentCycleId: null,
    },
    select: { id: true },
  })

  const responses = {
    company_name: sub.name,
    address: '1200 Bay Rd, Miami Beach, FL 33139',
    contact_name: 'Alex Vendor',
    contact_email: email,
    contact_phone: '(305) 555-0142',
    scope_confirmation: 'Supply and delivery of four off-road capable ambulances with EMS fit-out.',
    exclusions: 'Freight to Namibia not included; no on-site medical staff training.',
    grand_total: 1_240_000,
    quote_valid_days: 60,
    notes: 'Lead time 120 days from order. Warranty 24 months / 40,000 mi.',
    mobilization_lead_days: 30,
    crew_size: 4,
    duration_days: 120,
    shifts: 'Day shift, 7a-4p, Mon-Fri',
    safety_officer_name: 'Jamie Delgado',
    safety_officer_phone: '(305) 555-0177',
    osha_training: 'osha30',
    hazards_summary: 'Vehicle lift/rigging, battery handling, cold-chain medical waste.',
    qc_officer_name: 'Priya Ramanathan',
    qc_officer_phone: '(305) 555-0188',
    inspection_frequency: 'Per-vehicle pre-delivery inspection + end-of-run audit',
    davis_bacon_ack: 'yes',
    certified_payroll_ack: 'yes',
    gl_limit: 2_000_000,
    auto_limit: 1_000_000,
    umbrella_limit: 5_000_000,
    wc_state: 'FL',
    insurance_expiration: '2027-06-30',
    bonding_capacity: 3_000_000,
    warranty_period: '24 months',
    as_built_deliverable: 'Vehicle turnover binder + registration + keys',
  }

  const dueAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

  if (existingQuote) {
    await prisma.requirementInstance.update({
      where: { id: existingQuote.id },
      data: {
        responses,
        status: 'SUBMITTED',
        submittedAt: now,
        assignedEmail: email,
        assignedName: 'Alex Vendor',
        dueAt,
      },
    })
  } else {
    await prisma.requirementInstance.create({
      data: {
        opportunityId: sub.opportunityId,
        subcontractorId: sub.id,
        templateKey: 'sub_quote',
        submittalGroup: 'quote_submission',
        assignedEmail: email,
        assignedName: 'Alex Vendor',
        dueAt,
        responses,
        status: 'SUBMITTED',
        submittedAt: now,
      },
    })
  }

  console.log('✓ Seeded outreached + intake-submitted sub.')
  console.log('')
  console.log('Open the workspace:')
  console.log(`  https://usher-nextjs.vercel.app/opportunities/${opp.id}`)
  console.log('')
  console.log('→ Click Subcontractors in the sidebar')
  console.log(`→ Scroll to "Trades Outreached" → find "${sub.name}"`)
  console.log('→ Click the black "Select for bid" button on the tile')
}

main().catch(e => {
  console.error(e)
  process.exit(1)
}).finally(() => prisma.$disconnect())
