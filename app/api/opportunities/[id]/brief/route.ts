import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { generateOpportunityBrief } from '@/lib/openai'

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params

    const opportunity = await prisma.opportunity.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        agency: true,
        solicitationNumber: true,
        naicsCode: true,
        description: true,
        rawData: true,
        parsedAttachments: true,
      },
    })

    if (!opportunity) {
      return NextResponse.json({ error: 'Opportunity not found' }, { status: 404 })
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: 'Brief generation requires OPENAI_API_KEY — briefs are written in plain language by GPT-4o, not parsed from SAM.gov' },
        { status: 503 }
      )
    }

    // Extract set-aside from rawData if present
    const rawData = opportunity.rawData as Record<string, unknown> | null
    const setAside = (rawData?.typeOfSetAside as string) || (rawData?.setAside as string) || null

    const brief = await generateOpportunityBrief({
      title: opportunity.title,
      agency: opportunity.agency || 'Unknown Agency',
      solicitationNumber: opportunity.solicitationNumber,
      naicsCode: opportunity.naicsCode,
      setAside,
      description: opportunity.description,
      rawData,
      parsedAttachments: opportunity.parsedAttachments as {
        structured?: {
          scope?: string[]
          deliverables?: string[]
          compliance?: string[]
          periodOfPerformance?: string[]
          placeOfPerformance?: string
        }
      } | null,
    })

    // Cache brief on the opportunity
    await prisma.opportunity.update({
      where: { id },
      data: { opportunityBrief: brief as object },
    })

    return NextResponse.json({ brief })
  } catch (error) {
    console.error('Brief generation error:', error)
    const msg = error instanceof Error ? error.message : 'Failed to generate brief'
    const status = (error as { status?: number })?.status
    if (status === 429 || /quota|rate limit|insufficient_quota/i.test(msg)) {
      return NextResponse.json(
        { error: 'OpenAI quota exceeded — add credits to your OpenAI account at platform.openai.com/billing, then retry.' },
        { status: 503 }
      )
    }
    if (status === 401 || /invalid_api_key|incorrect api key/i.test(msg)) {
      return NextResponse.json(
        { error: 'OPENAI_API_KEY is invalid — check the key in .env.local / Vercel.' },
        { status: 503 }
      )
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
