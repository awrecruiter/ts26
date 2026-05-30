import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { auth } from '@/lib/auth'
import { extractAttachmentsFromRawData } from '@/lib/samgov'
import { parseAllAttachments, mergeStructuredContent } from '@/lib/attachment-parser'

/**
 * POST /api/opportunities/{id}/parse-attachments
 * Downloads and parses PDF/DOCX attachments from the solicitation.
 * Results are cached in opportunity.parsedAttachments.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params

    const opportunity = await prisma.opportunity.findUnique({
      where: { id },
      select: {
        id: true,
        rawData: true,
        parsedAttachments: true,
      },
    })

    if (!opportunity) {
      return NextResponse.json(
        { error: 'Opportunity not found' },
        { status: 404 }
      )
    }

    // Return cached results if already parsed
    if (opportunity.parsedAttachments) {
      return NextResponse.json({
        cached: true,
        ...(opportunity.parsedAttachments as any),
      })
    }

    // Extract attachment URLs from raw data
    const attachments = extractAttachmentsFromRawData(opportunity.rawData)

    if (attachments.length === 0) {
      return NextResponse.json({
        message: 'No attachments found for this opportunity',
        parsed: [],
        structured: null,
      })
    }

    // Parse all PDF/DOCX attachments
    const parsed = await parseAllAttachments(attachments)
    const successCount = parsed.filter((p) => p.text.length > 0).length

    // Extract structured content from all parsed text
    const structured = mergeStructuredContent(parsed)

    // Build cached payload
    const result = {
      parsed: parsed.map((p) => ({
        name: p.name,
        textLength: p.text.length,
        pageCount: p.pageCount,
        preview: p.text.substring(0, 500),
        fullText: p.text,
        error: p.error,
      })),
      structured,
      totalAttachments: attachments.length,
      parsedCount: successCount,
      parsedAt: new Date().toISOString(),
    }

    // Cache in database (cast to satisfy Prisma's Json type)
    await prisma.opportunity.update({
      where: { id },
      data: { parsedAttachments: JSON.parse(JSON.stringify(result)) },
    })

    return NextResponse.json(result)
  } catch (error) {
    console.error('Parse attachments error:', error)
    return NextResponse.json(
      {
        error: 'Failed to parse attachments',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
