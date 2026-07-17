import type { RequirementTemplate, SubmittalGroupInfo, SubmittalGroup } from './types'

// Catalog of prework-plan submittals produced from typical federal
// construction solicitations. Keyed to what the SOW at THRO 348988 (and
// most Div 01 short-form specs) require at the preconstruction conference.

export const SUBMITTAL_GROUPS: Record<SubmittalGroup, SubmittalGroupInfo> = {
  super_letter: {
    key: 'super_letter',
    displayName: 'Project Superintendent Designation',
    shortName: 'Superintendent',
    description: 'Letter designating the on-site superintendent and their qualifications.',
    sowReference: 'Div 01 §9.1.C.1',
  },
  sub_list: {
    key: 'sub_list',
    displayName: 'Subcontractor List',
    shortName: 'Sub List',
    description: 'Full list of subcontractors, trades, addresses, and points of contact.',
    sowReference: 'Div 01 §9.1.C.5',
  },
  sf1413: {
    key: 'sf1413',
    displayName: 'SF-1413 Labor Standards Certification',
    shortName: 'SF-1413',
    description: 'Signed certification from each subcontractor of compliance with labor standards.',
    sowReference: 'Div 01 §9.1.C.6',
  },
  insurance: {
    key: 'insurance',
    displayName: 'Insurance & Bonding',
    shortName: 'Insurance',
    description: 'Certificates of liability insurance, workers comp, and any required performance bonds.',
    sowReference: 'Div 01 §9.1.C',
  },
  app: {
    key: 'app',
    displayName: 'Accident Prevention Plan',
    shortName: 'APP',
    description: 'Site-specific safety plan — supervisor, first aid, training, JHA per phase, emergency planning.',
    sowReference: 'Div 01 §7.2.A',
  },
  qcp: {
    key: 'qcp',
    displayName: 'Quality Control Plan',
    shortName: 'QCP',
    description: 'Inspection and testing plan, QC responsibilities, corrective action procedures.',
    sowReference: 'Div 01 §9.1.C.7',
  },
  wmp: {
    key: 'wmp',
    displayName: 'Waste Management Plan',
    shortName: 'WMP',
    description: 'Waste and recycling handling, hauler information, disposal documentation approach.',
    sowReference: 'Div 01 §9.1.C.8',
  },
  sov: {
    key: 'sov',
    displayName: 'Schedule of Values',
    shortName: 'Schedule of Values',
    description: 'Per-CLIN pricing breakdown — labor, material, equipment. Feeds prime bid.',
    sowReference: 'Div 01 §9.4',
  },
  quote_submission: {
    key: 'quote_submission',
    displayName: 'Submit your quote',
    shortName: 'Quote',
    description: 'Basic company info and your priced quote for this project — in one form.',
  },
}

