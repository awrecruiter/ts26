import { prisma } from '@/lib/db'
import { getTemplate, SUBMITTAL_GROUPS } from './templates'
import { issueMagicToken } from './tokens'
import type { SubmittalGroup } from './types'

export interface BulkProvisionInput {
  opportunityId: string
  subcontractorId: string
  templateKeys: string[]
}

export interface ProvisionedRequirement {
  requirementId: string
  templateKey: string
  submittalGroup: SubmittalGroup
  submittalGroupDisplayName: string
  templateDisplayName: string
  token: string
  url: string
  expiresAt: Date
}

export interface BulkProvisionResult {
  provisioned: ProvisionedRequirement[]
  skipped: { templateKey: string; reason: string }[]
}

/** Build the fully-qualified base URL for magic-link portal URLs. */
export function portalBaseUrl(): string {
  return (
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    'http://localhost:3000'
  ).replace(/\/$/, '')
}

/**
 * Provision multiple requirement instances for a single subcontractor on a
 * single opportunity in one pass. For each templateKey we upsert the
 * RequirementInstance (unique on [opportunityId, subcontractorId, templateKey])
 * and mint a fresh RequirementMagicToken. Unknown templateKeys are silently
 * skipped (returned in `skipped` for logging).
 *
 * Callers (bulk API route + email-send route) share this so a sub gets the
 * same provisioning behavior no matter which entry point kicked it off.
 */
export async function bulkProvisionRequirements(
  input: BulkProvisionInput,
): Promise<BulkProvisionResult> {
  const { opportunityId, subcontractorId, templateKeys } = input

  const subcontractor = await prisma.subcontractor.findUnique({
    where: { id: subcontractorId },
    select: {
      id: true,
      name: true,
      contactName: true,
      email: true,
      contactEmail: true,
      opportunityId: true,
    },
  })
  if (!subcontractor) {
    throw new Error('Subcontractor not found')
  }
  if (subcontractor.opportunityId !== opportunityId) {
    throw new Error('Subcontractor does not belong to this opportunity')
  }

  const assignedEmail = (subcontractor.contactEmail ?? subcontractor.email ?? '').trim()
  if (!assignedEmail) {
    throw new Error('Subcontractor has no email on file')
  }
  const assignedName = subcontractor.contactName ?? null
  const base = portalBaseUrl()

  const provisioned: ProvisionedRequirement[] = []
  const skipped: { templateKey: string; reason: string }[] = []

  for (const templateKey of templateKeys) {
    const template = getTemplate(templateKey)
    if (!template) {
      skipped.push({ templateKey, reason: 'Unknown template' })
      continue
    }

    const dueAt = new Date(
      Date.now() + (template.defaultDueDays ?? 14) * 24 * 60 * 60 * 1000,
    )

    const requirement = await prisma.requirementInstance.upsert({
      where: {
        opportunityId_subcontractorId_templateKey: {
          opportunityId,
          subcontractorId,
          templateKey,
        },
      },
      create: {
        opportunityId,
        subcontractorId,
        templateKey,
        submittalGroup: template.submittalGroup,
        assignedEmail,
        assignedName,
        dueAt,
      },
      update: {
        assignedEmail,
        assignedName,
      },
    })

    const { token, expiresAt } = await issueMagicToken({
      requirementInstanceId: requirement.id,
      sentToEmail: assignedEmail,
    })

    provisioned.push({
      requirementId: requirement.id,
      templateKey,
      submittalGroup: template.submittalGroup,
      submittalGroupDisplayName: SUBMITTAL_GROUPS[template.submittalGroup].displayName,
      templateDisplayName: template.displayName,
      token,
      url: `${base}/req/${token}`,
      expiresAt,
    })
  }

  return { provisioned, skipped }
}

/**
 * Visible placeholder the outreach template drops into the body so the user
 * can see, before sending, where the secure portal link will land. The server
 * swaps this exact block for the real `renderPreworkLinksBlock(...)` output at
 * send-time (or strips it if provisioning fails), so the sub never sees the
 * placeholder text itself.
 */
export const MAGIC_LINK_PLACEHOLDER =
  '-----------------------------------------------\n' +
  'QUOTE SUBMISSION PORTAL — secure link inserted on send\n' +
  '-----------------------------------------------'

/**
 * Render the "Complete your info" block appended to outbound sub emails.
 * URLs are placed on their own dedicated lines with no leading whitespace
 * or Unicode bullets — this keeps Gmail's autolinker AND our own HTML
 * anchor pass from clipping the URL at unexpected boundaries.
 */
export function renderPreworkLinksBlock(
  provisioned: ProvisionedRequirement[],
): string {
  if (provisioned.length === 0) return ''

  const lines: string[] = []
  lines.push('-----------------------------------------------')
  lines.push('SUBMIT YOUR INFO — no login required')
  lines.push('')

  for (const p of provisioned) {
    lines.push(`${p.templateDisplayName}:`)
    lines.push(p.url)
    lines.push('')
  }

  lines.push('This helps us confirm eligibility and evaluate your quote faster.')
  lines.push('-----------------------------------------------')

  return lines.join('\n')
}
