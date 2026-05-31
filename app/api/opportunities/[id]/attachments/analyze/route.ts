import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { auth } from '@/lib/auth'
import { getOpportunityAttachments } from '@/lib/samgov'
import { analyzeAttachments } from '@/lib/openai'

/**
 * POST /api/opportunities/[id]/attachments/analyze
 *
 * Analyzes all attachments for this opportunity using GPT-4o:
 * - Suggests human-readable names with confidence levels
 * - Detects standard government forms (SF-1449, DD-254, etc.)
 *
 * Skips attachments that have already been analyzed OR have a manual rename.
 * Upserts AttachmentFormData records.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params
    const url = new URL(request.url)
    const force = url.searchParams.get('force') === 'true'

    const opportunity = await prisma.opportunity.findUnique({
      where: { id },
      select: {
        id: true,
        solicitationNumber: true,
        rawData: true,
        parsedAttachments: true,
        attachmentOverrides: {
          select: { attachmentId: true, originalName: true, currentName: true },
        },
        attachmentFormData: {
          select: { attachmentId: true },
        },
      },
    })

    if (!opportunity) {
      return NextResponse.json({ error: 'Opportunity not found' }, { status: 404 })
    }

    // Fetch raw attachment list from SAM.gov
    const rawAttachments = await getOpportunityAttachments(
      opportunity.solicitationNumber,
      opportunity.rawData
    )

    if (!rawAttachments.length) {
      return NextResponse.json({ analyzed: 0, skipped: 0 })
    }

    // Build sets for fast lookup
    const alreadyAnalyzed = new Set(opportunity.attachmentFormData.map((f) => f.attachmentId))
    const manualRenames = new Set(
      opportunity.attachmentOverrides
        .filter((o) => o.currentName !== o.originalName)
        .map((o) => o.attachmentId)
    )

    // Extract parsed text per attachment — keyed by filename (parsedAttachments stores by name, not id)
    const parsedData = opportunity.parsedAttachments as any
    const parsedTexts: Record<string, string> = {}
    if (parsedData?.parsed && Array.isArray(parsedData.parsed)) {
      for (const file of parsedData.parsed) {
        if (file.name && (file.fullText || file.preview)) {
          parsedTexts[file.name] = (file.fullText || file.preview) as string
        }
      }
    }

    // Filter: skip manually-renamed; skip already-analyzed unless force=true
    const toAnalyze = rawAttachments.filter(
      (att) => !manualRenames.has(att.id) && (force || !alreadyAnalyzed.has(att.id))
    )

    const skipped = rawAttachments.length - toAnalyze.length

    if (!toAnalyze.length) {
      return NextResponse.json({ analyzed: 0, skipped })
    }

    // Call GPT-4o — pass up to 1200 chars of document text for better naming context
    const analysisInputs = toAnalyze.map((att) => ({
      id: att.id,
      originalName: att.name,
      textContent: parsedTexts[att.name]?.slice(0, 1200),
    }))

    const results = await analyzeAttachments(analysisInputs)

    // Upsert AttachmentFormData for each result
    await Promise.all(
      results.map((r) =>
        prisma.attachmentFormData.upsert({
          where: { opportunityId_attachmentId: { opportunityId: id, attachmentId: r.id } },
          create: {
            opportunityId: id,
            attachmentId: r.id,
            aiSuggestedName: r.suggestedName,
            aiConfidence: r.confidence,
            isForm: r.isForm,
            formType: r.formType,
          },
          update: {
            aiSuggestedName: r.suggestedName,
            aiConfidence: r.confidence,
            isForm: r.isForm,
            formType: r.formType,
          },
        })
      )
    )

    return NextResponse.json({ analyzed: results.length, skipped })
  } catch (error) {
    console.error('Attachment analyze error:', error)
    const msg = error instanceof Error ? error.message : 'Failed to analyze attachments'
    const status = (error as { status?: number })?.status
    if (status === 429 || /quota|rate limit|insufficient_quota/i.test(msg)) {
      return NextResponse.json(
        { error: 'OpenAI quota exceeded — content-based attachment names need GPT-4o. Add credits at platform.openai.com/billing and retry.' },
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
