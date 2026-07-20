import { randomBytes } from 'crypto'
import { prisma } from '@/lib/db'

/**
 * Super-portal tokens are persistent, per-(project, sub) magic links. Unlike
 * the payment cycle portal tokens (per-cycle, expiring) or requirement
 * magic tokens (per-instance, single-use), the super's link stays live for
 * the life of the project — they use the same URL every day.
 *
 * Rotation replaces the sole active token: prior tokens are marked revoked.
 */

export function newSuperToken(): string {
  return randomBytes(32).toString('hex')
}

export async function issueOrRotateSuperToken(input: {
  opportunityId: string
  subcontractorId: string
  sentToEmail?: string | null
  sentToName?: string | null
}): Promise<{ token: string; rotated: boolean }> {
  const existing = await prisma.superPortalToken.findFirst({
    where: {
      opportunityId: input.opportunityId,
      subcontractorId: input.subcontractorId,
      revokedAt: null,
    },
    orderBy: { createdAt: 'desc' },
  })

  const now = new Date()
  if (existing) {
    await prisma.superPortalToken.update({
      where: { id: existing.id },
      data: { revokedAt: now },
    })
  }

  const token = newSuperToken()
  await prisma.superPortalToken.create({
    data: {
      opportunityId: input.opportunityId,
      subcontractorId: input.subcontractorId,
      token,
      sentToEmail: input.sentToEmail ?? null,
      sentToName: input.sentToName ?? null,
    },
  })

  return { token, rotated: Boolean(existing) }
}

export async function resolveSuperToken(token: string) {
  const record = await prisma.superPortalToken.findUnique({
    where: { token },
    include: {
      opportunity: {
        select: {
          id: true,
          title: true,
          solicitationNumber: true,
          agency: true,
        },
      },
      subcontractor: {
        select: {
          id: true,
          name: true,
          contactName: true,
          contactEmail: true,
          email: true,
          service: true,
        },
      },
    },
  })
  if (!record) return { ok: false as const, reason: 'not_found' as const }
  if (record.revokedAt) return { ok: false as const, reason: 'revoked' as const, record }
  return { ok: true as const, record }
}
