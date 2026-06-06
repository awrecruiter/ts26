import type { OpportunityBrief } from '@/lib/openai'

/**
 * SAM.gov returns agency names as a dotted hierarchy like
 *   "STATE, DEPARTMENT OF.STATE, DEPARTMENT OF.ACQUISITIONS - AQM MOMENTUM"
 * Use only the top-level segment for human-readable subjects.
 */
export function cleanAgencyName(agency?: string | null): string {
  if (!agency) return ''
  const segments = agency.split('.').map(s => s.trim()).filter(Boolean)
  return segments[0] || ''
}

/**
 * Generate the plain-text blocks used in the email body, derived from the
 * AI opportunity brief and the call checklist. Mirrors the logic in
 * EmailDraftPanel.tsx so direct-send and composer paths produce identical output.
 */
export function buildBriefContext(
  brief: OpportunityBrief | null | undefined,
  callChecklist?: string[],
): {
  what_we_need: string
  deliverables_block: string
  qualifications_block: string
  screening_questions: string
} {
  const what = brief?.whatTheyAreBuying?.trim()
  const what_we_need = what || '(SOW attached — see "What We Need From You" section.)'

  const deliverables_block = brief?.keyDeliverables?.length
    ? brief.keyDeliverables
        .slice(0, 5)
        .map(d => `• ${d.item}${d.frequency ? ` (${d.frequency})` : ''}`)
        .join('\n')
    : '• See attached SOW for the deliverables list.'

  const qParts: string[] = []
  const wq = brief?.whoQualifies
  if (wq?.setAside) qParts.push(`Set-aside: ${wq.setAside}`)
  if (wq?.clearances?.length) qParts.push(`Clearance: ${wq.clearances.join(', ')}`)
  if (wq?.certifications?.length) qParts.push(`Certifications: ${wq.certifications.join(', ')}`)
  if (wq?.licenses?.length) qParts.push(`Licenses: ${wq.licenses.join(', ')}`)
  const qualifications_block = qParts.length
    ? qParts.map(p => `• ${p}`).join('\n')
    : '• No special clearance or certification gates flagged. Confirm fit per the SOW.'

  const screening_questions = callChecklist?.length
    ? callChecklist.slice(0, 3).map(q => `   – ${q}`).join('\n')
    : '   – (See call checklist in our sub vetting workflow.)'

  return { what_we_need, deliverables_block, qualifications_block, screening_questions }
}

interface SowDeliveryInput {
  vendorName: string
  opportunityTitle: string
  solicitationNumber: string
  agency?: string | null
  quoteDeadline?: string | null
  brief?: OpportunityBrief | null
  callChecklist?: string[]
}

/**
 * Build the SOW delivery email — full template with THE WORK, KEY
 * DELIVERABLES, QUALIFICATION GATES, screening questions. Leave the
 * "[Your Name]" placeholder for the send route to substitute with the
 * authenticated user's identity (so signature is always consistent).
 */
export function buildSowDeliveryEmail(input: SowDeliveryInput): { subject: string; body: string } {
  const ctx = buildBriefContext(input.brief, input.callChecklist)
  const agency = cleanAgencyName(input.agency)
  const quoteDue = input.quoteDeadline || 'the end of this week'

  const subject = agency
    ? `Statement of Work — ${input.opportunityTitle} (${agency})`
    : `Statement of Work — ${input.opportunityTitle}`

  const body =
    `Hello ${input.vendorName},\n\n` +
    `Per our conversation, here is the Statement of Work for the ${input.opportunityTitle} ` +
    `opportunity (${input.solicitationNumber}). The SOW and the supporting solicitation ` +
    `documents are attached.\n\n` +
    `THE WORK\n${ctx.what_we_need}\n\n` +
    `KEY DELIVERABLES\n${ctx.deliverables_block}\n\n` +
    `QUALIFICATION GATES\n${ctx.qualifications_block}\n\n` +
    `NEXT STEPS — please return by ${quoteDue}\n` +
    `• Firm fixed-price quote — all-inclusive (materials, labor, shipping, taxes, fees)\n` +
    `• Lead time / delivery schedule from receipt of order\n` +
    `• Capability statement (past performance + certifications + key personnel)\n` +
    `• Any exceptions, assumptions, or clarifying questions\n` +
    `• Your point of contact (name, title, email, direct phone)\n\n` +
    `A few quick screening questions:\n${ctx.screening_questions}\n\n` +
    `Let me know if anything in the attached SOW needs clarification before you price.\n\n` +
    `Thanks,\n[Your Name]`

  return { subject, body }
}
