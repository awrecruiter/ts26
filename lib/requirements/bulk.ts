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
 * Render the "Complete your info" block appended to outbound sub emails.
 * Groups bullets by submittal-group display name so the sub sees a coherent
 * heading rather than a flat list of unrelated form links.
 */
export function renderPreworkLinksBlock(
  provisioned: ProvisionedRequirement[],
): string {
  if (provisioned.length === 0) return ''

  const byGroup = new Map<string, ProvisionedRequirement[]>()
  for (const p of provisioned) {
    const existing = byGroup.get(p.submittalGroupDisplayName) ?? []
    existing.push(p)
    byGroup.set(p.submittalGroupDisplayName, existing)
  }

  const lines: string[] = []
  lines.push('─────────────────────────────────')
  lines.push('COMPLETE YOUR INFO (one link each — no login needed):')
  lines.push('')

  for (const [groupName, items] of byGroup) {
    if (byGroup.size > 1) {
      lines.push(`${groupName}:`)
    }
    for (const p of items) {
      lines.push(`  • ${p.templateDisplayName}:  ${p.url}`)
    }
    lines.push('')
  }

  lines.push('These help us confirm eligibility and evaluate your quote faster.')
  lines.push('─────────────────────────────────')

  return lines.join('\n')
}
