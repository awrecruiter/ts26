/**
 * Environmental Protection / Management Plan (EMP) — protection of
 * sensitive resources, spill response, and hazardous material handling
 * on construction sites. Federal projects also incorporate NEPA / EO
 * commitments and any project-specific mitigation from the ROD.
 */
import type { GeneratedPlan, PlanSection, PlanGenerateInput } from './types'
import { makePlanHelpers } from './helpers'

const SENSITIVE_RESOURCES = [
  'T&E species habitat within or adjacent to work area',
  'Cultural or archaeological resources (Section 106 concerns)',
  'Wetlands / Waters of the U.S. (Section 404)',
  'Migratory Bird Treaty Act nesting windows',
  'Coastal Zone (CZMA) or floodplain (EO 11988)',
  'Prime / unique farmland (FPPA)',
  'Sole-source aquifer',
]

const HAZMAT_CATEGORIES = [
  'Fuel / diesel / gasoline (equipment operation)',
  'Motor oil + lubricants',
  'Solvents / paint thinners',
  'Adhesives + sealants',
  'Concrete curing compounds',
  'Herbicides / pesticides',
]

export function generateEnvironmentalPlan(input: PlanGenerateInput): GeneratedPlan {
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
      title: 'ENVIRONMENTAL PROTECTION PLAN',
      fields: [
        opp(opportunity.title, 'Project Name', 'cover.projectName'),
        admin('Contractor Name', 'cover.contractorName', { placeholder: contractor }),
        opp(opportunity.solicitationNumber, 'Contract Number', 'cover.contractNumber'),
        tpl(new Date().toLocaleDateString('en-US'), 'Date', 'cover.date'),
      ],
      items: [
        { text: 'Plan Preparer (Name, Title, Phone, & Signature):', field: admin('Preparer', 'cover.preparer', { multiline: true }) },
        { text: 'Environmental Officer (24-hour):', field: admin('Env officer + phone', 'cover.envOfficer', { multiline: true }) },
      ],
    },

    {
      key: 'baseline',
      letter: 'a',
      title: 'Environmental Baseline',
      intro: 'Sensitive resources on or adjacent to the site. Check any that apply — each triggers a mitigation section below.',
      checklist: {
        categories: [
          {
            heading: 'Sensitive resources present or adjacent',
            items: SENSITIVE_RESOURCES.map((label, i) => ({ key: `base.res.${i}`, label, checked: checked(`base.res.${i}`) })),
          },
        ],
      },
      items: [
        { number: '1', text: 'Applicable NEPA determination (EA / EIS / CATEX):', field: admin('NEPA basis', 'base.nepa') },
        { number: '2', text: 'Project-specific mitigation from the ROD / FONSI:', field: admin('Mitigation commitments', 'base.rod', { multiline: true }) },
        { number: '3', text: 'Section 7 / Section 106 consultation status:', field: admin('Consultation status', 'base.consultation', { multiline: true }) },
        { number: '4', text: 'Adjacent land uses (residential, commercial, protected areas):', field: admin('Adjacent land uses', 'base.landuse', { multiline: true }) },
      ],
    },

    {
      key: 'avoidance',
      letter: 'b',
      title: 'Impact Avoidance',
      intro: 'How work will avoid protected resources — physical exclusion, seasonal windows, and staging boundaries.',
      items: [
        { number: '1', text: 'Exclusion / buffer zones with flagging or fencing:', field: admin('Buffer zones + flagging', 'av.buffers', { multiline: true }) },
        { number: '2', text: 'Seasonal or time-of-day restrictions (nesting windows, dawn / dusk quiet hours):', field: admin('Seasonal restrictions', 'av.seasonal', { multiline: true }) },
        { number: '3', text: 'Equipment staging boundaries + travel corridors:', field: admin('Staging + travel corridors', 'av.staging', { multiline: true }) },
        { number: '4', text: 'Vegetation protection (root zone fencing, no fill within drip line):', field: admin('Vegetation protection', 'av.vegetation', { multiline: true }) },
        { number: '5', text: 'Wildlife awareness training for all site personnel:', field: tpl('Included in site-specific orientation', 'Wildlife training', 'av.training') },
      ],
    },

    {
      key: 'spill',
      letter: 'c',
      title: 'Spill Prevention & Response',
      intro: 'Fuel / lubricant / hazmat handling — SPCC-style controls for construction operations.',
      items: [
        { number: '1', text: 'Spill kit locations (co-located with fuel storage + equipment fueling areas):', field: admin('Spill kit locations', 'sp.kits', { multiline: true }) },
        { number: '2', text: 'Spill kit contents inventory (absorbent booms, pads, plugs, drums, PPE):', field: admin('Kit inventory', 'sp.inventory', { multiline: true }) },
        { number: '3', text: 'Secondary containment for fuel storage (110% of largest container):', field: tpl('Per 40 CFR 112 (SPCC style)', 'Secondary containment', 'sp.containment') },
        { number: '4', text: 'Refueling procedure (attendant present, distance from waterways, drip pans):', field: admin('Refueling SOP', 'sp.refueling', { multiline: true }) },
        { number: '5', text: 'Notification procedure (911 → state hotline → EPA National Response Center 1-800-424-8802 within 24 hours for reportable quantities):', field: tpl('Standard federal spill notification', 'Notification procedure', 'sp.notification') },
        { number: '6', text: 'Cleanup + disposal chain (contained → temporarily stored → hauled by licensed contractor):', field: admin('Cleanup + disposal chain', 'sp.cleanup', { multiline: true }) },
      ],
    },

    {
      key: 'hazmat',
      letter: 'd',
      title: 'Hazardous Material Handling',
      intro: 'Onsite chemicals present, their storage, and disposal path. Check the categories present.',
      checklist: {
        categories: [
          {
            heading: 'Hazardous / regulated materials on site',
            items: HAZMAT_CATEGORIES.map((label, i) => ({ key: `haz.cat.${i}`, label, checked: checked(`haz.cat.${i}`) })),
          },
        ],
      },
      items: [
        { number: '1', text: 'Safety Data Sheet (SDS) binder location + accessibility:', field: admin('SDS binder location', 'haz.sds', { multiline: true }) },
        { number: '2', text: 'Storage requirements per SDS (segregation, secondary containment, ventilation, temperature):', field: admin('Storage details per material', 'haz.storage', { multiline: true }) },
        { number: '3', text: 'Employee HAZCOM training records (29 CFR 1910.1200):', field: admin('HAZCOM training log', 'haz.training', { multiline: true }) },
        { number: '4', text: 'Waste characterization + disposal chain of custody:', field: admin('Waste disposal chain', 'haz.disposal', { multiline: true }) },
        { number: '5', text: 'Emergency contact for hazmat release (24-hour):', field: admin('Hazmat emergency contact', 'haz.emergency') },
      ],
    },

    {
      key: 'air',
      letter: 'e',
      title: 'Air Quality & Dust Control',
      intro: 'Fugitive-dust and equipment-emission controls that keep the project inside NAAQS + local requirements.',
      items: [
        { number: '1', text: 'Fugitive dust suppression (water truck, palliative, wind fencing, stabilized entrance):', field: admin('Dust suppression program', 'air.dust', { multiline: true }) },
        { number: '2', text: 'Equipment emissions (Tier 4 for onroad, DPF where required):', field: admin('Emissions requirements', 'air.emissions', { multiline: true }) },
        { number: '3', text: 'Idling restrictions (typical: 5 minutes maximum):', field: tpl('5-minute idling limit', 'Idling policy', 'air.idling') },
        { number: '4', text: 'Local air-quality authority contact:', field: admin('Air agency contact', 'air.agency', { multiline: true }) },
      ],
    },

    {
      key: 'noise',
      letter: 'f',
      title: 'Noise Control',
      intro: 'Community-noise commitments to keep the project within the noise variance / ordinance.',
      items: [
        { number: '1', text: 'Permitted work hours (typical: 7 AM – 7 PM weekdays):', field: admin('Permitted work hours', 'noi.hours') },
        { number: '2', text: 'Equipment noise controls (mufflers, engine housings, backup alarm alternatives):', field: admin('Noise controls', 'noi.controls', { multiline: true }) },
        { number: '3', text: 'Noise complaint response procedure:', field: admin('Complaint procedure', 'noi.complaints', { multiline: true }) },
      ],
    },
  ]

  return {
    key: 'emp',
    displayName: 'Environmental Protection / Management Plan',
    planCode: 'EMP',
    sections,
    generatedAt: new Date().toISOString(),
    sourceSubcontractorId: selectedSub?.id ?? null,
    sourceSubcontractorName: selectedSub?.name ?? null,
  }
}
