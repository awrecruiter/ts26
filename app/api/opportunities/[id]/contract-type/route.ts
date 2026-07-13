import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { classifyContractType } from '@/lib/opportunity-classification'

const VALID_TYPES = new Set(['SERVICES', 'PRODUCT'])

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const nextType = body.contractType
  const override = body.override !== false

  if (override && !VALID_TYPES.has(nextType)) {
    return NextResponse.json({ error: 'contractType must be SERVICES or PRODUCT' }, { status: 400 })
  }

  const opp = await prisma.opportunity.findUnique({
    where: { id },
    select: { id: true, title: true, description: true, naicsCode: true, pscCode: true },
  })
  if (!opp) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let contractType: 'SERVICES' | 'PRODUCT'
  let contractTypeSource: string

  if (override) {
    contractType = nextType
    contractTypeSource = 'user override'
  } else {
    const result = classifyContractType({
      pscCode: opp.pscCode,
      naicsCode: opp.naicsCode,
      title: opp.title,
      description: opp.description,
    })
    contractType = result.contractType
    contractTypeSource = result.source
  }

  const updated = await prisma.opportunity.update({
    where: { id },
    data: {
      contractType,
      contractTypeSource,
      contractTypeOverride: override,
    },
    select: { id: true, contractType: true, contractTypeSource: true, contractTypeOverride: true },
  })

  return NextResponse.json(updated)
}
