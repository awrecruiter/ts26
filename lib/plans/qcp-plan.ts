/**
 * Quality Control Plan (QCP) — USACE 3-phase quality control layout
 * (Preparatory / Initial / Follow-up per EM 385-1-1 & USACE construction
 * quality-management guidance). Mirrors the same section / item / field
 * shape as the APP so it renders through PlanViewerModal.
 */
import type { GeneratedPlan, PlanItem, PlanSection, PlanGenerateInput } from './types'
import { makePlanHelpers } from './helpers'

export function generateQualityControlPlan(input: PlanGenerateInput): GeneratedPlan {
  const { opportunity, primeCompanyName, selectedSub } = input
  const r = (selectedSub?.responses ?? {}) as {
    qc_officer_name?: string
    qc_officer_phone?: string
    scope_confirmation?: string
    company_name?: string
  }
  const contractor = (primeCompanyName ?? '').trim() || 'the Prime Contractor'
  const { opp, sub, tpl, admin, subName } = makePlanHelpers({
    overrides: input.overrides,
    checks: input.checks,
    selectedSubName: selectedSub?.name,
  })
  const qcm = (r.qc_officer_name ?? '').trim()
  const qcmDisplay = qcm || (subName ? `[${subName}'s QCM]` : '[QCM name]')

  const sections: PlanSection[] = [
    // ── Cover ─────────────────────────────────────────────────────────────
    {
      key: 'cover',
      title: 'QUALITY CONTROL PLAN',
      fields: [
        opp(opportunity.title, 'Project Name', 'cover.projectName'),
        admin('Contractor Name', 'cover.contractorName', { placeholder: contractor }),
        opp(opportunity.solicitationNumber, 'Contract Number', 'cover.contractNumber'),
        tpl(new Date().toLocaleDateString('en-US'), 'Date', 'cover.date'),
      ],
      items: [
        { text: 'QCP Prepared By (Name, Title, Phone, & Signature):', field: admin('Prepared By', 'cover.preparedBy', { multiline: true }) },
        { text: 'QCP Approved By (Name, Title, Phone, & Signature):', field: admin('Approved By', 'cover.approvedBy', { multiline: true }) },
      ],
    },

    // ── a. QC Organization ────────────────────────────────────────────────
    {
      key: 'org',
      letter: 'a',
      title: 'QC Organization',
      intro: 'Quality control chain of authority, independent of production. All QC personnel report to the QCM, who reports to project management.',
      items: [
        {
          number: '1',
          text: `${qcmDisplay} is the Quality Control Manager (QCM) for this project. The QCM has the authority to stop work on any activity that fails to meet contract quality requirements.`,
          field: sub(r.qc_officer_name, 'Quality Control Manager (QCM)', 'org.qcm'),
        },
        {
          number: '2',
          text: 'QCM contact (24-hour):',
          field: sub(r.qc_officer_phone, 'QCM phone', 'org.qcmPhone'),
        },
        {
          number: '3',
          text: 'QCM resume + qualifications on file with the GDA:',
          field: admin('Attach resume + relevant experience summary', 'org.qcmQualifications', { multiline: true }),
        },
        {
          number: '4',
          text: 'QC staff by discipline (soils, concrete, welding, electrical, etc.):',
          field: admin('QC staff list + areas of proficiency', 'org.qcStaff', { multiline: true }),
        },
        {
          number: '5',
          text: 'Independent testing lab + certifications (AASHTO / A2LA / equivalent):',
          field: admin('Testing lab name + accreditation number(s)', 'org.testingLab', { multiline: true }),
        },
        {
          number: '6',
          text:
            'QC reporting line is independent of production. The QCM does not report to the Superintendent or Project Manager on quality matters.',
          field: tpl('Acknowledged', 'Independent reporting line', 'org.independence'),
        },
      ],
    },

    // ── b. Submittal Register ─────────────────────────────────────────────
    {
      key: 'submittals',
      letter: 'b',
      title: 'Submittal Register',
      intro:
        'Every submittal called out in the specifications is tracked here — product data, shop drawings, samples, and certifications. Government review window is typically 14 calendar days from receipt.',
      items: [
        { number: '1', text: 'Submittal register (spec section, type, description, submission date):', field: admin('Attach submittal register (spreadsheet or table)', 'sub.register', { multiline: true }) },
        { number: '2', text: 'Long-lead submittal items identified + fast-tracked:', field: admin('Long-lead items list', 'sub.longLead', { multiline: true }) },
        { number: '3', text: 'Resubmittal disposition tracked (accepted, accepted-as-noted, revise-and-resubmit, rejected):', field: tpl('Tracked in the register', 'Resubmittal tracking', 'sub.resubmittal') },
        { number: '4', text: 'Submittal transmittal form: ENG Form 4025 (or equivalent contractor format):', field: tpl('Standard USACE ENG 4025', 'Transmittal form', 'sub.form') },
      ],
    },

    // ── c. Testing Plan ───────────────────────────────────────────────────
    {
      key: 'testing',
      letter: 'c',
      title: 'Testing Plan',
      intro:
        'What gets tested, how often, by whom, and to what standard. Testing frequency follows the specification section for each material.',
      items: [
        { number: '1', text: 'Test type per material (proctor, slump, gradation, air content, break strength, weld inspection, torque, etc.):', field: admin('Testing matrix — material × test type × standard', 'test.matrix', { multiline: true }) },
        { number: '2', text: 'Test frequency (per lot / per lift / per placement / per weld):', field: admin('Frequency per test type', 'test.frequency', { multiline: true }) },
        { number: '3', text: 'Acceptance criteria — spec value + allowable tolerance:', field: admin('Acceptance criteria per test', 'test.acceptance', { multiline: true }) },
        { number: '4', text: 'Testing lab holds current accreditation (AASHTO R 18 / A2LA):', field: admin('Lab + certification number', 'test.labCert') },
        { number: '5', text: 'Field testing personnel qualifications (ACI, NICET, etc.):', field: admin('Personnel + certification', 'test.personnel', { multiline: true }) },
      ],
    },

    // ── d. 3-Phase Inspection ─────────────────────────────────────────────
    {
      key: 'threePhase',
      letter: 'd',
      title: 'USACE 3-Phase Control',
      intro:
        'Preparatory → Initial → Follow-up. Each Definable Feature of Work (DFOW) runs through this cycle to catch quality problems before they propagate.',
      items: [
        {
          number: '1',
          text: 'Preparatory Phase — held before starting each DFOW.',
          subitems: [
            { number: 'A', text: 'Preparatory meeting agenda (materials on hand, submittals approved, drawings current, personnel qualifications verified, safety plan reviewed):', field: admin('Preparatory agenda', 'p3.prepAgenda', { multiline: true }) },
            { number: 'B', text: 'Meeting attendees (QCM, superintendent, foreman, subs, GDA):', field: admin('Attendee list template', 'p3.prepAttendees', { multiline: true }) },
            { number: 'C', text: 'Meeting minutes retained + provided to GDA within 24 hours:', field: tpl('Standard USACE cadence', 'Minutes cadence', 'p3.prepMinutes') },
          ],
        },
        {
          number: '2',
          text: 'Initial Phase — held with the first crew starting each DFOW.',
          subitems: [
            { number: 'A', text: 'Initial phase inspection checklist (workmanship examples, dimensional accuracy, quality benchmarks):', field: admin('Initial phase checklist', 'p3.initChecklist', { multiline: true }) },
            { number: 'B', text: 'Deficiencies noted and corrected before continuing production:', field: tpl('Documented in daily QC report', 'Initial deficiencies', 'p3.initDeficiencies') },
          ],
        },
        {
          number: '3',
          text: 'Follow-up Phase — continuous inspection for the duration of the DFOW.',
          subitems: [
            { number: 'A', text: 'Follow-up inspection frequency (daily / per placement / per shift):', field: admin('Follow-up cadence', 'p3.followUp') },
            { number: 'B', text: 'Records retained per DFOW:', field: tpl('Daily QC reports + test results', 'Retained records', 'p3.followRecords') },
          ],
        },
      ],
    },

    // ── e. Non-Conformance Handling ───────────────────────────────────────
    {
      key: 'ncr',
      letter: 'e',
      title: 'Non-Conformance Handling',
      intro:
        'When work fails to meet spec, it enters a documented non-conformance workflow with root-cause analysis and formal disposition.',
      items: [
        { number: '1', text: 'Non-Conformance Report (NCR) log — number, date, DFOW, spec section, description, disposition:', field: admin('NCR log format', 'ncr.log', { multiline: true }) },
        { number: '2', text: 'Root cause analysis workflow (5-why / fishbone / equivalent):', field: admin('RCA workflow', 'ncr.rca', { multiline: true }) },
        { number: '3', text: 'Disposition options (rework / repair / accept-with-deviation / reject):', field: tpl('Disposition documented per NCR', 'Disposition tracking', 'ncr.disposition') },
        { number: '4', text: 'Closure verification — QCM re-inspects and signs off:', field: sub(r.qc_officer_name, 'Closure verifier', 'ncr.closure') },
        { number: '5', text: 'NCR reporting to GDA — within 24 hours of identification:', field: tpl('Acknowledged', 'GDA notification', 'ncr.gdaNotify') },
      ],
    },

    // ── f. Reports & Records ──────────────────────────────────────────────
    {
      key: 'reports',
      letter: 'f',
      title: 'Reports & Records',
      intro: 'Daily and periodic reporting to the government.',
      items: [
        { number: '1', text: 'Daily QC Report format (QCR / QCS entries):', field: admin('Daily report format', 'rep.daily', { multiline: true }) },
        { number: '2', text: 'Deficiency log (open / closed status per item):', field: admin('Deficiency log template', 'rep.deficiency', { multiline: true }) },
        { number: '3', text: 'As-built markups (redlined drawings maintained on site):', field: tpl('Maintained daily', 'As-built cadence', 'rep.asBuilt') },
        { number: '4', text: 'Final QC certification at project completion:', field: sub(r.qc_officer_name, 'Final QC certifier', 'rep.finalCert') },
        { number: '5', text: 'Records retention (7 years after project acceptance, or per contract):', field: tpl('7 years minimum', 'Records retention', 'rep.retention') },
      ],
    },
  ]

  return {
    key: 'qcp',
    displayName: 'Quality Control Plan',
    planCode: 'QCP',
    sections,
    generatedAt: new Date().toISOString(),
    sourceSubcontractorId: selectedSub?.id ?? null,
    sourceSubcontractorName: selectedSub?.name ?? null,
  }
}
