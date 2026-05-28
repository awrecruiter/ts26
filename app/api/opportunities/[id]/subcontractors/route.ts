import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { auth } from '@/lib/auth'

// GET - List subcontractors for an opportunity
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params

    const subcontractors = await prisma.subcontractor.findMany({
      where: { opportunityId: id },
      orderBy: { name: 'asc' },
    })

    return NextResponse.json({ subcontractors })
  } catch (error) {
    console.error('Get subcontractors error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch subcontractors' },
      { status: 500 }
    )
  }
}

// POST - Add a subcontractor to an opportunity
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id: opportunityId } = await params
    const body = await request.json()

    const {
      name,
      phone,
      email,
      website,
      service,
      capabilities,
      rating,
      source,
      contactName,
      contactTitle,
      contactEmail,
      contactPhone,
      verificationStatus,
      ueiNumber,
      certifications,
      confidenceLevel,
    } = body

    // Verify opportunity exists
    const opportunity = await prisma.opportunity.findUnique({
      where: { id: opportunityId },
    })

    if (!opportunity) {
      return NextResponse.json(
        { error: 'Opportunity not found' },
        { status: 404 }
      )
    }

    // Check for duplicate
    const existing = await prisma.subcontractor.findFirst({
      where: {
        opportunityId,
        name: { equals: name, mode: 'insensitive' },
      },
    })

    if (existing) {
      return NextResponse.json(
        { error: 'Subcontractor already added', subcontractor: existing },
        { status: 409 }
      )
    }

    const subcontractor = await prisma.subcontractor.create({
      data: {
        opportunityId,
        name,
        phone,
        email,
        website,
        service: service || (capabilities ? capabilities.slice(0, 2).join(', ') : null),
        rating,
        source: source || 'manual',
        contactName: contactName || null,
        contactTitle: contactTitle || null,
        contactEmail: contactEmail || null,
        contactPhone: contactPhone || null,
        verificationStatus: verificationStatus || 'unverified',
        ueiNumber: ueiNumber || null,
        certifications: certifications || undefined,
        confidenceLevel: confidenceLevel || null,
      },
    })

    return NextResponse.json({ subcontractor }, { status: 201 })
  } catch (error) {
    console.error('Add subcontractor error:', error)
    return NextResponse.json(
      { error: 'Failed to add subcontractor' },
      { status: 500 }
    )
  }
}
