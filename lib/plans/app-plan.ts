/**
 * Accident Prevention Plan (APP) auto-fill.
 *
 * Structure mirrors the standard USACE/EM 385-1-1 APP form (sections a–i +
 * the emergency phone / medical facility page). Fields are populated from
 * three sources, tagged so the UI can show provenance:
 *   - `opportunity` facts (project name, contract number, place of performance)
 *   - `sub` responses from the selected subcontractor's sub_quote intake
 *     (safety officer, hazards, OSHA training, address, contact, etc.)
 *   - boilerplate template text (safety policy statement, cadence language,
 *     EM 385-1-1 references)
 *
 * Missing fields render as "Needs input" placeholders in the viewer so the
 * user can see at a glance what still has to be filled by the admin.
 */

export type PlanFieldSource = 'opportunity' | 'sub' | 'template' | 'admin'

export interface PlanField {
  label: string
  value: string
  source: PlanFieldSource
  /** True when the field is missing/needs admin input. */
  needsInput?: boolean
}

export interface PlanSection {
  key: string
  title: string
  intro?: string
  fields: PlanField[]
  /** Free-form bullet list — for policy statements, lists of plans, etc. */
  bullets?: string[]
}

export interface GeneratedPlan {
  key: string
  displayName: string
  planCode: string
  sections: PlanSection[]
  generatedAt: string
  /** ID of the sub whose sub_quote responses were used (or null if none). */
  sourceSubcontractorId: string | null
  sourceSubcontractorName: string | null
}

// ── Sub responses shape (subset of sub_quote fields we care about) ─────────
export interface AppSubResponses {
  company_name?: string
  address?: string
  contact_name?: string
  contact_email?: string
  contact_phone?: string
  safety_officer_name?: string
  safety_officer_phone?: string
  osha_training?: string
  hazards_summary?: string
  scope_confirmation?: string
  crew_size?: string | number
  duration_days?: string | number
  qc_officer_name?: string
  qc_officer_phone?: string
}

export interface AppSelectedSub {
  id: string
  name: string
  responses: AppSubResponses | null
}

export interface AppGenerateInput {
  opportunity: {
    title: string
    solicitationNumber: string
    agency?: string | null
    state?: string | null
    placeOfPerformance?: string | null
  }
  primeCompanyName?: string | null
  selectedSub?: AppSelectedSub | null
  otherAnticipatedSubs?: Array<{ name: string; role?: string | null }>
}

// ── Value helpers ──────────────────────────────────────────────────────────
function opp(v: string | null | undefined, label: string): PlanField {
  const value = (v ?? '').trim()
  return {
    label,
    value: value || 'Needs input',
    source: 'opportunity',
    needsInput: !value,
  }
}
function sub(v: string | number | null | undefined, label: string): PlanField {
  const value = v == null ? '' : String(v).trim()
  return {
    label,
    value: value || 'Needs input (from selected sub)',
    source: 'sub',
    needsInput: !value,
  }
}
function tpl(v: string, label: string): PlanField {
  return { label, value: v, source: 'template', needsInput: false }
}
function admin(label: string, placeholder = 'Needs admin input'): PlanField {
  return { label, value: placeholder, source: 'admin', needsInput: true }
}

// ── Boilerplate blocks ─────────────────────────────────────────────────────
const SAFETY_POLICY_COMMITMENTS = [
  'The safety, health, and well-being of each and every employee, including subcontractors.',
  'Requiring all employees to follow all aspects of the APP and additional company safety programs / policies.',
  'Holding all managers and supervisors accountable for the safety performance and awareness of all employees under their direction.',
  'Performing all aspects of this project in accordance with EM 385-1-1 and OSHA regulations.',
  'Maintaining safe and healthful working conditions.',
  'Providing all necessary protective equipment to ensure the safety and health of site employees, subcontractors, and the public.',
  'Providing site workers with the information and training required to make them fully aware of known and suspected hazards that may be encountered.',
  'Encouraging active involvement of employees at all levels, during the implementation and continuous improvement of the health and safety program.',
]

const STANDARD_ORIENTATION_TOPICS = [
  'Site-specific hazards for this scope of work',
  'Emergency communications, rally points, and evacuation procedures',
  'Personal protective equipment (PPE) required on this site',
  'Reporting near-misses, incidents, and unsafe conditions',
  'Housekeeping, waste handling, and site cleanliness',
  'Vehicle and equipment traffic patterns',
  'Environmental protection measures (spill, storm water, dust control)',
  'Review of this APP and the signature sheet',
]

