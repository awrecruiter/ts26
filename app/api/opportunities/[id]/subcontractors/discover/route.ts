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
import type { ResourcePlan, ResourceLine } from '@/lib/types/resource-plan'

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

    // Split slot quotas between sources so Google can't starve SAM out.
    // Total cap of 15 per run, with Google capped at 10 leaving 5+ for SAM.
    const TOTAL_CAP = 15
    const GOOGLE_CAP = 10
    const googleCreateData: any[] = []
    const samCreateData: any[] = []

    // Resolve resource-plan mode. Modes:
    //   A) scoped   — body.resourceLineId → search only that role, skip SAM
    //   B) fan-out  — no resourceLineId + resourcePlan present → one search per line
    //   C) legacy   — no resourceLineId + no resourcePlan → existing NAICS-map path
    const resourcePlan = (opportunity.resourcePlan ?? null) as ResourcePlan | null
    const requestedLineId: string | undefined = typeof body.resourceLineId === 'string' ? body.resourceLineId : undefined

    let scopedLine: ResourceLine | null = null
    if (requestedLineId) {
      const line = resourcePlan?.lines?.find(l => l.id === requestedLineId) ?? null
      if (!line) {
        return NextResponse.json(
          { error: 'Resource line not found on this opportunity' },
          { status: 400 }
        )
      }
      if (line.category !== 'professional' && line.category !== 'subcontracted_trade') {
        return NextResponse.json(
          { error: 'Vendor discovery is only supported for professional or subcontracted_trade lines' },
          { status: 400 }
        )
      }
      scopedLine = line
    }

    const isScopedMode = !!scopedLine
    const isFanoutMode = !isScopedMode && !!resourcePlan?.lines?.length
    const perLineBreakdown: Array<{ resourceLineId: string; label: string; added: number }> = []

    // === Source 1: Google Places ===
    let googlePlacesApiError: string | undefined
    if (isApiConfigured) {
      if (isScopedMode && scopedLine) {
        // Mode A — single-line scoped search
        console.log(`[Discover] Scoped search for line ${scopedLine.id} "${scopedLine.label}": queries=${JSON.stringify(scopedLine.searchQueries ?? [])}, location="${searchLocation}", radius=${radiusMiles}mi`)
        const { vendors, apiError } = await findSubcontractorsForOpportunity({
          naicsCode: scopedLine.suggestedNaics ?? opportunity.naicsCode,
          placeOfPerformance: isNational ? null : placeOfPerformance,
          stateCode: isNational ? null : stateCode,
          title: opportunity.title,
          radiusMiles,
          city: isNational ? null : city,
          popCoords: isNational ? null : popCoords,
          searchQueries: scopedLine.searchQueries ?? [],
        })

        if (apiError) {
          googlePlacesApiError = apiError
          console.warn(`[Discover] Google Places API error: ${apiError}`)
        }

        for (const vendor of vendors) {
          if (googleCreateData.length >= GOOGLE_CAP) break
          if (isDuplicate(vendor)) continue
          markAdded(vendor)
          googleCreateData.push({
            opportunityId,
            resourceLineId: scopedLine.id,
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
        console.log(`[Discover] Scoped Google Places: ${googleCreateData.length} new vendors after dedup`)
      } else if (isFanoutMode && resourcePlan) {
        // Mode B — fan out across the first 5 professional/trade lines
        const eligibleLines = resourcePlan.lines
          .filter(l => l.category === 'professional' || l.category === 'subcontracted_trade')
          .slice(0, 5)
        console.log(`[Discover] Fan-out across ${eligibleLines.length} resource line(s)`)

        for (const line of eligibleLines) {
          if (googleCreateData.length >= TOTAL_CAP) {
            console.log(`[Discover] TOTAL_CAP=${TOTAL_CAP} reached mid-fanout, stopping`)
            break
          }
          const queries = line.searchQueries ?? []
          if (queries.length === 0) {
            console.log(`[Discover] Skipping line ${line.id} "${line.label}" — no searchQueries`)
            perLineBreakdown.push({ resourceLineId: line.id, label: line.label, added: 0 })
            continue
          }
          console.log(`[Discover] Fan-out line ${line.id} "${line.label}": queries=${JSON.stringify(queries)}`)
          const { vendors, apiError } = await findSubcontractorsForOpportunity({
            naicsCode: line.suggestedNaics ?? opportunity.naicsCode,
            placeOfPerformance: isNational ? null : placeOfPerformance,
            stateCode: isNational ? null : stateCode,
            title: opportunity.title,
            radiusMiles,
            city: isNational ? null : city,
            popCoords: isNational ? null : popCoords,
            searchQueries: queries,
          })

          if (apiError && !googlePlacesApiError) {
            googlePlacesApiError = apiError
            console.warn(`[Discover] Google Places API error: ${apiError}`)
          }

          let lineAdded = 0
          for (const vendor of vendors) {
            if (googleCreateData.length >= TOTAL_CAP) break
            if (isDuplicate(vendor)) continue
            markAdded(vendor)
            googleCreateData.push({
              opportunityId,
              resourceLineId: line.id,
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
            lineAdded++
          }
          perLineBreakdown.push({ resourceLineId: line.id, label: line.label, added: lineAdded })
          console.log(`[Discover] Fan-out line ${line.id}: ${lineAdded} added`)
        }
        console.log(`[Discover] Fan-out Google Places: ${googleCreateData.length} new vendors total after dedup`)
      } else {
        // Mode C — legacy NAICS-map path (unchanged behavior)
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
          googleCreateData.push({
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
        console.log(`[Discover] Google Places: ${googleCreateData.length} new vendors after dedup`)
      }
    } else {
      console.log('[Discover] Google Places API not configured, skipping')
    }

    // === Source 2: SAM.gov Entity Search ===
    // Skipped in scoped mode — single-role focus, no opportunity-wide sweep.
    const samParams: { naicsCode?: string; stateCode?: string } = {}
    if (opportunity.naicsCode) samParams.naicsCode = opportunity.naicsCode
    if (!isNational && stateCode) samParams.stateCode = stateCode

    let samWarning: string | undefined
    let samTotalRecords = 0
    let samSearched = false
    let samAdded = 0
    if (isScopedMode) {
      console.log('[Discover] Scoped mode: skipping SAM.gov entity search')
    } else if (samParams.naicsCode || samParams.stateCode) {
      samSearched = true
      console.log(`[Discover] Searching SAM.gov entities: NAICS=${samParams.naicsCode}, state=${samParams.stateCode}`)
      const samResult = await searchSamEntities(samParams)
      samTotalRecords = samResult.totalRecords
      console.log(`[Discover] SAM.gov returned ${samResult.totalRecords} total, ${samResult.entityData.length} in page`)

      if (samResult.error) {
        samWarning = samResult.error
      }

      for (const entity of samResult.entityData) {
        const subData = samEntityToSubcontractor(entity, opportunityId)

        if (isDuplicate({
          name: subData.name,
          phone: subData.phone,
          address: subData.address,
          ueiNumber: subData.ueiNumber,
        })) continue

        markAdded(subData as any)
        samCreateData.push(subData)
        samAdded++
      }
      console.log(`[Discover] SAM.gov: ${samAdded} new vendors after dedup`)
    } else {
      console.log('[Discover] No NAICS/state for SAM.gov search, skipping')
    }

    // Compose final list: Google capped at GOOGLE_CAP, SAM fills remaining slots up to TOTAL_CAP.
    const googleSlice = googleCreateData.slice(0, GOOGLE_CAP)
    const samSlice = samCreateData.slice(0, TOTAL_CAP - googleSlice.length)
    const allCreateData = [...googleSlice, ...samSlice]

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
        sources: { google: 0, sam: 0 },
        sam: { searched: samSearched, totalRecords: samTotalRecords, added: 0, error: samWarning ?? null },
        geography: { city, state: stateCode, radiusMiles, suggestedRadius },
        ...(isFanoutMode && { perLineBreakdown }),
        ...(googlePlacesApiError && {
          googlePlacesStatus: googlePlacesApiError,
          hint: googlePlacesApiError === 'REQUEST_DENIED'
            ? 'Ensure the Places API is enabled at console.cloud.google.com/apis and the API key has no referrer restrictions blocking server-side requests.'
            : 'Check the Google Places API key configuration.',
        }),
        ...(samWarning && { samWarning }),
      })
    }

    const result = await prisma.subcontractor.createMany({
      data: allCreateData,
      skipDuplicates: true,
    })

    const googleCount = allCreateData.filter(v => v.source === 'google_places').length
    const samCount = allCreateData.filter(v => v.source === 'sam_gov').length

    return NextResponse.json({
      message: `Found ${result.count} vendors (${googleCount} Google Maps, ${samCount} SAM.gov)`,
      added: result.count,
      sources: { google: googleCount, sam: samCount },
      sam: { searched: samSearched, totalRecords: samTotalRecords, added: samAdded, error: samWarning ?? null },
      geography: { city, state: stateCode, radiusMiles, suggestedRadius },
      ...(isFanoutMode && { perLineBreakdown }),
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
