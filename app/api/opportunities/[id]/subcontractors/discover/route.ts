import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { auth } from '@/lib/auth'
import { findSubcontractorsForOpportunity, geocodePlaceOfPerformance } from '@/lib/google-places'
import { searchSamEntities, samEntityToSubcontractor } from '@/lib/samgov'
import {
  isProductSolicitation,
  extractStateCode,
  extractPlaceOfPerformance,
  extractCity,
  suggestSearchRadius,
} from '@/lib/opportunity-classification'

/**
 * Normalize phone to digits only for comparison.
 */
function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  // Use last 10 digits (strip country code)
  return digits.length >= 10 ? digits.slice(-10) : digits || null
}

/**
 * Normalize address for comparison: lowercase, strip suite/unit numbers.
 */
function normalizeAddress(address: string | null | undefined): string | null {
  if (!address) return null
  return address
    .toLowerCase()
    .replace(/\b(suite|ste|unit|apt|#)\s*[\w-]+/gi, '')
    .replace(/[,.\s]+/g, ' ')
    .trim() || null
}

// POST - Auto-discover subcontractors via Google Maps + SAM.gov
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id: opportunityId } = await params

    // Parse optional radius from request body
    const body = await request.json().catch(() => ({}))

    // Get opportunity details
    const opportunity = await prisma.opportunity.findUnique({
      where: { id: opportunityId },
      include: {
        subcontractors: {
          select: {
            name: true,
            placeId: true,
            phone: true,
            address: true,
            ueiNumber: true,
          },
        },
      },
    }) as any

    if (!opportunity) {
      return NextResponse.json(
        { error: 'Opportunity not found' },
        { status: 404 }
      )
    }

    // Check if Google Places API is configured
    const apiKey = process.env.GOOGLE_PLACES_API_KEY
    const isApiConfigured = apiKey && !apiKey.includes('your-') && !apiKey.includes('your_')
    console.log(`[Discover] Google Places API key present: ${!!apiKey}, configured: ${!!isApiConfigured}, length: ${apiKey?.length || 0}`)

    // Classify opportunity: product vs. service
    const classification = isProductSolicitation({
      naicsCode: opportunity.naicsCode,
      title: opportunity.title,
      rawData: opportunity.rawData,
    })
    console.log(`[Discover] Classification: isProduct=${classification.isProduct}, confidence=${classification.confidence}, reason="${classification.reason}"`)

    // Extract location info
    const stateCode = extractStateCode(opportunity.rawData) || opportunity.state || null
    const city = extractCity(opportunity.rawData)
    const placeOfPerformance = extractPlaceOfPerformance(opportunity.rawData, opportunity.state)

    // Determine effective radius:
    // - If caller passed an explicit radiusMiles, use it (even for products —
    //   the user gets to choose whether to bias by location or go national).
    // - Otherwise auto-suggest based on city density (urban tighter, rural wider),
    //   defaulting to 250mi (national) for products without a city hint.
    const suggestedRadius = suggestSearchRadius(city, stateCode)
    const explicitRadius: 25 | 50 | 100 | 250 | null =
      [25, 50, 100, 250].includes(body.radiusMiles) ? body.radiusMiles : null
    const radiusMiles: 25 | 50 | 100 | 250 =
      explicitRadius ?? (classification.isProduct ? 250 : suggestedRadius)

    // National = no state/POP bias. Anything under 250mi uses the POP location +
    // state filter even for products, so the user's local-first selection wins.
    const isNational = radiusMiles === 250
    const searchLocation = isNational ? 'United States' : placeOfPerformance
    console.log(`[Discover] Search location: "${searchLocation}" (stateCode: ${stateCode}, radiusMiles: ${radiusMiles}, suggested: ${suggestedRadius}, isProduct: ${classification.isProduct}, isNational: ${isNational})`)

    // Geocode the place of performance once — used for per-vendor distance computation.
    // Skip when going national (distance irrelevant).
    let popCoords: { lat: number; lng: number } | null = null
    if (!isNational && placeOfPerformance && isApiConfigured) {
      popCoords = await geocodePlaceOfPerformance(placeOfPerformance)
      if (popCoords) {
        console.log(`[Discover] POP geocoded: ${placeOfPerformance} → (${popCoords.lat.toFixed(4)}, ${popCoords.lng.toFixed(4)})`)
      } else {
        console.log(`[Discover] POP geocode failed for "${placeOfPerformance}" — distance will not be computed`)
      }
    }

    // Build dedup sets from existing subcontractors
    const existingNames = new Set(
      opportunity.subcontractors.map((s: any) => s.name.toLowerCase().trim())
    )
    const existingPlaceIds = new Set(
      opportunity.subcontractors.map((s: any) => s.placeId).filter(Boolean)
    )
    const existingUEIs = new Set(
      opportunity.subcontractors.map((s: any) => s.ueiNumber).filter(Boolean)
    )
    const existingPhones = new Set(
      opportunity.subcontractors.map((s: any) => normalizePhone(s.phone)).filter(Boolean)
    )
    const existingAddresses = new Set(
      opportunity.subcontractors.map((s: any) => normalizeAddress(s.address)).filter(Boolean)
    )

    function isDuplicate(vendor: {
      name: string
      placeId?: string | null
      phone?: string | null
      address?: string | null
      ueiNumber?: string | null
    }): boolean {
      if (existingNames.has(vendor.name.toLowerCase().trim())) return true
      if (vendor.placeId && existingPlaceIds.has(vendor.placeId)) return true
      if (vendor.ueiNumber && existingUEIs.has(vendor.ueiNumber)) return true
      const normPhone = normalizePhone(vendor.phone)
      if (normPhone && existingPhones.has(normPhone)) return true
      const normAddr = normalizeAddress(vendor.address)
      if (normAddr && existingAddresses.has(normAddr)) return true
      return false
    }

    // Track newly added vendors for cross-source dedup
    function markAdded(vendor: {
      name: string
      placeId?: string | null
      phone?: string | null
      address?: string | null
      ueiNumber?: string | null
    }) {
      existingNames.add(vendor.name.toLowerCase().trim())
      if (vendor.placeId) existingPlaceIds.add(vendor.placeId)
      if (vendor.ueiNumber) existingUEIs.add(vendor.ueiNumber)
      const normPhone = normalizePhone(vendor.phone)
      if (normPhone) existingPhones.add(normPhone)
      const normAddr = normalizeAddress(vendor.address)
      if (normAddr) existingAddresses.add(normAddr)
    }

    const allCreateData: any[] = []

    // === Source 1: Google Places ===
    let googlePlacesApiError: string | undefined
    if (isApiConfigured) {
      console.log(`[Discover] Searching Google Places: NAICS=${opportunity.naicsCode}, location="${searchLocation}", radius=${radiusMiles}mi, title="${opportunity.title?.substring(0, 50)}"`)
      const { vendors, apiError } = await findSubcontractorsForOpportunity({
        naicsCode: opportunity.naicsCode,
        placeOfPerformance: isNational ? null : placeOfPerformance,
        stateCode: isNational ? null : stateCode,
        title: opportunity.title,
        radiusMiles,
        city: isNational ? null : city,
        popCoords: isNational ? null : popCoords,
      })

      if (apiError) {
        googlePlacesApiError = apiError
        console.warn(`[Discover] Google Places API error: ${apiError}`)
      }

      for (const vendor of vendors) {
        if (isDuplicate(vendor)) continue
        markAdded(vendor)
        allCreateData.push({
          opportunityId,
          name: vendor.name,
          phone: vendor.phone || null,
          email: null,
          website: vendor.website || null,
          address: vendor.address || null,
          service: vendor.service || null,
          rating: vendor.rating || null,
          totalRatings: vendor.totalRatings || null,
          businessStatus: vendor.businessStatus || null,
          placeId: vendor.placeId || null,
          location: vendor.location || null,
          distanceKm: vendor.distanceKm ?? null,
          source: 'google_places',
        })
      }
      console.log(`[Discover] Google Places: ${allCreateData.length} new vendors after dedup`)
    } else {
      console.log('[Discover] Google Places API not configured, skipping')
    }

    // === Source 2: SAM.gov Entity Search ===
    const samParams: { naicsCode?: string; stateCode?: string } = {}
    if (opportunity.naicsCode) samParams.naicsCode = opportunity.naicsCode
    if (!isNational && stateCode) samParams.stateCode = stateCode

    let samWarning: string | undefined
    if (samParams.naicsCode || samParams.stateCode) {
      console.log(`[Discover] Searching SAM.gov entities: NAICS=${samParams.naicsCode}, state=${samParams.stateCode}`)
      const samResult = await searchSamEntities(samParams)
      console.log(`[Discover] SAM.gov returned ${samResult.totalRecords} total, ${samResult.entityData.length} in page`)

      if (samResult.error) {
        samWarning = samResult.error
      }

      let samAdded = 0
      for (const entity of samResult.entityData) {
        const subData = samEntityToSubcontractor(entity, opportunityId)

        if (isDuplicate({
          name: subData.name,
          phone: subData.phone,
          address: subData.address,
          ueiNumber: subData.ueiNumber,
        })) continue

        markAdded(subData as any)
        allCreateData.push(subData)
        samAdded++
      }
      console.log(`[Discover] SAM.gov: ${samAdded} new vendors after dedup`)
    } else {
      console.log('[Discover] No NAICS/state for SAM.gov search, skipping')
    }

    if (allCreateData.length === 0) {
      if (!isApiConfigured) {
        return NextResponse.json(
          {
            error: 'Google Places API not configured',
            message: 'Add a valid GOOGLE_PLACES_API_KEY to your .env.local file to discover real vendors.',
            hint: 'Get an API key from https://console.cloud.google.com/apis/credentials',
          },
          { status: 503 }
        )
      }
      return NextResponse.json({
        message: 'No new vendors found for this opportunity.',
        added: 0,
        geography: { city, state: stateCode, radiusMiles, suggestedRadius },
        ...(googlePlacesApiError && {
          googlePlacesStatus: googlePlacesApiError,
          hint: googlePlacesApiError === 'REQUEST_DENIED'
            ? 'Ensure the Places API is enabled at console.cloud.google.com/apis and the API key has no referrer restrictions blocking server-side requests.'
            : 'Check the Google Places API key configuration.',
        }),
        ...(samWarning && { samWarning }),
      })
    }

    // Limit to 15 total new vendors
    const result = await prisma.subcontractor.createMany({
      data: allCreateData.slice(0, 15),
      skipDuplicates: true,
    })

    const googleCount = allCreateData.filter(v => v.source === 'google_places').length
    const samCount = allCreateData.filter(v => v.source === 'sam_gov').length

    return NextResponse.json({
      message: `Found ${result.count} vendors (${googleCount} Google Maps, ${samCount} SAM.gov)`,
      added: result.count,
      sources: { google: googleCount, sam: samCount },
      geography: { city, state: stateCode, radiusMiles, suggestedRadius },
      ...(samWarning && { samWarning }),
    })
  } catch (error) {
    console.error('Discover subcontractors error:', error)
    return NextResponse.json(
      { error: 'Failed to discover subcontractors', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
