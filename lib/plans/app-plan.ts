/**
 * Accident Prevention Plan (APP) auto-fill.
 *
 * Mirrors the USACE / EM 385-1-1 standard APP template section-for-section:
 *   Cover · Emergency Phone Numbers & Medical Facility Map · Signature Sheet
 *   b. Background Information
 *   c. Statement of Safety and Health Policy   (with A–I subitems)
 *   d. Responsibilities and Lines of Authority (1–6)
 *   e. Subcontractors and Suppliers            (1–2)
 *   f. Training                                (1–6, with 4.A–G, 5.a–b)
 *   g. Safety and Health Inspections           (1–3)
 *   h. Mishap Reporting and Investigation      (1–3)
 *   i. Plans, Programs, and Procedures         (A–J)
 *   APPENDIX — Weekly Safety Meeting (blank form)
 *   APPENDIX — ENG Form 3394 (Accident Investigation Report reference)
 *
 * Each item carries an inline field so the viewer can render "1. X: <value>"
 * with a source chip (opportunity / sub / template / admin) marking where
 * the value came from and highlighting rows still needing input.
 */

export type PlanFieldSource = 'opportunity' | 'sub' | 'template' | 'admin'

export interface PlanField {
  label: string
  value: string
  source: PlanFieldSource
  /** True when the field is missing / needs admin input. */
  needsInput?: boolean
}

/** A single numbered or lettered item within a section. */
export interface PlanItem {
  /** "1", "2", "A", "B", "a", "b" — rendered as a prefix with a period. */
  number?: string
  /** Body text — usually ends with a colon when a value follows. */
  text: string
  /** Value that fills the blank for this item. */
  field?: PlanField
  /** Nested items (e.g., section c item 1 has A–I subitems). */
  subitems?: PlanItem[]
}

/** Blank signature grid — rendered as a printable table for wet signatures. */
export interface PlanSignatureTable {
  columns: string[]
  rows: number
}

/** Weekly Safety Meeting–style checkable topic list. */
export interface PlanChecklist {
  categories: Array<{
    heading?: string
    items: string[]
  }>
  fields?: PlanField[]
}

export interface PlanSection {
  key: string
  /** Section letter (b, c, d, …) shown before the title. */
  letter?: string
  title: string
  intro?: string
  items?: PlanItem[]
  signatureTable?: PlanSignatureTable
  checklist?: PlanChecklist
  /** Standalone fields (used on the cover / emergency page). */
  fields?: PlanField[]
  /** Free-form bullet list (kept for backwards compatibility). */
  bullets?: string[]
  /** True to render as a boxed appendix (Weekly Safety Meeting, ENG 3394). */
  appendix?: boolean
}

export interface GeneratedPlan {
  key: string
  displayName: string
  planCode: string
  sections: PlanSection[]
  generatedAt: string
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
  return { label, value: value || 'Needs input', source: 'opportunity', needsInput: !value }
}
function sub(v: string | number | null | undefined, label: string): PlanField {
  const value = v == null ? '' : String(v).trim()
  return { label, value: value || 'Needs input (from selected sub)', source: 'sub', needsInput: !value }
}
function tpl(v: string, label: string): PlanField {
  return { label, value: v, source: 'template', needsInput: false }
}
function admin(label: string, placeholder = 'Needs admin input'): PlanField {
  return { label, value: placeholder, source: 'admin', needsInput: true }
}