const APPENDIX_A_PLAN_LIST = [
  'Fall Protection and Prevention',
  'Excavation / Trenching',
  'Tree Felling and Maintenance',
  'Confined Space Entry',
  'Rope Access Work',
  'Hazardous Energy Control (Lockout / Tagout)',
  'Crane / Load Handling Equipment',
  'Lead Compliance',
  'Asbestos Abatement',
  'Hazard Communication',
]

// ── Generator ──────────────────────────────────────────────────────────────
export function generateAccidentPreventionPlan(input: AppGenerateInput): GeneratedPlan {
  const { opportunity, primeCompanyName, selectedSub, otherAnticipatedSubs } = input
  const r: AppSubResponses = selectedSub?.responses ?? {}
  const contractor = (primeCompanyName ?? '').trim() || 'the Prime Contractor'
  const location = (opportunity.placeOfPerformance || opportunity.state || '').trim() || 'Needs input'

  const sections: PlanSection[] = [
    {
      key: 'cover',
      title: 'Cover Page',
      fields: [
        opp(opportunity.title, 'Project Name'),
        { label: 'Contractor Name', value: contractor, source: 'admin', needsInput: !primeCompanyName },
        opp(opportunity.solicitationNumber, 'Contract Number'),
        tpl(new Date().toLocaleDateString('en-US'), 'Date'),
        admin('Plan Preparer (Name, Title, Phone, Signature)'),
        admin('Plan Approver (Name, Title, Phone, Signature)'),
        admin('Plan Concurrence (Name, Title, Phone, Signature)'),
      ],
    },
    {
      key: 'emergency',
      title: 'Emergency Phone Numbers & Medical Facility Map',
      intro: 'Route, address, and directions to the nearest medical facility, plus emergency contacts.',
      fields: [
        opp(location, 'Facility / Site Location'),
        admin('Nearest Hospital / Clinic Name & Address'),
        admin('Route Map (Insert)'),
        admin('Directions'),
        sub(r.safety_officer_name, 'Site Safety Officer'),
        sub(r.safety_officer_phone, 'Site Safety Officer Phone (24-hour)'),
        sub(r.contact_name, 'Sub Primary Contact'),
        sub(r.contact_phone, 'Sub Primary Contact Phone'),
        admin('Local 911 / Fire / Police (if different)', '911'),
        admin('Poison Control', '1-800-222-1222'),
      ],
    },
    {
      key: 'background',
      title: 'b. Background Information',
      fields: [
        opp(opportunity.title, 'Project Description'),
        sub(r.scope_confirmation, 'Definable Features of Work (scope confirmed by sub)'),
        sub(r.hazards_summary, 'Anticipated High-Risk Activities'),
        admin('List of Equipment / Machinery to Be Used Onsite'),
        tpl(
          'Activity Hazard Analyses (AHAs) will be submitted to the Government Designated Authority (GDA) for all Definable Features of Work prior to initiating each phase.',
          'AHA Commitment',
        ),
      ],
    },
    {
      key: 'policy',
      title: 'c. Statement of Safety and Health Policy',
      intro: `${contractor} is committed to:`,
      bullets: SAFETY_POLICY_COMMITMENTS,
      fields: [
        admin('Additional Safety Policy Information'),
        admin('Contractor Safety Goals and Objectives'),
        tpl(
          'Contractor Accident Experience (OSHA 300 forms, or equivalent) are available if requested by the GDA.',
          'Accident Experience Statement',
        ),
      ],
    },
    {
      key: 'responsibilities',
      title: 'd. Responsibilities and Lines of Authority',
      fields: [
        admin('Lines of authority for the project and corporate level (names + titles)'),
        sub(r.safety_officer_name, 'Site Safety and Health Officer (SSHO)'),
        {
          label: 'SSHO OSHA Training Level',
          value: (r.osha_training ?? '').trim() || 'Needs input (from selected sub)',
          source: 'sub',
          needsInput: !(r.osha_training ?? '').trim(),
        },
        tpl(
          `No work will be performed by ${contractor} or any subcontractors unless the SSHO (or an approved Alternate SSHO) is onsite.`,
          'SSHO Presence Requirement',
        ),
        admin('List of Competent Persons (CPs) + areas of proficiency (Fall Protection, Excavation, Confined Spaces, Scaffolding, Cranes / Rigging)'),
        admin('Policies for noncompliance with safety requirements (disciplinary actions)'),
      ],
    },
    {
      key: 'subs',
      title: 'e. Subcontractors and Suppliers',
      intro: `${contractor} requires its subcontractors to work in a responsible and safe manner. Subcontractors for this project will adhere to the applicable requirements set forth in EM 385-1-1 and this APP.`,
      bullets: [
        ...(selectedSub?.name
          ? [`${selectedSub.name}${r.scope_confirmation ? ` — ${r.scope_confirmation}` : ''}`]
          : []),
        ...((otherAnticipatedSubs ?? []).map(
          (s) => `${s.name}${s.role ? ` — ${s.role}` : ''}`,
        )),
      ],
      fields: [
        ...((selectedSub || (otherAnticipatedSubs?.length ?? 0) > 0)
          ? []
          : [admin('List of Anticipated Subcontractors (Name and Roles)')]),
      ],
    },
    {
      key: 'training',
      title: 'f. Training',
      intro: 'Safety and Occupational Health topics briefed on the first day onsite during the initial site safety orientation.',
      bullets: STANDARD_ORIENTATION_TOPICS,
      fields: [
        tpl(
          'All employees, including subcontractors, have reviewed this APP during the safety orientation and have signed the included signature sheet.',
          'APP Review Attestation',
        ),
        admin('Mandatory trainings and certifications applicable to this project (Crane Operators, CDL, SPRAT, etc.)'),
        admin('Emergency Communications / Signals'),
        admin('Rally Point(s)'),
        admin('Locations of Emergency Equipment'),
        admin('Emergency Roles / Responsibilities'),
        tpl(
          'A map to the closest medical facility is included with the APP (see Emergency Phone Numbers & Medical Facility Map).',
          'Medical Facility Map',
        ),
        admin('First Aid / CPR certificate holder #1'),
        admin('First Aid / CPR certificate holder #2'),
        sub(r.safety_officer_name, 'SSHO / Competent Person conducting weekly safety meetings'),
      ],
    },
    {
      key: 'inspections',
      title: 'g. Safety and Health Inspections',
      fields: [
        sub(r.safety_officer_name, 'SSHO / Competent Person conducting daily inspections'),
        tpl(
          'Daily safety and health inspections will be performed in accordance with EM 385-1-1, Section 01.A.13. All inspections must be documented and any deficiencies that cannot be immediately corrected will be tracked on the deficiency log.',
          'Inspection Cadence',
        ),
        admin('Anticipated external inspections (EPA, OSHA, State, other Federal Agencies)'),
      ],
    },
    {
      key: 'mishap',
      title: 'h. Mishap Reporting and Investigation',
      fields: [
        sub(r.safety_officer_name, 'Responsible for reporting exposure data (man-hours) to the GDA'),
        tpl(
          'All accidents and near misses will be investigated by the Contractor. All work-related recordable injuries, illnesses, and property damage accidents (excluding on-the-road vehicle accidents) with property damage exceeding $5,000 will be verbally reported to the GDA within 4 hours. Serious accidents as described in EM 385-1-1 Section 01.D shall be immediately reported to the GDA. ENG Form 3394 shall be completed and submitted to the GDA within five working days of the incident.',
          'Reporting Protocol',
        ),
        sub(r.safety_officer_name, 'Responsible for completing accident notifications, investigations, and reports'),
      ],
    },
    {
      key: 'plans',
      title: 'i. Plans, Programs, and Procedures',
      intro: 'Additional site-specific plans (EM 385-1-1, Appendix A, Section i) required as amendments to this APP. Only plans applicable to the work being performed are required to be submitted. Common plans include:',
      bullets: APPENDIX_A_PLAN_LIST,
      fields: [admin('Other Remarks')],
    },
  ]

  return {
    key: 'app',
    displayName: 'Accident Prevention Plan',
    planCode: 'APP',
    sections,
    generatedAt: new Date().toISOString(),
    sourceSubcontractorId: selectedSub?.id ?? null,
    sourceSubcontractorName: selectedSub?.name ?? null,
  }
}