export const REQUIREMENT_TEMPLATES: RequirementTemplate[] = [
  // ─── Superintendent Letter ────────────────────────────────────────────────
  {
    key: 'super_letter_designation',
    submittalGroup: 'super_letter',
    displayName: 'Designate on-site Superintendent',
    purpose: 'Provide the name, qualifications, and 24-hour contact for your on-site superintendent.',
    suggestedRole: 'admin',
    defaultDueDays: 10,
    formSchema: [
      {
        title: 'Superintendent',
        fields: [
          { key: 'super_name', label: 'Full name', type: 'text', required: true },
          { key: 'super_title', label: 'Title / role', type: 'text', placeholder: 'Site Superintendent' },
          { key: 'super_phone_day', label: 'Daytime phone', type: 'phone', required: true },
          { key: 'super_phone_24h', label: '24-hour emergency phone', type: 'phone', required: true,
            helpText: 'Some project areas have limited cell coverage.' },
          { key: 'super_email', label: 'Email', type: 'email', required: true },
          { key: 'super_years_experience', label: 'Years of relevant experience', type: 'number' },
          { key: 'super_resume', label: 'Resume / CV (PDF)', type: 'file', accept: 'application/pdf' },
        ],
      },
    ],
  },

  // ─── SF-1413 ──────────────────────────────────────────────────────────────
  {
    key: 'sf1413_signature',
    submittalGroup: 'sf1413',
    displayName: 'SF-1413 labor compliance statement',
    purpose: 'Signed statement certifying subcontractor compliance with applicable labor standards (Davis-Bacon / Service Contract Act).',
    suggestedRole: 'principal',
    defaultDueDays: 10,
    formSchema: [
      {
        title: 'Signatory',
        fields: [
          { key: 'signatory_name', label: 'Authorized signatory name', type: 'text', required: true },
          { key: 'signatory_title', label: 'Title', type: 'text', required: true,
            placeholder: 'e.g. President, Owner, Managing Member' },
          { key: 'signatory_email', label: 'Email', type: 'email', required: true },
          { key: 'signed_date', label: 'Date signed', type: 'date', required: true },
        ],
      },
      {
        title: 'Certification',
        description:
          'By submitting this form, the signatory certifies compliance with all applicable federal labor standards (SF-1413) for work performed under this subcontract.',
        fields: [
          { key: 'signed_form_upload', label: 'Upload signed SF-1413 (PDF)', type: 'file',
            accept: 'application/pdf', required: true,
            helpText: 'Download the current SF-1413 from GSA forms library, sign, and upload.' },
          { key: 'notes', label: 'Notes (optional)', type: 'textarea' },
        ],
      },
    ],
  },

  // ─── Insurance ────────────────────────────────────────────────────────────
  {
    key: 'insurance_certificate',
    submittalGroup: 'insurance',
    displayName: 'Certificate of Insurance',
    purpose: 'Current COI showing general liability, workers comp, and auto coverage that meets solicitation minimums.',
    suggestedRole: 'admin',
    defaultDueDays: 10,
    formSchema: [
      {
        title: 'Carrier',
        fields: [
          { key: 'carrier_name', label: 'Insurance carrier', type: 'text', required: true },
          { key: 'agent_name', label: 'Agent / broker name', type: 'text' },
          { key: 'agent_phone', label: 'Agent phone', type: 'phone' },
          { key: 'agent_email', label: 'Agent email', type: 'email' },
        ],
      },
      {
        title: 'Coverage',
        fields: [
          { key: 'gl_limit', label: 'General liability limit', type: 'currency',
            placeholder: 'e.g. 1000000', helpText: 'Per-occurrence limit in USD.' },
          { key: 'wc_state', label: 'Workers comp state(s) covered', type: 'text' },
          { key: 'auto_limit', label: 'Auto liability limit', type: 'currency' },
          { key: 'umbrella_limit', label: 'Umbrella / excess limit (optional)', type: 'currency' },
          { key: 'effective_date', label: 'Policy effective date', type: 'date', required: true },
          { key: 'expiration_date', label: 'Policy expiration date', type: 'date', required: true },
        ],
      },
      {
        title: 'Documents',
        fields: [
          { key: 'coi_upload', label: 'ACORD 25 / COI (PDF)', type: 'file',
            accept: 'application/pdf', required: true },
          { key: 'wc_upload', label: 'Workers comp certificate (PDF)', type: 'file',
            accept: 'application/pdf' },
        ],
      },
    ],
  },

  // ─── APP components ───────────────────────────────────────────────────────
  {
    key: 'app_safety_officer',
    submittalGroup: 'app',
    displayName: 'Site safety supervisor + qualifications',
    purpose: 'Name the person responsible for your APP and provide their safety credentials.',
    suggestedRole: 'safety',
    defaultDueDays: 10,
    formSchema: [
      {
        title: 'Safety Supervisor',
        fields: [
          { key: 'safety_name', label: 'Full name', type: 'text', required: true },
          { key: 'safety_title', label: 'Title', type: 'text' },
          { key: 'safety_phone', label: 'Phone', type: 'phone', required: true },
          { key: 'safety_email', label: 'Email', type: 'email', required: true },
        ],
      },
      {
        title: 'Credentials',
        fields: [
          { key: 'osha10_date', label: 'OSHA-10 completion date', type: 'date' },
          { key: 'osha30_date', label: 'OSHA-30 completion date', type: 'date' },
          { key: 'first_aid_expiry', label: 'First aid / CPR expiration', type: 'date' },
          { key: 'other_certs', label: 'Other certifications', type: 'textarea',
            helpText: 'CHST, CSP, HAZWOPER, competent-person designations, etc.' },
          { key: 'cert_uploads', label: 'Upload certificates (PDF or images)', type: 'file',
            accept: 'application/pdf,image/*', multiple: true },
        ],
      },
    ],
  },

  {
    key: 'app_jha',
    submittalGroup: 'app',
    displayName: 'Job Hazard Analysis by work phase',
    purpose: 'For each phase of your work, list the hazards and how you\'ll mitigate them.',
    suggestedRole: 'safety',
    defaultDueDays: 10,
    formSchema: [
      {
        title: 'Job Hazard Analysis',
        description:
          'The solicitation explicitly rejects generic APPs. List real, site-specific hazards from your scope of work.',
        fields: [
          { key: 'jha_phases', label: 'Work phases (one per line)', type: 'textarea', required: true,
            placeholder: 'Mobilization\nSurface preparation\nAsphalt placement\nCompaction\nDemobilization' },
          { key: 'jha_hazards', label: 'Hazards per phase', type: 'textarea', required: true,
            helpText: 'For each phase, list top 2–3 hazards (e.g. heat stress during placement, moving equipment during compaction).' },
          { key: 'jha_mitigations', label: 'Mitigation for each hazard', type: 'textarea', required: true },
          { key: 'jha_upload', label: 'Upload JHA form (optional PDF)', type: 'file',
            accept: 'application/pdf,image/*', multiple: true },
        ],
      },
    ],
  },

  {
    key: 'app_emergency_contacts',
    submittalGroup: 'app',
    displayName: 'Emergency response info',
    purpose: 'Emergency contacts, nearest medical facility, and spill/fire response plan.',
    suggestedRole: 'safety',
    defaultDueDays: 10,
    formSchema: [
      {
        title: 'Nearest Emergency Services',
        fields: [
          { key: 'medical_facility_name', label: 'Nearest hospital / clinic', type: 'text', required: true },
          { key: 'medical_facility_address', label: 'Address', type: 'text', required: true },
          { key: 'medical_facility_phone', label: 'Phone', type: 'phone' },
          { key: 'medical_drive_time', label: 'Estimated drive time from site (minutes)', type: 'number' },
        ],
      },
      {
        title: 'On-site Emergency Contacts',
        fields: [
          { key: 'primary_emergency_name', label: 'Primary contact name', type: 'text', required: true },
          { key: 'primary_emergency_phone', label: 'Phone (24 hour)', type: 'phone', required: true },
          { key: 'backup_emergency_name', label: 'Backup contact name', type: 'text' },
          { key: 'backup_emergency_phone', label: 'Backup phone', type: 'phone' },
        ],
      },
      {
        title: 'Spill / Fire Response',
        fields: [
          { key: 'spill_kit_location', label: 'Spill kit location on site', type: 'text' },
          { key: 'fire_extinguisher_count', label: 'Fire extinguishers on site', type: 'number' },
          { key: 'response_notes', label: 'Additional response procedures', type: 'textarea' },
        ],
      },
    ],
  },

  // ─── QCP ──────────────────────────────────────────────────────────────────
  {
    key: 'qcp_officer_and_plan',
    submittalGroup: 'qcp',
    displayName: 'Quality Control officer + inspection plan',
    purpose: 'Name your QC officer and describe how you\'ll inspect and test the work.',
    suggestedRole: 'qc',
    defaultDueDays: 10,
    formSchema: [
      {
        title: 'QC Officer',
        fields: [
          { key: 'qc_name', label: 'Full name', type: 'text', required: true },
          { key: 'qc_title', label: 'Title', type: 'text' },
          { key: 'qc_phone', label: 'Phone', type: 'phone' },
          { key: 'qc_email', label: 'Email', type: 'email', required: true },
        ],
      },
      {
        title: 'Inspection & Testing',
        fields: [
          { key: 'testing_lab_name', label: 'Independent testing lab (if used)', type: 'text' },
          { key: 'inspection_frequency', label: 'Inspection frequency', type: 'text',
            placeholder: 'e.g. Daily during placement, weekly overall walkthrough' },
          { key: 'test_types', label: 'Test types & thresholds', type: 'textarea', required: true,
            helpText: 'For asphalt paving: density (>= 94%), thickness tolerance (+ 1/4"), surface smoothness (1/8" over 10 ft).' },
          { key: 'nonconformance_procedure', label: 'Non-conformance / corrective action procedure', type: 'textarea', required: true },
          { key: 'qcp_upload', label: 'Upload full QCP document (optional)', type: 'file',
            accept: 'application/pdf', multiple: true },
        ],
      },
    ],
  },

  // ─── WMP ──────────────────────────────────────────────────────────────────
  {
    key: 'wmp_hauler_and_plan',
    submittalGroup: 'wmp',
    displayName: 'Waste hauler + disposal plan',
    purpose: 'Waste and recycling hauler info, disposal sites, and how tickets will be documented.',
    suggestedRole: 'admin',
    defaultDueDays: 10,
    formSchema: [
      {
        title: 'Waste Hauler',
        fields: [
          { key: 'hauler_name', label: 'Hauler company', type: 'text', required: true },
          { key: 'hauler_contact', label: 'Contact name', type: 'text' },
          { key: 'hauler_phone', label: 'Phone', type: 'phone' },
          { key: 'hauler_permit', label: 'Permit / registration number', type: 'text' },
        ],
      },
      {
        title: 'Disposal Sites',
        fields: [
          { key: 'landfill_name', label: 'Landfill / transfer station', type: 'text', required: true },
          { key: 'landfill_address', label: 'Address', type: 'text' },
          { key: 'recycling_facility', label: 'Recycling facility (asphalt / concrete / metals)', type: 'text' },
        ],
      },
      {
        title: 'Documentation',
        fields: [
          { key: 'ticket_process', label: 'Ticket capture & submittal process', type: 'textarea', required: true,
            helpText: 'How will delivery/dump tickets be collected and shared with the prime?' },
          { key: 'recycling_target', label: 'Recycling target (%)', type: 'number' },
          { key: 'wmp_upload', label: 'Upload full WMP (optional)', type: 'file',
            accept: 'application/pdf' },
        ],
      },
    ],
  },

]

