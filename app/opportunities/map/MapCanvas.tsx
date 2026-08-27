'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  APIProvider,
  Map,
  AdvancedMarker,
  InfoWindow,
} from '@vis.gl/react-google-maps'

const MAP_ID = 'usher-opportunities-map'
const US_CENTER = { lat: 39.5, lng: -98.35 }
const US_ZOOM = 4

export interface PlottedOpportunity {
  id: string
  title: string
  agency: string | null
  naicsCode: string | null
  state: string | null
  responseDeadline: string | null
  latitude: number
  longitude: number
}

interface Props {
  apiKey: string
  opportunities: PlottedOpportunity[]
}

export default function MapCanvas({ apiKey, opportunities }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = useMemo(
    () => opportunities.find((o) => o.id === selectedId) || null,
    [opportunities, selectedId]
  )

  return (
    <APIProvider apiKey={apiKey}>
      <Map
        mapId={MAP_ID}
        defaultCenter={US_CENTER}
        defaultZoom={US_ZOOM}
        gestureHandling="greedy"
        disableDefaultUI={false}
        className="w-full h-full"
      >
        {opportunities.map((o) => (
          <AdvancedMarker
            key={o.id}
            position={{ lat: o.latitude, lng: o.longitude }}
            onClick={() => setSelectedId(o.id)}
            title={o.title}
          />
        ))}
        {selected && (
          <InfoWindow
            position={{ lat: selected.latitude, lng: selected.longitude }}
            onCloseClick={() => setSelectedId(null)}
            pixelOffset={[0, -32]}
          >
            <div className="max-w-xs text-stone-900">
              <div className="text-xs font-medium text-stone-500 mb-1">
                {selected.agency?.split('.').pop() || selected.agency || 'Unknown agency'}
              </div>
              <div className="font-semibold text-sm leading-snug">{selected.title}</div>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-stone-600">
                {selected.naicsCode && <span>NAICS {selected.naicsCode}</span>}
                {selected.state && <span>{selected.state}</span>}
                {selected.responseDeadline && (
                  <span>Due {new Date(selected.responseDeadline).toLocaleDateString()}</span>
                )}
              </div>
              <Link
                href={`/opportunities/${selected.id}`}
                className="mt-3 inline-flex text-xs font-medium text-white bg-stone-800 px-2.5 py-1 rounded hover:bg-stone-700"
              >
                Open workspace →
              </Link>
            </div>
          </InfoWindow>
        )}
      </Map>
    </APIProvider>
  )
}
