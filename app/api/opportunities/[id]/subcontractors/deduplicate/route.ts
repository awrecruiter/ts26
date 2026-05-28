import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { auth } from '@/lib/auth'

/**
 * POST - Deduplicate subcontractors for an opportunity.
 * Groups by normalized name, placeId, and UEI number.
 * Keeps the record with the most data; deletes the rest.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id: opportunityId } = await params

    const opportunity = await prisma.opportunity.findUnique({
      where: { id: opportunityId },
      select: { id: true },
    })

    if (!opportunity) {
      return NextResponse.json(
        { error: 'Opportunity not found' },
        { status: 404 }
      )
    }

    const subcontractors = await prisma.subcontractor.findMany({
      where: { opportunityId },
    })

    if (subcontractors.length === 0) {
      return NextResponse.json({ message: 'No subcontractors to deduplicate', deleted: 0 })
    }

    const idsToDelete = new Set<string>()

    // Score a subcontractor by data completeness (higher = keep)
    function dataScore(sub: typeof subcontractors[0]): number {
      let score = 0
      if (sub.email) score += 3
      if (sub.quotedAmount != null) score += 5
      if ((sub as any).ueiNumber) score += 4
      if (sub.phone) score += 2
      if (sub.website) score += 1
      if (sub.address) score += 1
      if (sub.rating != null) score += 1
      if ((sub as any).verificationStatus === 'verified') score += 3
      if (sub.callCompleted) score += 2
      return score
    }

    // 1. Group by normalized name
    const nameGroups = new Map<string, typeof subcontractors>()
    for (const sub of subcontractors) {
      const key = sub.name.toLowerCase().trim()
      const group = nameGroups.get(key) || []
      group.push(sub)
      nameGroups.set(key, group)
    }

    for (const [, group] of nameGroups) {
      if (group.length <= 1) continue
      // Sort by data score descending, keep the best
      group.sort((a, b) => dataScore(b) - dataScore(a))
      for (let i = 1; i < group.length; i++) {
        idsToDelete.add(group[i].id)
      }
    }

    // 2. Group by placeId (among remaining)
    const placeGroups = new Map<string, typeof subcontractors>()
    for (const sub of subcontractors) {
      if (idsToDelete.has(sub.id)) continue
      if (!sub.placeId) continue
      const group = placeGroups.get(sub.placeId) || []
      group.push(sub)
      placeGroups.set(sub.placeId, group)
    }

    for (const [, group] of placeGroups) {
      if (group.length <= 1) continue
      group.sort((a, b) => dataScore(b) - dataScore(a))
      for (let i = 1; i < group.length; i++) {
        idsToDelete.add(group[i].id)
      }
    }

    // 3. Group by UEI number (among remaining)
    const ueiGroups = new Map<string, typeof subcontractors>()
    for (const sub of subcontractors) {
      if (idsToDelete.has(sub.id)) continue
      const uei = (sub as any).ueiNumber
      if (!uei) continue
      const group = ueiGroups.get(uei) || []
      group.push(sub)
      ueiGroups.set(uei, group)
    }

    for (const [, group] of ueiGroups) {
      if (group.length <= 1) continue
      group.sort((a, b) => dataScore(b) - dataScore(a))
      for (let i = 1; i < group.length; i++) {
        idsToDelete.add(group[i].id)
      }
    }

    // Delete duplicates
    if (idsToDelete.size > 0) {
      await prisma.subcontractor.deleteMany({
        where: { id: { in: Array.from(idsToDelete) } },
      })
    }

    return NextResponse.json({
      message: idsToDelete.size > 0
        ? `Removed ${idsToDelete.size} duplicate vendor${idsToDelete.size !== 1 ? 's' : ''}`
        : 'No duplicates found',
      deleted: idsToDelete.size,
    })
  } catch (error) {
    console.error('Deduplicate subcontractors error:', error)
    return NextResponse.json(
      { error: 'Failed to deduplicate subcontractors', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
