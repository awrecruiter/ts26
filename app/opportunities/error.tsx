'use client'

import { useEffect } from 'react'

export default function OpportunitiesError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Opportunities page error:', error)
  }, [error])

  return (
    <div className="min-h-screen bg-stone-50 flex items-center justify-center">
      <div className="bg-white border border-stone-200 rounded-lg p-8 max-w-lg w-full mx-4">
        <h2 className="text-lg font-semibold text-stone-900 mb-2">Something went wrong</h2>
        <p className="text-sm text-stone-600 mb-4">{error.message}</p>
        {error.digest && (
          <p className="text-xs text-stone-400 mb-4 font-mono">Digest: {error.digest}</p>
        )}
        <button
          onClick={reset}
          className="px-4 py-2 text-sm font-medium text-white bg-stone-800 rounded-lg hover:bg-stone-700"
        >
          Try again
        </button>
      </div>
    </div>
  )
}
