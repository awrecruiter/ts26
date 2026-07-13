import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { generateJobDescription } from '@/lib/openai'
import type { OpportunityArtifacts, OpportunityBrief } from '@/lib/openai'
import type { ResourcePlan } from '@/lib/types/resource-plan'

/**
 * POST — Regenerate a single Job Description for one professional resource
 * line. Persists back into the resource plan in place.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string; lineId: string }> }
) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id, lineId } = await params

    const opportunity = await prisma.opportunity.findUnique({
      where: { id },
      select: {
        id: true,
        resourcePlan: true,
        opportunityBrief: true,
        aiArtifacts: true,
        rawData: true,
      },
    })

    if (!opportunity) {
      return NextResponse.json({ error: 'Opportunity not found' }, { status: 404 })
    }

    const plan = opportunity.resourcePlan as ResourcePlan | null
    if (!plan) {
      return NextResponse.json({ error: 'No resource plan exists yet' }, { status: 400 })
    }

    const lineIdx = plan.lines.findIndex((l) => l.id === lineId)
    if (lineIdx === -1) {
      return NextResponse.json({ error: 'Resource line not found' }, { status: 404 })
    }

    const line = plan.lines[lineIdx]
    if (line.category !== 'professional') {
      return NextResponse.json(
        { error: 'Job descriptions are only supported on professional resource lines' },
        { status: 400 }
      )
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: 'Job description generation requires OPENAI_API_KEY.' },
        { status: 503 }
      )
    }

    const artifacts = opportunity.aiArtifacts as OpportunityArtifacts | null
    const brief =
      (artifacts?.brief as OpportunityBrief | undefined) ??
      (opportunity.opportunityBrief as OpportunityBrief | null) ??
      null

    const rawData = opportunity.rawData as Record<string, unknown> | null
    const pop = rawData?.placeOfPerformance as
      | { city?: { name?: string }; state?: { name?: string; code?: string }; country?: { name?: string } }
      | undefined
    const placeOfPerformance = pop
      ? [pop.city?.name, pop.state?.name || pop.state?.code, pop.country?.name]
          .filter(Boolean)
          .join(', ')
      : undefined

    const jobDescription = await generateJobDescription({
      brief,
      line,
      placeOfPerformance,
    })

    const updatedLines = plan.lines.slice()
    updatedLines[lineIdx] = { ...line, jobDescription }
    const updatedPlan: ResourcePlan = { ...plan, lines: updatedLines }

    await prisma.opportunity.update({
      where: { id },
      data: { resourcePlan: updatedPlan as object },
    })

    console.log(`[JobDescription] Regenerated line ${lineId} for opportunity ${id}`)

    return NextResponse.json({ jobDescription })
  } catch (error) {
    console.error('[JobDescription] Generation error:', error)
    const msg = error instanceof Error ? error.message : 'Failed to generate job description'
    const status = (error as { status?: number })?.status
    if (status === 429 || /quota|rate limit|insufficient_quota/i.test(msg)) {
      return NextResponse.json(
        { error: 'OpenAI quota exceeded — add credits at platform.openai.com/billing, then retry.' },
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