// ─── Consolidated single-form quote submission (sub-facing) ───────────────
// One link, sub-friendly language. When the sub opens the portal they see:
//   - Basic company + contact info (prefilled from what we already know)
//   - Their priced quote for the work assigned
//   - A file upload for a detailed quote (auto-populates totals if we can)
// Submission mirrors the answers onto the Subcontractor row so the internal
// list is populated automatically — onboarding "begins at quote submission".
REQUIREMENT_TEMPLATES.push({
  key: 'sub_quote',
  submittalGroup: 'quote_submission',
  displayName: 'Submit your quote',
  purpose: 'Confirm your company details and share your priced quote for this project.',
  suggestedRole: 'estimator',
  defaultDueDays: 7,
  formSchema: [
    {
      title: 'Your company',
      fields: [
        { key: 'company_name', label: 'Company name', type: 'text', required: true },
        { key: 'address', label: 'Address', type: 'text' },
      ],
    },
    {
      title: 'Point of contact',
      fields: [
        { key: 'contact_name', label: 'Your name', type: 'text', required: true },
        { key: 'contact_email', label: 'Email', type: 'email', required: true },
        { key: 'contact_phone', label: 'Phone', type: 'phone' },
      ],
    },
    {
      title: 'Your quote',
      description: 'Share your price for the work. Upload a detailed quote if you have one — we\'ll try to fill in the totals for you.',
      fields: [
        { key: 'quote_upload', label: 'Detailed quote (PDF)', type: 'file',
          accept: 'application/pdf,image/*', multiple: true,
          helpText: 'Optional. We\'ll auto-fill totals from the document when possible.' },
        { key: 'grand_total', label: 'Grand total ($)', type: 'currency', required: true },
        { key: 'quote_valid_days', label: 'Quote valid for (days)', type: 'number', placeholder: '30' },
        { key: 'notes', label: 'Notes or assumptions', type: 'textarea',
          helpText: 'Anything the prime should know — inclusions, exclusions, lead times.' },
      ],
    },
  ],
})

export function getTemplate(key: string): RequirementTemplate | undefined {
  return REQUIREMENT_TEMPLATES.find(t => t.key === key)
}

export function templatesForGroup(group: SubmittalGroup): RequirementTemplate[] {
  return REQUIREMENT_TEMPLATES.filter(t => t.submittalGroup === group)
}

/** Ordered list of all submittal groups (for stable UI rendering). */
export const SUBMITTAL_GROUP_ORDER: SubmittalGroup[] = [
  'quote_submission',
  'super_letter',
  'sub_list',
  'sf1413',
  'insurance',
  'sov',
  'app',
  'qcp',
  'wmp',
]
