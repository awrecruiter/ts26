/**
 * Waste Management Plan (WMP) — construction waste diversion, hauler
 * chain of custody, and hazardous-waste manifesting. Mirrors the shape
 * of the APP so it renders through PlanViewerModal.
 */
import type { GeneratedPlan, PlanSection, PlanGenerateInput } from './types'
import { makePlanHelpers } from './helpers'

// Typical construction waste streams — user can override / add / remove
// via inline edits.
const WASTE_STREAMS = [
  'Construction & Demolition (C&D) debris — concrete, brick, asphalt, wood',
  'Metals — rebar, structural steel, roofing metal, wire',
  'Cardboard + paper packaging',
  'Plastic packaging + shrink wrap',
  'Hazardous / regulated waste — solvents, adhesives, fuel, oil filters',
  'Universal waste — batteries, fluorescent lamps',
  'General trash / non-recyclable',
]

const HAZMAT_STREAMS = [
  'Paint / solvent residue',
  'Fuel + oil (equipment maintenance)',
  'Adhesives + sealants',
  'Concrete washout',
]

export function generateWasteManagementPlan(input: PlanGenerateInput): GeneratedPlan {
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
      title: 'WASTE MANAGEMENT PLAN',
      fields: [
        opp(opportunity.title, 'Project Name', 'cover.projectName'),
        admin('Contractor Name', 'cover.contractorName', { placeholder: contractor }),
        opp(opportunity.solicitationNumber, 'Contract Number', 'cover.contractNumber'),
        tpl(new Date().toLocaleDateString('en-US'), 'Date', 'cover.date'),
      ],
      items: [
        { text: 'WMP Prepared By (Name, Title, Phone, & Signature):', field: admin('Prepared By', 'cover.preparedBy', { multiline: true }) },
      ],
    },

    {
      key: 'inventory',
      letter: 'a',
      title: 'Waste Stream Inventory',
      intro: 'Every material type expected to leave the site — check the streams that apply.',
      checklist: {
        categories: [
          {
            heading: 'Waste streams present on this project',
            items: WASTE_STREAMS.map((label, i) => ({ key: `inv.stream.${i}`, label, checked: checked(`inv.stream.${i}`) })),
          },
        ],
      },
      items: [
        { number: '1', text: 'Additional waste streams not listed above:', field: admin('Additional streams', 'inv.additional', { multiline: true }) },
        { number: '2', text: 'Estimated total waste volume (tons or cubic yards):', field: admin('Estimated volume', 'inv.volume') },
      ],
    },

    {
      key: 'storage',
      letter: 'b',
      title: 'Segregation & Storage',
      intro: 'Onsite handling before pickup — where containers live, how streams are separated, spill containment for hazmat.',
      items: [
        { number: '1', text: 'Container types + labeling per stream (roll-off, dumpster, drum, tote):', field: admin('Container plan per stream', 'stor.containers', { multiline: true }) },
        { number: '2', text: 'Container locations on the site plan:', field: admin('Container locations (attach site map)', 'stor.locations', { multiline: true }) },
        { number: '3', text: 'Secondary containment for hazmat storage (per 40 CFR 264.175):', field: admin('Secondary containment details', 'stor.containment', { multiline: true }) },
        { number: '4', text: 'Housekeeping cadence — bins covered, area kept clear:', field: tpl('Daily housekeeping walk by SSHO', 'Housekeeping', 'stor.housekeeping') },
        { number: '5', text: 'Spill prevention + response kit locations (co-located with hazmat storage):', field: admin('Spill kit locations', 'stor.spillKits', { multiline: true }) },
      ],
    },

    {
      key: 'haulers',
      letter: 'c',
      title: 'Hauler & Downstream Facilities',
      intro: 'Licensed chain of custody — hauler, receiving landfill / recycler, and hazmat disposal facility per stream.',
      items: [
        { number: '1', text: 'Primary hauler name + license #:', field: admin('Hauler + license', 'haul.primary') },
        { number: '2', text: 'Landfill / transfer station (permit #, address):', field: admin('Landfill or transfer facility', 'haul.landfill', { multiline: true }) },
        { number: '3', text: 'Recycling facility per stream (name, address, streams accepted):', field: admin('Recycling facilities', 'haul.recycling', { multiline: true }) },
        { number: '4', text: 'Hazardous waste disposal facility (EPA ID + address):', field: admin('Hazmat TSDF + EPA ID', 'haul.hazmat', { multiline: true }) },
        { number: '5', text: 'Backup hauler in case of primary hauler downtime:', field: admin('Backup hauler', 'haul.backup') },
      ],
    },

    {
      key: 'hazmat',
      letter: 'd',
      title: 'Hazardous Waste Streams',
      intro: 'Regulated streams that require manifest tracking under 40 CFR 262 (or state-equivalent). Check any that apply.',
      checklist: {
        categories: [
          {
            heading: 'Regulated hazmat streams on this project',
            items: HAZMAT_STREAMS.map((label, i) => ({ key: `haz.stream.${i}`, label, checked: checked(`haz.stream.${i}`) })),
          },
        ],
      },
      items: [
        { number: '1', text: 'Site EPA generator status (VSQG / SQG / LQG):', field: admin('Generator status', 'haz.status') },
        { number: '2', text: 'Uniform Hazardous Waste Manifest (Form 8700-22) retained for each shipment:', field: tpl('Retained on file — 3 years minimum', 'Manifest retention', 'haz.manifest') },
        { number: '3', text: 'Emergency contact for hazmat spill (24-hour):', field: admin('Emergency contact + number', 'haz.emergency') },
      ],
    },

    {
      key: 'docs',
      letter: 'e',
      title: 'Documentation',
      intro: 'Paper trail proving compliant disposal — weight tickets, manifests, and monthly summaries submitted to the GDA.',
      items: [
        { number: '1', text: 'Weight tickets retained for every load (hauler ticket + landfill / recycler ticket):', field: tpl('Retained per load, submitted monthly', 'Weight tickets', 'doc.weight') },
        { number: '2', text: 'Uniform Hazardous Waste Manifests (retained 3 years minimum):', field: tpl('Retained 3 years', 'Manifests', 'doc.manifests') },
        { number: '3', text: 'Recycling receipts (per stream, per pickup):', field: tpl('Retained per pickup', 'Recycling receipts', 'doc.receipts') },
        { number: '4', text: 'Monthly diversion summary submitted to GDA:', field: admin('Monthly summary format', 'doc.summary', { multiline: true }) },
      ],
    },

    {
      key: 'diversion',
      letter: 'f',
      title: 'Diversion Targets',
      intro: 'Recycling / reuse goals stated in the solicitation. Track actual diversion against target on a monthly basis.',
      items: [
        { number: '1', text: 'Target diversion percentage (typical: 50% of C&D by weight):', field: admin('Target %', 'div.target') },
        { number: '2', text: 'Baseline calculation method (weight vs. volume):', field: admin('Calculation method', 'div.method', { multiline: true }) },
        { number: '3', text: 'Reporting cadence to CO / GDA (typical: monthly):', field: tpl('Monthly diversion summary', 'Reporting cadence', 'div.cadence') },
        { number: '4', text: 'End-of-project diversion report submitted:', field: tpl('Submitted at final acceptance', 'End-of-project report', 'div.final') },
      ],
    },
  ]

  return {
    key: 'wmp',
    displayName: 'Waste Management Plan',
    planCode: 'WMP',
    sections,
    generatedAt: new Date().toISOString(),
    sourceSubcontractorId: selectedSub?.id ?? null,
    sourceSubcontractorName: selectedSub?.name ?? null,
  }
}
