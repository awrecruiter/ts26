import { NextResponse } from 'next/server'
import { searchBusinesses, getPlaceDetails } from '@/lib/google-places'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const query = searchParams.get('query') || ''
    const state = searchParams.get('state') || undefined

    if (!query.trim()) {
      return NextResponse.json({ results: [] })
    }

    // Check if Google Places API is configured
    const apiKey = process.env.GOOGLE_PLACES_API_KEY
    const isApiConfigured = apiKey && !apiKey.includes('your-') && !apiKey.includes('your_')

    if (!isApiConfigured) {
      return NextResponse.json({
        results: [],
        error: 'Google Places API not configured',
        message: 'Add a valid GOOGLE_PLACES_API_KEY to .env.local to search for real businesses.',
      })
    }

    // Build location string
    const location = state ? `${state}, USA` : 'United States'

    // Search Google Places
    const { results: businesses } = await searchBusinesses(query, location, 10)

    // Get details for each business
    const results = await Promise.all(
      businesses.map(async (business: { placeId: string; name: string; address: string; rating: number | null; types: string[] }) => {
        const details = await getPlaceDetails(business.placeId)
        return {
          id: `google-${business.placeId}`,
          name: business.name,
          phone: details.phone || null,
          email: null, // Google Places doesn't provide email
          website: details.website || null,
          address: business.address,
          rating: business.rating,
          service: business.types
            ?.filter((t: string) => !['point_of_interest', 'establishment'].includes(t))
            .slice(0, 2)
            .map((t: string) => t.replace(/_/g, ' '))
            .join(', ') || null,
          source: 'google_places',
          relevanceScore: business.rating ? business.rating / 5 : 0.5,
          placeId: business.placeId,
        }
      })
    )

    return NextResponse.json({
      results,
      source: 'google_places',
      isRealData: true,
    })
  } catch (error) {
    console.error('Subcontractor search error:', error)
    return NextResponse.json(
      { error: 'Search failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
