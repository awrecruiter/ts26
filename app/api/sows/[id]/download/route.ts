import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { renderToBuffer } from '@react-pdf/renderer'
import React from 'react'
import { SOWPDF } from '@/components/sows/SOWPDF'

/**
 * GET /api/sows/[id]/download
 * Render and stream SOW as PDF using @react-pdf/renderer
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()

    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params

    const sow = await prisma.sOW.findUnique({
      where: { id },
      include: {
        opportunity: {
          select: {
            title: true,
            solicitationNumber: true,
          },
        },
      },
    })

    if (!sow) {
      return NextResponse.json({ error: 'SOW not found' }, { status: 404 })
    }

    if (!sow.content) {
      return NextResponse.json({ error: 'SOW has no content to render' }, { status: 404 })
    }

    // Track view if status is SENT and not yet viewed
    if (sow.status === 'SENT' && !sow.viewedAt) {
      await prisma.sOW.update({
        where: { id },
        data: { status: 'VIEWED', viewedAt: new Date() },
      })
      await prisma.sOWActivity.create({
        data: {
          sowId: id,
          type: 'VIEWED',
          description: `SOW viewed by ${session.user.name || 'user'}`,
          userId: session.user.id,
          metadata: { viewedBy: session.user.email || 'unknown' },
        },
      })
    }

    // Resolve preparer identity — without this the PDF renders the literal
    // string "[Your Company Name]" in every prime-name slot. Prefer the
    // user's organization (if set), then their display name. Falls back to
    // the placeholder default in SOWPDF only when nothing is available.
    const sessionUser = session.user as { organization?: string; name?: string; email?: string }
    const preparerCompany =
      sessionUser.organization ||
      sessionUser.name ||
      sessionUser.email?.split('@')[0] ||
      undefined

    // Render PDF from structured content
    const content = sow.content as any
    const element = React.createElement(SOWPDF, {
      content,
      sowFileName: sow.fileName ?? undefined,
      preparerCompany,
      preparerName: sessionUser.name ?? undefined,
      status: sow.status,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any
    const pdfBuffer = await renderToBuffer(element)

    const solNum = sow.opportunity?.solicitationNumber || id
    const fileName = `SOW_${solNum}.pdf`

    // ?inline=true → render in browser (used by the in-panel Preview).
    // Default → download attachment.
    const url = new URL(req.url)
    const inline = url.searchParams.get('inline') === 'true'

    return new Response(new Uint8Array(pdfBuffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${fileName}"`,
        'Content-Length': pdfBuffer.byteLength.toString(),
      },
    })
  } catch (error) {
    console.error('Error generating SOW PDF:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
