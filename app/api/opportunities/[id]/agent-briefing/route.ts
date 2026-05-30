import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { generateAgentBriefing } from '@/lib/openai'

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params

    const opportunity = await prisma.opportunity.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        agency: true,
        naicsCode: true,
        description: true,
        rawData: true,
        parsedAttachments: true,
      },
    })

    if (!opportunity) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const rawData = opportunity.rawData as Record<string, unknown> | null
    const parsed = opportunity.parsedAttachments as {
      structured?: {
        scope?: string[]
        deliverables?: string[]
        compliance?: string[]
      }
    } | null

    const setAside = (rawData?.typeOfSetAsideDescription as string) ||
      (rawData?.typeOfSetAside as string) || null

    const briefing = await generateAgentBriefing({
      title: opportunity.title,
      agency: opportunity.agency || '',
      naicsCode: opportunity.naicsCode,
      setAside,
      description: opportunity.description,
      rawData,
      parsedAttachments: parsed,
    })

    await prisma.opportunity.update({
      where: { id },
      data: { agentBriefing: briefing as object },
    })

    return NextResponse.json({ briefing })
  } catch (error) {
    console.error('agent-briefing error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate briefing' },
      { status: 500 }
    )
  }
}
