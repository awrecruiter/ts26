import { randomBytes } from 'crypto'
import { prisma } from '@/lib/db'

/**
 * Portal tokens are the sub-facing side of a PaymentCycle. One token per
 * cycle → one URL the sub uses to fill in every task in that cycle. Distinct
 * from RequirementMagicToken (which is per-task and used by the one-form
 * prework flow).
 */

export function newPortalToken(): string {
  return randomBytes(32).toString('hex')
}

export async function issuePortalToken(input: {
  paymentCycleId: string
  sentToEmail: string
  validDays?: number
}): Promise<{ token: string; expiresAt: Date }> {
  const token = newPortalToken()
  const validDays = input.validDays ?? 60
  const expiresAt = new Date(Date.now() + validDays * 24 * 60 * 60 * 1000)
  await prisma.paymentCyclePortalToken.create({
    data: {
      paymentCycleId: input.paymentCycleId,
      token,
      expiresAt,
      sentToEmail: input.sentToEmail,
    },
  })
  return { token, expiresAt }
}

export async function resolvePortalToken(token: string) {
  const record = await prisma.paymentCyclePortalToken.findUnique({
    where: { token },
    include: {
      cycle: {
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
              email: true,
              contactName: true,
              contactEmail: true,
            },
          },
          requirements: {
            orderBy: { createdAt: 'asc' },
          },
        },
      },
    },
  })
  if (!record) return { ok: false as const, reason: 'not_found' as const }
  if (record.expiresAt < new Date()) return { ok: false as const, reason: 'expired' as const, record }
  return { ok: true as const, record }
}
