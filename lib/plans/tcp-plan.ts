/**
 * Traffic Control Plan (TCP / MOT) — MUTCD-compliant traffic routing
 * for construction work zones. Covers lane closures, flagger operations,
 * signage, and public + emergency access.
 */
import type { GeneratedPlan, PlanSection, PlanGenerateInput } from './types'
import { makePlanHelpers } from './helpers'

const DEVICES = [
  'Advance-warning signs (typ. W20-1, W21-5)',
  'Speed advisory / regulatory signs',
  'Cones — 28-inch minimum',
  'Channelizing drums / tubular markers',
  'Type III barricades at closure limits',
  'Portable Changeable Message Sign (PCMS)',
  'Arrow board (Type C for lane closures)',
  'Truck-mounted attenuator (TMA)',
  'Temporary pavement markings / removable tape',
  'Flashing beacons / warning lights',
]

export function generateTrafficControlPlan(input: PlanGenerateInput): GeneratedPlan {
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
      title: 'TRAFFIC CONTROL PLAN (TCP / MOT)',
      fields: [
        opp(opportunity.title, 'Project Name', 'cover.projectName'),
        admin('Contractor Name', 'cover.contractorName', { placeholder: contractor }),
        opp(opportunity.solicitationNumber, 'Contract Number', 'cover.contractNumber'),
        tpl(new Date().toLocaleDateString('en-US'), 'Date', 'cover.date'),
      ],
      items: [
        { text: 'TCP Preparer (Name, Title, Phone, & Signature):', field: admin('Preparer', 'cover.preparer', { multiline: true }) },
        { text: 'ATSSA / IMSA / equivalent certification of the TCP preparer:', field: admin('Certification', 'cover.cert') },
      ],
    },

    {
      key: 'workZone',
      letter: 'a',
      title: 'Work Zone Description',
      intro: 'Physical extent, duration, and lane configuration of the temporary traffic control zone.',
      items: [
        { number: '1', text: 'Work zone location (route + station-to-station or landmarks):', field: admin('Location description', 'wz.location', { multiline: true }) },
        { number: '2', text: 'Work duration + hours of operation (day / night / continuous):', field: admin('Duration + hours', 'wz.duration', { multiline: true }) },
        { number: '3', text: 'Lane configuration (full closure / single-lane / shoulder closure / crossover):', field: admin('Lane configuration', 'wz.lanes', { multiline: true }) },
        { number: '4', text: 'Posted speed vs. work-zone speed limit + variance approval:', field: admin('Speed limits + variance', 'wz.speed', { multiline: true }) },
        { number: '5', text: 'Detour route (if applicable) + agency approval:', field: admin('Detour route + approval', 'wz.detour', { multiline: true }) },
        { number: '6', text: 'Site plan / MUTCD typical application diagram number attached:', field: admin('TA number + attach plan', 'wz.diagram', { multiline: true }) },
      ],
    },

    {
      key: 'devices',
      letter: 'b',
      title: 'Traffic Control Devices',
      intro: 'MUTCD-compliant devices deployed in the work zone. Check every device type on the plan.',
      checklist: {
        categories: [
          {
            heading: 'Devices in use in this work zone',
            items: DEVICES.map((label, i) => ({ key: `dev.item.${i}`, label, checked: checked(`dev.item.${i}`) })),
          },
        ],
      },
      items: [
        { number: '1', text: 'Advance-warning sign spacing per MUTCD Table 6C-1 (based on speed):', field: tpl('Per MUTCD 6C-1', 'Sign spacing', 'dev.spacing') },
        { number: '2', text: 'Taper length per MUTCD Table 6C-2 / 6C-3 (based on speed + lane width):', field: tpl('Per MUTCD 6C-2 / 6C-3', 'Taper length', 'dev.taper') },
        { number: '3', text: 'Nighttime work — retroreflective device rating (Type II or III sheeting):', field: admin('Sheeting type', 'dev.sheeting') },
        { number: '4', text: 'Device inspection cadence (typ. daily start-of-shift + after weather):', field: tpl('Daily + weather-triggered', 'Inspection cadence', 'dev.inspection') },
      ],
    },

    {
      key: 'flagger',
      letter: 'c',
      title: 'Flagger Operations',
      intro: 'Flaggers must be ATSSA / IMSA-certified. Positioning follows MUTCD Chapter 6E.',
      items: [
        { number: '1', text: 'Flagger certification (ATSSA / IMSA / state DOT-approved course):', field: admin('Certification + expiry', 'fl.cert', { multiline: true }) },
        { number: '2', text: 'Flagger PPE (Class 2 or 3 high-visibility, hard hat, gloves):', field: tpl('Class 3 high-visibility required', 'Flagger PPE', 'fl.ppe') },
        { number: '3', text: 'Flagger station location (advance warning + escape route identified):', field: admin('Station locations + escape routes', 'fl.station', { multiline: true }) },
        { number: '4', text: 'Communication method between flaggers (radio / hand signals):', field: admin('Communication method', 'fl.comms') },
        { number: '5', text: 'Rest / rotation cadence for flaggers (typ. every 2 hours):', field: tpl('Rotate every 2 hours minimum', 'Rest cadence', 'fl.rotation') },
      ],
    },

    {
      key: 'access',
      letter: 'd',
      title: 'Public + Emergency Access',
      intro: 'Access commitments to the public, adjacent property owners, and emergency responders.',
      items: [
        { number: '1', text: 'Pedestrian route maintained (accessible, ADA-compliant if required):', field: admin('Pedestrian routing', 'ac.ped', { multiline: true }) },
        { number: '2', text: 'Bicycle route maintained or signed detour:', field: admin('Bicycle routing', 'ac.bike', { multiline: true }) },
        { number: '3', text: 'Business + residential access maintained during work hours:', field: admin('Property access commitments', 'ac.property', { multiline: true }) },
        { number: '4', text: 'Emergency vehicle access route (fire / EMS / police notified of closures):', field: admin('Emergency access + agency notifications', 'ac.emergency', { multiline: true }) },
        { number: '5', text: 'School zone / bus route coordination (if applicable):', field: admin('School zone coordination', 'ac.school', { multiline: true }) },
        { number: '6', text: 'Transit stop relocation coordinated with transit agency:', field: admin('Transit coordination', 'ac.transit', { multiline: true }) },
      ],
    },

    {
      key: 'notice',
      letter: 'e',
      title: 'Public Notice + Coordination',
      intro: 'Advance notice to the public and coordination with the road-owning authority.',
      items: [
        { number: '1', text: 'Advance notice to the public (typical: 7 days minimum via PCMS + local media):', field: admin('Public notice method + lead time', 'not.public', { multiline: true }) },
        { number: '2', text: 'Right-of-way / encroachment permit issued by:', field: admin('Permitting authority + permit #', 'not.permit', { multiline: true }) },
        { number: '3', text: 'Notification to adjacent property owners (letter or door-hanger 48 hours prior):', field: admin('Property owner notice', 'not.owners', { multiline: true }) },
        { number: '4', text: 'Notification to emergency services (fire / police / EMS / transit) before closures:', field: tpl('Notified 48 hours in advance minimum', 'Emergency notice', 'not.emergency') },
        { number: '5', text: '24-hour project hotline for the public:', field: admin('Hotline number', 'not.hotline') },
      ],
    },

    {
      key: 'inspection',
      letter: 'f',
      title: 'Inspection + Documentation',
      intro: 'Records that prove the plan is being executed as designed.',
      items: [
        { number: '1', text: 'Start-of-shift device inventory + placement check:', field: tpl('Daily by traffic-control lead', 'Start-of-shift check', 'ins.startShift') },
        { number: '2', text: 'End-of-shift device removal or transition to nighttime configuration:', field: tpl('Daily end-of-shift walk', 'End-of-shift walk', 'ins.endShift') },
        { number: '3', text: 'Weekly TCP audit by superintendent + retained on file:', field: admin('Weekly audit format', 'ins.audit', { multiline: true }) },
        { number: '4', text: 'Photo documentation of setup + any modifications:', field: tpl('Photo-documented', 'Photo records', 'ins.photos') },
        { number: '5', text: 'Incident log (any crash / near-miss in the work zone reported to the road authority):', field: admin('Incident log format', 'ins.incidents', { multiline: true }) },
      ],
    },
  ]

  return {
    key: 'tcp',
    displayName: 'Traffic Control Plan',
    planCode: 'TCP',
    sections,
    generatedAt: new Date().toISOString(),
    sourceSubcontractorId: selectedSub?.id ?? null,
    sourceSubcontractorName: selectedSub?.name ?? null,
  }
}
