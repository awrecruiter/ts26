import { randomBytes } from 'crypto'
import { prisma } from '@/lib/db'

/** URL-safe random token (32 bytes → 64 char hex). */
export function newToken(): string {
  return randomBytes(32).toString('hex')
}

/**
 * Mint a fresh magic-link token for a requirement, storing it and returning
 * the token string. Default validity: 60 days from issuance (long enough for
 * a bid cycle; short enough that stale invites eventually stop working).
 */
export async function issueMagicToken(input: {
  requirementInstanceId: string
  sentToEmail: string
  validDays?: number
}): Promise<{ token: string; expiresAt: Date }> {
  const token = newToken()
  const validDays = input.validDays ?? 60
  const expiresAt = new Date(Date.now() + validDays * 24 * 60 * 60 * 1000)
  await prisma.requirementMagicToken.create({
    data: {
      requirementInstanceId: input.requirementInstanceId,
      token,
      expiresAt,
      sentToEmail: input.sentToEmail,
    },
  })
  return { token, expiresAt }
}

/**
 * Look up a token, joining the parent requirement + related opportunity/sub.
 * Returns null if the token doesn't exist, has been consumed, or has expired.
 */
export async function resolveMagicToken(token: string) {
  const record = await prisma.requirementMagicToken.findUnique({
    where: { token },
    include: {
      requirement: {
        include: {
          opportunity: {
            select: {
              id: true,
              title: true,
              solicitationNumber: true,
              agency: true,
              responseDeadline: true,
            },
          },
          subcontractor: {
            select: {
              id: true,
              name: true,
              email: true,
              contactName: true,
            },
          },
        },
      },
    },
  })
  if (!record) return { ok: false as const, reason: 'not_found' as const }
  if (record.consumedAt) return { ok: false as const, reason: 'consumed' as const, record }
  if (record.expiresAt < new Date()) return { ok: false as const, reason: 'expired' as const, record }
  return { ok: true as const, record }
}
