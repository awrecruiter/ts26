'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import Link from 'next/link'
import nextDynamic from 'next/dynamic'
import AppLayout from '@/components/layout/AppLayout'
import type { PlottedOpportunity } from './MapCanvas'

// Google Maps touches `window` at module load. Render the canvas client-only
// so `next build` never tries to statically prerender it.
const MapCanvas = nextDynamic(() => import('./MapCanvas'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-stone-50 text-stone-400 text-sm">
      Loading map…
    </div>
  ),
})

interface Opportunity {
  id: string
  title: string
  agency: string | null
  naicsCode: string | null
  state: string | null
  responseDeadline: string | null
  latitude: number | null
  longitude: number | null
}

export default function OpportunitiesMapView() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { status: sessionStatus } = useSession()

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY

  const [opportunities, setOpportunities] = useState<Opportunity[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const geocodedIdsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (sessionStatus === 'unauthenticated') router.push('/login')
  }, [sessionStatus, router])

  const fetchOpportunities = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams(searchParams.toString())
      params.set('limit', '200')
      params.set('page', '1')
      const res = await fetch(`/api/opportunities?${params.toString()}`)
      if (!res.ok) throw new Error('Failed to fetch opportunities')
      const data = await res.json()
      setOpportunities(data.opportunities || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [searchParams])

  useEffect(() => {
    if (sessionStatus === 'authenticated') fetchOpportunities()
  }, [sessionStatus, fetchOpportunities])

  useEffect(() => {
    const missing = opportunities.filter(
      (o) => o.latitude == null && !geocodedIdsRef.current.has(o.id)
    )
    if (missing.length === 0) return
    missing.forEach((o) => geocodedIdsRef.current.add(o.id))
    ;(async () => {
      try {
        const res = await fetch('/api/opportunities/geocode-batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: missing.map((o) => o.id) }),
        })
        if (!res.ok) return
        const data = await res.json()
        const points: Record<string, { lat: number; lng: number }> = data.geocoded || {}
        if (Object.keys(points).length === 0) return
        setOpportunities((prev) =>
          prev.map((o) =>
            points[o.id]
              ? { ...o, latitude: points[o.id].lat, longitude: points[o.id].lng }
              : o
          )
        )
      } catch {
        // silent — geocode retry happens on next filter change
      }
    })()
  }, [opportunities])

  const plotted = useMemo<PlottedOpportunity[]>(
    () =>
      opportunities
        .filter((o) => o.latitude != null && o.longitude != null)
        .map((o) => ({
          id: o.id,
          title: o.title,
          agency: o.agency,
          naicsCode: o.naicsCode,
          state: o.state,
          responseDeadline: o.responseDeadline,
          latitude: o.latitude!,
          longitude: o.longitude!,
        })),
    [opportunities]
  )
  const pending = opportunities.length - plotted.length

  const listHref = useMemo(() => {
    const params = new URLSearchParams(searchParams.toString())
    return `/opportunities${params.toString() ? `?${params.toString()}` : ''}`
  }, [searchParams])

  if (!apiKey) {
    return (
      <AppLayout>
        <div className="min-h-screen bg-stone-50 flex items-center justify-center px-4">
          <div className="max-w-md text-center">
            <h1 className="text-xl font-bold text-stone-900">Map view unavailable</h1>
            <p className="mt-2 text-sm text-stone-600">
              Set <code className="bg-stone-100 px-1 rounded">NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code>{' '}
              in your Vercel environment to enable this page.
            </p>
          </div>
        </div>
      </AppLayout>
    )
  }

  return (
    <AppLayout>
      <div className="h-[calc(100vh-4rem)] flex flex-col bg-white">
        <header className="border-b border-stone-200 bg-white px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-xl font-bold text-stone-900">Opportunities Map</h1>
              <p className="text-sm text-stone-500 mt-0.5">
                {loading ? 'Loading…' : `${plotted.length} plotted`}
                {pending > 0 && !loading && ` · ${pending} awaiting geocode`}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Link
                href={listHref}
                className="px-3 py-1.5 text-sm font-medium text-stone-700 bg-white border border-stone-300 rounded-lg hover:bg-stone-50 transition-colors"
              >
                List view
              </Link>
              <span className="px-3 py-1.5 text-sm font-medium text-white bg-stone-800 rounded-lg">
                Map view
              </span>
            </div>
          </div>
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        </header>

        <div className="flex-1 relative">
          <MapCanvas apiKey={apiKey} opportunities={plotted} />
        </div>
      </div>
    </AppLayout>
  )
}
