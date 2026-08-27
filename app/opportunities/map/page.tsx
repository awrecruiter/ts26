import { Suspense } from 'react'
import OpportunitiesMapView from './MapView'

// Auth-gated + reads live URL params for filters — never a good candidate for
// static prerender. force-dynamic keeps Next.js from freezing a shell that
// would immediately have to bail out to CSR.
export const dynamic = 'force-dynamic'

export default function OpportunitiesMapPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center text-stone-400 text-sm">
          Loading…
        </div>
      }
    >
      <OpportunitiesMapView />
    </Suspense>
  )
}
