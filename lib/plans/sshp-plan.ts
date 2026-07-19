/**
 * Site-Specific Safety & Health Plan (SSHP) — EM 385-1-1 compliant plan
 * tailored to this site's hazards. Complements the APP but is scoped to
 * the physical work site (adjacent operations, utilities, access, and
 * the JHAs that apply to this specific footprint).
 */
import type { GeneratedPlan, PlanSection, PlanGenerateInput } from './types'
import { makePlanHelpers } from './helpers'

export function generateSiteSpecificSafetyPlan(input: PlanGenerateInput): GeneratedPlan {
  const { opportunity, primeCompanyName, selectedSub } = input
  const r = (selectedSub?.responses ?? {}) as {
    safety_officer_name?: string
    safety_officer_phone?: string
    osha_training?: string
    hazards_summary?: string
  }
  const contractor = (primeCompanyName ?? '').trim() || 'the Prime Contractor'
  const { opp, sub, tpl, admin, subName } = makePlanHelpers({
    overrides: input.overrides,
    checks: input.checks,
    selectedSubName: selectedSub?.name,
  })
  const ssho = (r.safety_officer_name ?? '').trim()
  const sshoDisplay = ssho || (subName ? `[${subName}'s SSHO]` : '[SSHO name]')

  const sections: PlanSection[] = [
    {
      key: 'cover',
      title: 'SITE-SPECIFIC SAFETY & HEALTH PLAN',
      fields: [
        opp(opportunity.title, 'Project Name', 'cover.projectName'),
        admin('Contractor Name', 'cover.contractorName', { placeholder: contractor }),
        opp(opportunity.solicitationNumber, 'Contract Number', 'cover.contractNumber'),
        tpl(new Date().toLocaleDateString('en-US'), 'Date', 'cover.date'),
      ],
      items: [
        { text: 'Plan Preparer (Name, Title, Phone, & Signature):', field: admin('Prepared By', 'cover.preparedBy', { multiline: true }) },
        { text: 'Site Safety & Health Officer (SSHO):', field: sub(r.safety_officer_name, 'SSHO', 'cover.ssho') },
      ],
    },

    {
      key: 'characterization',
      letter: 'a',
      title: 'Site Characterization',
      intro: 'Physical and operational context of the work area — everything that shapes what safety controls are needed.',
      items: [
        { number: '1', text: 'Site description + boundary map:', field: admin('Site description + attach boundary map', 'sc.description', { multiline: true }) },
        { number: '2', text: 'Adjacent operations / occupied areas (public, tenants, other contractors):', field: admin('Adjacent operations', 'sc.adjacent', { multiline: true }) },
        { number: '3', text: 'Overhead utilities (power, comms, transit):', field: admin('Overhead utilities', 'sc.overhead', { multiline: true }) },
        { number: '4', text: 'Underground utilities (call-before-you-dig ticket #, mark-out age):', field: admin('Underground utilities + 811 ticket #', 'sc.underground', { multiline: true }) },
        { number: '5', text: 'Site security & controlled access (fencing, sign-in, badging):', field: admin('Access controls', 'sc.access', { multiline: true }) },
        { number: '6', text: 'Environmental conditions (heat / cold / high wind thresholds, weather stand-down triggers):', field: admin('Weather thresholds', 'sc.weather', { multiline: true }) },
      ],
    },

    {
      key: 'hazards',
      letter: 'b',
      title: 'Hazard Analysis',
      intro:
        'Task-specific hazards identified via Activity Hazard Analyses (AHAs). Each definable feature of work has its own AHA reviewed at the preparatory meeting.',
      items: [
        { number: '1', text: 'Anticipated high-risk activities (from sub intake / SOW):', field: sub(r.hazards_summary, 'High-risk activities', 'haz.activities') },
        { number: '2', text: 'AHAs on file for each definable feature of work (attach):', field: admin('AHA register — one per DFOW', 'haz.ahas', { multiline: true }) },
        { number: '3', text: 'Risk assessment method (probability × severity → residual risk):', field: tpl('Risk Assessment Code (RAC) per EM 385-1-1 Section 01.A.14', 'RAC method', 'haz.rac') },
        { number: '4', text: 'Controls hierarchy (elimination → engineering → administrative → PPE):', field: tpl('Applied in order of preference per EM 385-1-1', 'Controls hierarchy', 'haz.hierarchy') },
      ],
    },

    {
      key: 'roles',
      letter: 'c',
      title: 'Roles & Responsibilities',
      intro: 'Who does what for safety on this site.',
      items: [
        { number: '1', text: `${sshoDisplay} — Site Safety & Health Officer (24-hour contact):`, field: sub(r.safety_officer_phone, 'SSHO phone', 'role.sshoPhone') },
        { number: '2', text: 'Competent persons by hazard class:', subitems: [
          { number: 'A', text: 'Fall protection (systems > 6 ft):', field: admin('Competent person — fall', 'role.cp.fall') },
          { number: 'B', text: 'Excavation / trenching (depth > 5 ft):', field: admin('Competent person — excavation', 'role.cp.excavation') },
          { number: 'C', text: 'Confined space entry:', field: admin('Competent person — confined space', 'role.cp.confined') },
          { number: 'D', text: 'Scaffolding:', field: admin('Competent person — scaffolding', 'role.cp.scaffolding') },
          { number: 'E', text: 'Cranes / rigging:', field: admin('Competent person — cranes', 'role.cp.cranes') },
        ] },
        { number: '3', text: 'Qualified persons for specialized work (electrical > 50V, welding, etc.):', field: admin('Qualified personnel + certifications', 'role.qualified', { multiline: true }) },
        { number: '4', text: 'First-aid / CPR certified staff onsite (minimum 2 per EM 385-1-1 Section 03.A.02):', field: admin('First-aid / CPR holders', 'role.firstAid', { multiline: true }) },
      ],
    },

    {
      key: 'training',
      letter: 'd',
      title: 'Training & Orientation',
      intro: 'Required certifications and onboarding for every person on site.',
      items: [
        { number: '1', text: 'OSHA 10-hour construction (all field workers):', field: tpl('Roster maintained by SSHO', 'OSHA 10', 'train.osha10') },
        { number: '2', text: 'OSHA 30-hour (superintendent + SSHO):', field: sub(r.osha_training, 'SSHO OSHA training level', 'train.osha30') },
        { number: '3', text: 'EM 385-1-1 training (if USACE contract):', field: admin('EM 385-1-1 completion records', 'train.em385', { multiline: true }) },
        { number: '4', text: 'Site-specific orientation checklist (used for every new arrival):', field: admin('Site orientation checklist', 'train.orientation', { multiline: true }) },
        { number: '5', text: 'Daily huddle + weekly toolbox topic cadence:', field: tpl('Daily huddle before work start; weekly toolbox on Monday', 'Training cadence', 'train.cadence') },
      ],
    },

    {
      key: 'emergency',
      letter: 'e',
      title: 'Emergency Response',
      intro: 'What to do when things go wrong. Map + numbers posted at every gang box.',
      items: [
        { number: '1', text: 'Nearest hospital / clinic (address + route from site):', field: admin('Hospital + route', 'em.hospital', { multiline: true }) },
        { number: '2', text: 'Notification tree (911 → PM → SSHO → CO / GDA within 4 hours):', field: tpl('Per EM 385-1-1 Section 01.D', 'Notification tree', 'em.tree') },
        { number: '3', text: 'Evacuation plan + primary + secondary muster point(s):', field: admin('Evacuation + muster points', 'em.evac', { multiline: true }) },
        { number: '4', text: 'Incident reporting workflow (verbal → written → ENG Form 3394):', field: tpl('See APP section h', 'Reporting workflow', 'em.reporting') },
        { number: '5', text: 'Onsite emergency equipment (AED, first-aid kit, eyewash, spill kit) locations:', field: admin('Emergency equipment locations', 'em.equipment', { multiline: true }) },
      ],
    },

    {
      key: 'records',
      letter: 'f',
      title: 'Records & Recordkeeping',
      intro: 'Documentation retained for the government + insurance carrier.',
      items: [
        { number: '1', text: 'OSHA 300 log (updated within 7 days of any recordable):', field: tpl('Maintained by SSHO', 'OSHA 300', 'rec.osha300') },
        { number: '2', text: 'OSHA 300A summary posted Feb 1 – Apr 30 annually:', field: tpl('Posted seasonally', 'OSHA 300A', 'rec.osha300a') },
        { number: '3', text: 'Incident / near-miss reports (retained 5 years):', field: tpl('Retained 5 years', 'Incident records', 'rec.incidents') },
        { number: '4', text: 'Daily safety inspection records:', field: tpl('Filed daily by SSHO', 'Inspection records', 'rec.inspections') },
        { number: '5', text: 'Training attendance logs (OSHA + toolbox + orientation):', field: tpl('Maintained by SSHO', 'Training logs', 'rec.training') },
      ],
    },
  ]

  return {
    key: 'sshp',
    displayName: 'Site-Specific Safety & Health Plan',
    planCode: 'SSHP',
    sections,
    generatedAt: new Date().toISOString(),
    sourceSubcontractorId: selectedSub?.id ?? null,
    sourceSubcontractorName: selectedSub?.name ?? null,
  }
}