// ── Boilerplate blocks — verbatim from the USACE template ──────────────────
const SAFETY_POLICY_COMMITMENTS: Array<[string, string]> = [
  ['A', 'The safety, health, and well-being of each and every employee, to include subcontractors.'],
  ['B', 'Requiring all employees to follow all aspects of the APP and additional company safety programs / policies.'],
  ['C', 'Holding all managers and supervisors accountable for the safety performance and awareness of all employees under their direction.'],
  ['D', 'Performing all aspects of this project in accordance with EM 385-1-1 and OSHA regulations.'],
  ['E', 'Maintaining safe and healthful working conditions.'],
  ['F', 'Providing all necessary protective equipment to ensure the safety and health of site employees, subcontractors, and the public.'],
  ['G', 'Providing site workers with the information and training required to make them fully aware of known and suspected hazards that may be encountered.'],
  ['H', 'Encouraging active involvement of employees at all levels, during the implementation and continuous improvement of the health and safety program.'],
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

const APPENDIX_A_PLAN_LIST: Array<[string, string]> = [
  ['A', 'Fall Protection and Prevention'],
  ['B', 'Excavation / Trenching'],
  ['C', 'Tree Felling and Maintenance'],
  ['D', 'Confined Space Entry'],
  ['E', 'Rope Access Work'],
  ['F', 'Hazardous Energy Control (Lockout / Tagout)'],
  ['G', 'Crane / Load Handling Equipment'],
  ['H', 'Lead Compliance'],
  ['I', 'Asbestos Abatement'],
  ['J', 'Hazard Communication'],
]

// Verbatim subject list from the USACE Weekly Safety Meeting form.
const WEEKLY_MEETING_SUBJECTS = [
  'USACE EM 385-1-1 (identify specific sections)',
  'On-site Accident Prevention Plan (or Site Safety and Health Plan)',
  'Individual protective equipment (steel-toed boots, safety glasses, etc.)',
  'Prevention of slips / falls',
  'Back injury / safe lifting techniques',
  'Fire prevention',
  'First aid',
  'Tripping hazards',
  'Equipment inspection and maintenance',
  'Hoisting equipment, winch and crane safety',
  'Ropes, hooks, chains, and slings',
  'Water safety',
  'Boat safety',
  'HAZMAT, toxic hazards, contaminated sediments, MSDS, respiratory, ventilation',
  'Biological hazards (poison ivy, ticks, wasps, mosquitoes, etc.)',
  'Staging, ladders, concrete forms, safety nets, handrails',
  'Hand tools, power tools, machinery, chain saws',
  'Vehicle operation safety',
  'Electrical grounding, temporary wiring, GFCI',
  'Lockouts / safe clearance procedures',
  'Welding, cutting',
  'Excavation hazards / rescue',
  'Loose rock / steep slopes',
  'Explosives',
  'Sanitation and waste disposal',
  'Clean-up, trash',
]

// ── Generator ──────────────────────────────────────────────────────────────
export function generateAccidentPreventionPlan(input: AppGenerateInput): GeneratedPlan {
  const { opportunity, primeCompanyName, selectedSub, otherAnticipatedSubs } = input
  const r: AppSubResponses = selectedSub?.responses ?? {}
  const contractor = (primeCompanyName ?? '').trim() || 'the Prime Contractor'
  const ssho = (r.safety_officer_name ?? '').trim()
  const sshoDisplay = ssho || '[SSHO name]'
  const location = (opportunity.placeOfPerformance || opportunity.state || '').trim()

  const sections: PlanSection[] = [
    // ── Cover ─────────────────────────────────────────────────────────────
    {
      key: 'cover',
      title: 'ACCIDENT PREVENTION PLAN',
      fields: [
        opp(opportunity.title, 'Project Name'),
        { label: 'Contractor Name', value: contractor, source: primeCompanyName ? 'admin' : 'admin', needsInput: !primeCompanyName },
        opp(opportunity.solicitationNumber, 'Contract Number'),
        tpl(new Date().toLocaleDateString('en-US'), 'Date'),
      ],
      items: [
        { text: 'Plan Preparer (Name, Title, Phone Number, & Signature):', field: admin('Plan Preparer') },
        { text: 'Plan Approver (Name, Title, Phone Number, & Signature):', field: admin('Plan Approver') },
        { text: 'Plan Concurrence (Name, Title, Phone Number, & Signature):', field: admin('Plan Concurrence') },
      ],
    },

    // ── Emergency Phone Numbers & Medical Facility Map ────────────────────
    {
      key: 'emergency',
      title: 'EMERGENCY PHONE NUMBERS AND MEDICAL FACILITY MAP',
      items: [
        {
          number: '1',
          text: 'Map with Highlighted Route, Address, and Directions:',
          field: admin('Insert map + written directions to the nearest medical facility'),
        },
        {
          number: '2',
          text: 'Emergency Phone Numbers:',
          subitems: [
            { text: 'Site Safety & Health Officer (24-hour)', field: sub(r.safety_officer_phone, 'SSHO phone') },
            { text: 'Sub Primary Contact', field: sub(r.contact_phone, 'Sub contact phone') },
            { text: 'Nearest Hospital / Clinic', field: admin('Hospital name + address + phone') },
            { text: 'Local Emergency Services', field: tpl('911', 'Local 911') },
            { text: 'Poison Control', field: tpl('1-800-222-1222', 'Poison Control') },
            { text: 'Government Designated Authority (GDA)', field: admin('GDA name + phone') },
          ],
        },
      ],
    },

    // ── Signature Sheet ───────────────────────────────────────────────────
    {
      key: 'signatures',
      title: 'SIGNATURE SHEET',
      intro: 'All employees, including subcontractors, sign below to acknowledge review of this APP.',
      signatureTable: {
        columns: ['Name', 'Signature', 'Date', 'Company'],
        rows: 20,
      },
    },

    // ── b. Background Information ─────────────────────────────────────────
    {
      key: 'background',
      letter: 'b',
      title: 'Background Information',
      items: [
        {
          number: '1',
          text: 'Project Description and Definable Features of Work:',
          field: opp(
            [opportunity.title, (r.scope_confirmation ?? '').trim()].filter(Boolean).join(' — '),
            'Project + scope',
          ),
        },
        {
          number: '2',
          text: 'Anticipated High Risk Activities:',
          field: sub(r.hazards_summary, 'High-risk activities from sub intake'),
        },
        {
          number: '3',
          text: 'List of Equipment / Machinery to be Used Onsite:',
          field: admin('Equipment / machinery list'),
        },
        {
          number: '4',
          text:
            'Activity Hazard Analyses (AHAs) have been (or will be) submitted to the Government Designated Authority (GDA) for all the Definable Features of Work prior to initiating each phase.',
          field: tpl('Acknowledged', 'AHA commitment'),
        },
      ],
    },

    // ── c. Statement of Safety and Health Policy ──────────────────────────
    {
      key: 'policy',
      letter: 'c',
      title: 'Statement of Safety and Health Policy',
      items: [
        {
          number: '1',
          text: `${contractor} is committed to:`,
          subitems: [
            ...SAFETY_POLICY_COMMITMENTS.map(([n, t]): PlanItem => ({
              number: n,
              text: t,
              field: tpl('Acknowledged', `Commitment ${n}`),
            })),
            {
              number: 'I',
              text: 'Additional Safety Policy Information:',
              field: admin('Additional safety policy notes'),
            },
          ],
        },
        {
          number: '3',
          text: 'Contractor Safety Goals and Objectives:',
          field: admin('Safety goals + measurable objectives'),
        },
        {
          number: '4',
          text: 'Contractor Accident Experience (OSHA 300 forms, or equivalent) are available if requested by the GDA.',
          field: tpl('Acknowledged', 'Accident experience statement'),
        },
      ],
    },

    // ── d. Responsibilities and Lines of Authority ────────────────────────
    {
      key: 'responsibilities',
      letter: 'd',
      title: 'Responsibilities and Lines of Authority',
      items: [
        {
          number: '1',
          text: 'The lines of authority for this project and at the corporate level (include names and titles):',
          field: admin('Names + titles for project + corporate lines of authority'),
        },
        {
          number: '2',
          text: `${sshoDisplay} is the Site Safety and Health Officer. He/she is responsible for enforcing the requirements of this APP for the duration of the project. The SSHO has the authority to immediately correct all areas of noncompliance and can stop work.`,
          field: sub(r.safety_officer_name, 'Site Safety and Health Officer (SSHO)'),
        },
        {
          number: '3',
          text: `${sshoDisplay} has submitted a 10-Hour OSHA card (or higher), along with their related experience and other qualifications for review.`,
          field: sub(r.osha_training, 'SSHO OSHA training level'),
        },
        {
          number: '4',
          text: `No work will be performed by ${contractor} or any subcontractors unless the SSHO (or an approved Alternate SSHO) is onsite.`,
          field: tpl('Acknowledged', 'SSHO presence requirement'),
        },
        {
          number: '5',
          text:
            'List of Competent Persons (CPs) and their area of proficiency — submit trainings / qualifications for review (Fall Protection, Excavation / Trenching, Confined Spaces, Scaffolding, Cranes / Rigging, etc.):',
          field: admin('CP list + areas of proficiency'),
        },
        {
          number: '6',
          text: `Policies and procedures regarding noncompliance with safety requirements. ${contractor}'s disciplinary actions for violation of safety requirements:`,
          field: admin('Progressive discipline steps for safety violations'),
        },
      ],
    },

    // ── e. Subcontractors and Suppliers ───────────────────────────────────
    {
      key: 'subs',
      letter: 'e',
      title: 'Subcontractors and Suppliers',
      items: [
        {
          number: '1',
          text: `${contractor} requires its subcontractors to work in a responsible and safe manner. Subcontractors for this project will be required to adhere to applicable requirements set forth in EM 385-1-1 and this APP.`,
          field: tpl('Acknowledged', 'Subcontractor safety requirement'),
        },
        {
          number: '2',
          text: 'List of Anticipated Subcontractors (Name and Roles):',
          subitems: (() => {
            const rows: PlanItem[] = []
            if (selectedSub?.name) {
              rows.push({
                text: `${selectedSub.name}${r.scope_confirmation ? ` — ${r.scope_confirmation}` : ''}`,
                field: tpl('Selected for bid', 'Selected sub'),
              })
            }
            for (const s of otherAnticipatedSubs ?? []) {
              rows.push({
                text: `${s.name}${s.role ? ` — ${s.role}` : ''}`,
                field: tpl('Anticipated', 'Anticipated sub'),
              })
            }
            if (rows.length === 0) {
              rows.push({ text: 'No subcontractors listed yet.', field: admin('Anticipated subs') })
            }
            return rows
          })(),
        },
      ],
    },

    // ── f. Training ───────────────────────────────────────────────────────
    {
      key: 'training',
      letter: 'f',
      title: 'Training',
      items: [
        {
          number: '1',
          text:
            'The following Safety and Occupational Health topics will be briefed to employees on their first day onsite, during the initial site safety orientation:',
          subitems: STANDARD_ORIENTATION_TOPICS.map((t): PlanItem => ({ text: t, field: tpl('Included', 'Orientation topic') })),
        },
        {
          number: '2',
          text:
            'All employees, including subcontractors, have reviewed this APP during the safety orientation and have signed the included signature sheet.',
          field: tpl('Acknowledged', 'APP review attestation'),
        },
        {
          number: '3',
          text: 'The following are mandatory trainings and certifications applicable to this project (Crane Operators, CDL, Diver, SPRAT, etc.):',
          field: admin('Mandatory trainings + certifications for this scope'),
        },
        {
          number: '4',
          text: 'All site personnel have been briefed on the site\'s emergency response procedures. This includes but is not limited to:',
          subitems: [
            { number: 'A', text: 'Emergency Communications / Signals:', field: admin('Communication method + signals') },
            { number: 'B', text: 'Rally point(s):', field: admin('Primary + secondary rally points') },
            { number: 'C', text: 'Emergency Phone Numbers (refer to page 2 of the APP).', field: tpl('See emergency page', 'Reference') },
            { number: 'D', text: 'Locations of emergency equipment:', field: admin('First-aid, eyewash, spill-kit, fire-extinguisher locations') },
            { number: 'E', text: 'Roles / Responsibilities:', field: admin('Who does what in an emergency') },
            { number: 'F', text: 'A map to the closest medical facility is included with the APP.', field: tpl('Included', 'Medical facility map') },
            { number: 'G', text: 'Additional Emergency Information:', field: admin('Additional emergency info') },
          ],
        },
        {
          number: '5',
          text: 'First Aid / CPR certificates, in accordance with EM 385-1-1 Section 03.A.02, have been submitted for two onsite employees:',
          subitems: [
            { number: 'a', text: 'First Aid / CPR certificate holder #1', field: admin('Name + certification date') },
            { number: 'b', text: 'First Aid / CPR certificate holder #2', field: admin('Name + certification date') },
          ],
        },
        {
          number: '6',
          text: `Safety meetings / toolbox talks will be held by the SSHO / Competent Person: ${sshoDisplay}, on a weekly basis or at the beginning of each new phase of work (whichever is sooner). Minutes will be documented and will include attendees' names, meeting duration, and topics discussed.`,
          field: sub(r.safety_officer_name, 'Safety meeting lead'),
        },
      ],
    },

    // ── g. Safety and Health Inspections ──────────────────────────────────
    {
      key: 'inspections',
      letter: 'g',
      title: 'Safety and Health Inspections',
      items: [
        {
          number: '1',
          text: `Daily safety and health inspections will be performed in accordance with EM 385-1-1, Section 01.A.13. These inspections will be conducted by the SSHO / Competent Person: ${sshoDisplay}. All inspections must be documented and any deficiencies that cannot be immediately corrected will be tracked on the deficiency log below, or equivalent.`,
          field: sub(r.safety_officer_name, 'Inspector'),
        },
        {
          number: '2',
          text: 'List any anticipated external inspections (EPA, OSHA, State, other Federal Agencies, etc.):',
          field: admin('Anticipated external inspections'),
        },
        {
          number: '3',
          text: 'Deficiency Log:',
          field: admin('Log deficiencies here (or attach equivalent log format)'),
        },
      ],
    },

    // ── h. Mishap Reporting and Investigation ─────────────────────────────
    {
      key: 'mishap',
      letter: 'h',
      title: 'Mishap Reporting and Investigation',
      items: [
        {
          number: '1',
          text: `${contractor} is responsible for reporting the exposure data (man-hours worked) to the GDA no later than close of business on the 5th calendar day of the following month.`,
          field: tpl('Acknowledged', 'Monthly exposure reporting'),
        },
        {
          number: '2',
          text:
            'All accidents and near misses will be investigated by the Contractor. All work-related recordable injuries, illnesses, and property-damage accidents (excluding on-the-road vehicle accidents) with property damage exceeding $5,000 will be verbally reported to the GDA within 4 hours. Serious accidents as described in EM 385-1-1 Section 01.D shall be immediately reported to the GDA. ENG Form 3394 shall be completed and submitted to the GDA within five working days of the incident.',
          field: tpl('Acknowledged', 'Reporting protocol'),
        },
        {
          number: '3',
          text: `${sshoDisplay} is responsible for completing the accident notifications, investigations, and reports.`,
          field: sub(r.safety_officer_name, 'Accident report owner'),
        },
      ],
    },

    // ── i. Plans, Programs, and Procedures ────────────────────────────────
    {
      key: 'plans',
      letter: 'i',
      title: 'Plans, Programs, and Procedures',
      intro:
        'Additional site-specific plans (listed in EM 385-1-1, Appendix A, Section i) are required to be included as amendments to this APP. Only the plans applicable to the work being performed are required to be submitted. A few common plans include but are not limited to:',
      items: [
        {
          number: '1',
          text: 'Common plans applicable to construction scopes:',
          subitems: APPENDIX_A_PLAN_LIST.map(([n, t]): PlanItem => ({
            number: n,
            text: t,
            field: tpl('Include if applicable', 'Amendment'),
          })),
        },
      ],
    },

    // ── APPENDIX — Weekly Safety Meeting ──────────────────────────────────
    {
      key: 'weekly',
      title: 'APPENDIX · Weekly Safety Meeting',
      appendix: true,
      intro:
        'Blank Weekly Safety Meeting form — printed and completed by the SSHO / Competent Person at each weekly meeting.',
      checklist: {
        fields: [
          admin('Date Held'),
          admin('Time'),
          { label: 'Contractor', value: contractor, source: 'admin', needsInput: !primeCompanyName },
          opp(opportunity.solicitationNumber, 'Contract No.'),
          admin('Personnel Present (Contractor / Sub / Government)'),
        ],
        categories: [
          { heading: 'Subjects Discussed (check items covered during meeting)', items: WEEKLY_MEETING_SUBJECTS },
        ],
      },
    },

    // ── APPENDIX — ENG Form 3394 ──────────────────────────────────────────
    {
      key: 'eng3394',
      title: 'APPENDIX · ENG Form 3394 — Accident Investigation Report',
      appendix: true,
      intro:
        'USACE ENG Form 3394 (Accident Investigation Report) is included as a blank template. Complete and submit to the GDA within 5 working days of any reportable incident (see section h.2). Refer to USACE Supplement to AR 385-40 for completion instructions.',
      items: [
        { number: '1', text: 'Accident Classification (mark all applicable boxes)', field: tpl('Blank — complete at incident', 'Blank form') },
        { number: '2', text: 'Personal Data (name, age, sex, SSN, grade, job series / title, duty status)', field: tpl('Blank — complete at incident', 'Blank form') },
        { number: '3', text: 'General Information (date, time, location, contractor name, contract number, type of contract)', field: tpl('Blank — complete at incident', 'Blank form') },
        { number: '4', text: 'Construction Activities (activity + equipment code)', field: tpl('Blank — complete at incident', 'Blank form') },
        { number: '5', text: 'Injury / Illness Information (severity, days lost / hospitalized / restricted, body part, nature, type + source)', field: tpl('Blank — complete at incident', 'Blank form') },
        { number: '10', text: 'Accident Description — full sequence of events', field: tpl('Blank — complete at incident', 'Blank form') },
        { number: '11', text: 'Causal Factors (design, inspection, physical condition, operating procedures, job practices, human, environmental, chemical, office, support, PPE, drugs / alcohol)', field: tpl('Blank — complete at incident', 'Blank form') },
        { number: '13', text: 'Direct + Indirect Cause(s)', field: tpl('Blank — complete at incident', 'Blank form') },
        { number: '14', text: 'Action(s) Taken, Anticipated, or Recommended to Eliminate Cause(s)', field: tpl('Blank — complete at incident', 'Blank form') },
        { number: '16', text: 'Management Review (1st)', field: tpl('Blank — complete at incident', 'Blank form') },
        { number: '17', text: 'Management Review (2nd)', field: tpl('Blank — complete at incident', 'Blank form') },
        { number: '18', text: 'Safety and Occupational Health Office Review', field: tpl('Blank — complete at incident', 'Blank form') },
        { number: '19', text: 'Command Approval', field: tpl('Blank — complete at incident', 'Blank form') },
      ],
    },
  ]

  // Location makes it into the emergency page as an inline field on the map item.
  if (location) {
    const eSection = sections.find((s) => s.key === 'emergency')
    if (eSection?.items?.[0]) {
      eSection.items[0].field = opp(location, 'Site / place of performance')
    }
  }

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

// ── Completion — walks items + subitems + fields so callers can compute a %.
export function collectPlanFields(plan: GeneratedPlan): PlanField[] {
  const out: PlanField[] = []
  const visit = (item: PlanItem) => {
    if (item.field) out.push(item.field)
    for (const s of item.subitems ?? []) visit(s)
  }
  for (const section of plan.sections) {
    for (const f of section.fields ?? []) out.push(f)
    for (const i of section.items ?? []) visit(i)
    for (const f of section.checklist?.fields ?? []) out.push(f)
  }
  return out
}
