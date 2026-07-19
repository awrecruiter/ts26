/**
 * Storm Water Pollution Prevention Plan (SWPPP) — EPA CGP (or state
 * equivalent) format. Covers BMPs, inspection cadence, and permit
 * compliance for construction sites disturbing ≥ 1 acre.
 */
import type { GeneratedPlan, PlanSection, PlanGenerateInput } from './types'
import { makePlanHelpers } from './helpers'

const EROSION_BMPS = [
  'Mulching / hydroseeding of disturbed areas',
  'Erosion-control blankets on slopes > 3:1',
  'Preservation of existing vegetation buffers',
  'Temporary + permanent seeding of stockpiles',
]

const SEDIMENT_BMPS = [
  'Silt fence along downgradient perimeter',
  'Fiber roll / wattle on contours',
  'Sediment trap or sediment basin',
  'Inlet protection (curb inlets + area drains)',
  'Stabilized construction entrance (rock pad)',
  'Concrete washout containment area',
]

export function generateSWPPP(input: PlanGenerateInput): GeneratedPlan {
  const { opportunity, primeCompanyName, selectedSub } = input
  const contractor = (primeCompanyName ?? '').trim() || 'the Prime Contractor'
  const { opp, tpl, admin, checked } = makePlanHelpers({
    overrides: input.overrides,
    checks: input.checks,
    selectedSubName: selectedSub?.name,
  })

  const sections: PlanSection[] = [
    {
      key: 'cover',
      title: 'STORM WATER POLLUTION PREVENTION PLAN',
      fields: [
        opp(opportunity.title, 'Project Name', 'cover.projectName'),
        admin('Contractor / Operator', 'cover.contractorName', { placeholder: contractor }),
        opp(opportunity.solicitationNumber, 'Contract Number', 'cover.contractNumber'),
        tpl(new Date().toLocaleDateString('en-US'), 'Date', 'cover.date'),
      ],
      items: [
        { text: 'SWPPP Preparer (Name, Title, Phone, & Signature):', field: admin('Preparer', 'cover.preparer', { multiline: true }) },
        { text: 'NPDES Permit Number / State Coverage #:', field: admin('Permit / coverage number', 'cover.permit') },
      ],
    },

    {
      key: 'description',
      letter: 'a',
      title: 'Site Description',
      intro: 'Physical setting that drives the SWPPP design — acreage, drainage, and receiving waters.',
      items: [
        { number: '1', text: 'Total site acreage:', field: admin('Total acres', 'desc.totalAcres') },
        { number: '2', text: 'Disturbed acreage (total ground disturbance during project):', field: admin('Disturbed acres', 'desc.disturbedAcres') },
        { number: '3', text: 'Existing drainage patterns + discharge points:', field: admin('Drainage description + discharge points', 'desc.drainage', { multiline: true }) },
        { number: '4', text: 'Receiving waters (name + 303(d) impairment status):', field: admin('Receiving water + impairment', 'desc.receiving', { multiline: true }) },
        { number: '5', text: 'Soil types + slopes:', field: admin('Soil types + slope %', 'desc.soils', { multiline: true }) },
        { number: '6', text: 'Site map with discharge points, BMP locations, and drainage boundaries attached:', field: admin('Attach site map', 'desc.map', { multiline: true }) },
      ],
    },

    {
      key: 'pollutants',
      letter: 'b',
      title: 'Potential Pollutants',
      intro: 'What could reach storm water leaving this site.',
      items: [
        { number: '1', text: 'Sediment sources (grading, stockpiles, unstabilized areas):', field: admin('Sediment sources', 'pol.sediment', { multiline: true }) },
        { number: '2', text: 'Non-storm-water discharges (concrete washout, dewatering, fire hydrant flushing):', field: admin('Non-storm-water discharges', 'pol.nonStorm', { multiline: true }) },
        { number: '3', text: 'Fuel + oil handling areas:', field: admin('Fuel / oil handling', 'pol.fuel', { multiline: true }) },
        { number: '4', text: 'Solid waste + debris that could enter drainage:', field: admin('Solid waste sources', 'pol.solid', { multiline: true }) },
      ],
    },

    {
      key: 'erosion',
      letter: 'c',
      title: 'Erosion-Control BMPs',
      intro: 'BMPs implemented onsite — check the erosion controls that apply.',
      checklist: {
        categories: [
          {
            heading: 'Erosion controls in use',
            items: EROSION_BMPS.map((label, i) => ({ key: `ec.bmp.${i}`, label, checked: checked(`ec.bmp.${i}`) })),
          },
        ],
      },
      items: [
        { number: '1', text: 'Additional erosion controls not listed:', field: admin('Additional erosion controls', 'ec.additional', { multiline: true }) },
        { number: '2', text: 'Slope stabilization installed within 14 days of grading completion:', field: tpl('Per EPA CGP', 'Stabilization timing', 'ec.timing') },
      ],
    },

    {
      key: 'sediment',
      letter: 'd',
      title: 'Sediment-Control BMPs',
      intro: 'Check the sediment controls in use on this site.',
      checklist: {
        categories: [
          {
            heading: 'Sediment controls in use',
            items: SEDIMENT_BMPS.map((label, i) => ({ key: `sc.bmp.${i}`, label, checked: checked(`sc.bmp.${i}`) })),
          },
        ],
      },
      items: [
        { number: '1', text: 'Concrete washout — designated, contained, and clearly labeled:', field: tpl('Contained washout area with signage', 'Concrete washout', 'sc.washout') },
        { number: '2', text: 'Good housekeeping practices (spill kits, covered dumpsters, waste stored uphill of discharge points):', field: tpl('Documented in the SWPPP + monitored by QCM', 'Housekeeping', 'sc.housekeeping') },
      ],
    },

    {
      key: 'inspection',
      letter: 'e',
      title: 'Inspection Schedule',
      intro: 'Cadence and triggers for BMP inspection per the applicable NPDES permit.',
      items: [
        { number: '1', text: 'Routine inspections (typical: every 7 days):', field: tpl('Every 7 calendar days minimum', 'Routine cadence', 'insp.routine') },
        { number: '2', text: 'Rain-triggered inspections (> 0.25 in in 24 hours):', field: tpl('Within 24 hours of qualifying event', 'Rain-triggered', 'insp.rain') },
        { number: '3', text: 'Qualified SWPPP inspector name + certification:', field: admin('Inspector + certification', 'insp.inspector', { multiline: true }) },
        { number: '4', text: 'Inspection form (attach copy):', field: admin('Inspection form template', 'insp.form', { multiline: true }) },
        { number: '5', text: 'Rain gauge on site — daily reading recorded:', field: tpl('Onsite rain gauge, daily log', 'Rain gauge', 'insp.gauge') },
      ],
    },

    {
      key: 'corrective',
      letter: 'f',
      title: 'Corrective Actions',
      intro: 'Response when a BMP fails or an unauthorized discharge occurs.',
      items: [
        { number: '1', text: 'Deficiency close-out timeline (typical: 7 days from identification):', field: tpl('7 days from inspection', 'Close-out timeline', 'ca.timeline') },
        { number: '2', text: 'Escalation for repeat failures (SSHO → PM → CO / GDA):', field: tpl('Escalate after 2 recurrences', 'Escalation path', 'ca.escalation') },
        { number: '3', text: 'Records + photos of every corrective action:', field: tpl('Photo-documented, filed with inspection record', 'Records', 'ca.records') },
        { number: '4', text: 'Immediate reporting for unauthorized discharges (verbal within 24 hours):', field: tpl('Verbal within 24 hours', 'Discharge reporting', 'ca.discharge') },
      ],
    },

    {
      key: 'permit',
      letter: 'g',
      title: 'Permit Compliance',
      intro: 'Alignment with the applicable CGP / state permit — proof of coverage and termination at project close.',
      items: [
        { number: '1', text: 'Notice of Intent (NOI) submitted before ground disturbance:', field: admin('NOI submission date + confirmation #', 'per.noi', { multiline: true }) },
        { number: '2', text: 'Permit coverage number posted at the site entrance:', field: admin('Coverage # posting location', 'per.coverage') },
        { number: '3', text: 'Notice of Termination (NOT) filed at final stabilization:', field: tpl('Filed at final acceptance', 'NOT filing', 'per.not') },
        { number: '4', text: 'SWPPP retained onsite (available for inspector on request):', field: tpl('Kept onsite in project office', 'Onsite retention', 'per.retention') },
        { number: '5', text: 'Annual permit fee(s) paid + up-to-date:', field: admin('Fee status', 'per.fees') },
      ],
    },
  ]

  return {
    key: 'swppp',
    displayName: 'Storm Water Pollution Prevention Plan',
    planCode: 'SWPPP',
    sections,
    generatedAt: new Date().toISOString(),
    sourceSubcontractorId: selectedSub?.id ?? null,
    sourceSubcontractorName: selectedSub?.name ?? null,
  }
}
