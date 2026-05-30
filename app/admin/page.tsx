'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import Link from 'next/link'

export default function AdminDashboard() {
  const router = useRouter()
  const { data: session, status } = useSession()

  const [backfilling, setBackfilling] = useState(false)
  const [backfillResult, setBackfillResult] = useState<{
    success: boolean
    message: string
    stats?: {
      total_found: number
      updated: number
      errors: number
    }
    errors?: Array<{ sowId: string; error: string }>
  } | null>(null)

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login')
    } else if (status === 'authenticated' && session?.user?.role !== 'ADMIN') {
      router.push('/dashboard')
    }
  }, [status, session])

  const handleBackfillSOWs = async () => {
    if (!confirm('This will update all SOWs without structured content. Continue?')) {
      return
    }

    setBackfilling(true)
    setBackfillResult(null)

    try {
      const response = await fetch('/api/sows/backfill-content', {
        method: 'POST',
      })

      const data = await response.json()

      if (response.ok) {
        setBackfillResult(data)
      } else {
        setBackfillResult({
          success: false,
          message: data.error || 'Failed to backfill SOWs',
        })
      }
    } catch (error) {
      console.error('Error backfilling SOWs:', error)
      setBackfillResult({
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error occurred',
      })
    } finally {
      setBackfilling(false)
    }
  }

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          <p className="mt-4 text-stone-600">Loading...</p>
        </div>
      </div>
    )
  }

  if (status === 'authenticated' && session?.user?.role !== 'ADMIN') {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-stone-900 mb-2">Access Denied</h1>
          <p className="text-stone-600 mb-4">You must be an administrator to access this page.</p>
          <Link
            href="/dashboard"
            className="px-4 py-2 bg-stone-800 text-white rounded-md hover:bg-stone-700"
          >
            Go to Dashboard
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-stone-50">
      {/* Header */}
      <div className="bg-white border-b border-stone-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <h1 className="text-3xl font-bold text-stone-900">Admin Dashboard</h1>
          <p className="mt-1 text-sm text-stone-500">
            System administration and maintenance
          </p>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Quick Actions Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
          {/* Backfill SOWs Card */}
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-start">
              <div className="flex-shrink-0 bg-stone-100 rounded-md p-3">
                <svg
                  className="h-6 w-6 text-stone-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
              </div>
              <div className="ml-4 flex-1">
                <h3 className="text-lg font-semibold text-stone-900 mb-2">
                  Backfill SOWs
                </h3>
                <p className="text-sm text-stone-600 mb-4">
                  Update all SOWs without structured content to the new format
                </p>
                <button
                  onClick={handleBackfillSOWs}
                  disabled={backfilling}
                  className="w-full px-4 py-2 bg-stone-800 text-white rounded-md hover:bg-stone-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {backfilling ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                      Processing...
                    </>
                  ) : (
                    <>
                      <svg
                        className="h-5 w-5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                        />
                      </svg>
                      Run Backfill
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* User Management Card */}
          <Link
            href="/admin/users"
            className="bg-white rounded-lg shadow p-6 hover:shadow-md transition-shadow"
          >
            <div className="flex items-start">
              <div className="flex-shrink-0 bg-stone-100 rounded-md p-3">
                <svg
                  className="h-6 w-6 text-stone-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"
                  />
                </svg>
              </div>
              <div className="ml-4">
                <h3 className="text-lg font-semibold text-stone-900 mb-2">
                  User Management
                </h3>
                <p className="text-sm text-stone-600">
                  Manage users, roles, and permissions
                </p>
              </div>
            </div>
          </Link>

          {/* Settings Card */}
          <Link
            href="/admin/settings"
            className="bg-white rounded-lg shadow p-6 hover:shadow-md transition-shadow"
          >
            <div className="flex items-start">
              <div className="flex-shrink-0 bg-stone-100 rounded-md p-3">
                <svg
                  className="h-6 w-6 text-stone-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                </svg>
              </div>
              <div className="ml-4">
                <h3 className="text-lg font-semibold text-stone-900 mb-2">
                  System Settings
                </h3>
                <p className="text-sm text-stone-600">
                  Configure system-wide settings
                </p>
              </div>
            </div>
          </Link>

          {/* System Logs Card */}
          <Link
            href="/admin/logs"
            className="bg-white rounded-lg shadow p-6 hover:shadow-md transition-shadow"
          >
            <div className="flex items-start">
              <div className="flex-shrink-0 bg-stone-100 rounded-md p-3">
                <svg
                  className="h-6 w-6 text-stone-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
              </div>
              <div className="ml-4">
                <h3 className="text-lg font-semibold text-stone-900 mb-2">
                  System Logs
                </h3>
                <p className="text-sm text-stone-600">
                  View system activity and error logs
                </p>
              </div>
            </div>
          </Link>

          {/* API Status Card */}
          <Link
            href="/admin/api-status"
            className="bg-white rounded-lg shadow p-6 hover:shadow-md transition-shadow"
          >
            <div className="flex items-start">
              <div className="flex-shrink-0 bg-stone-100 rounded-md p-3">
                <svg
                  className="h-6 w-6 text-stone-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                  />
                </svg>
              </div>
              <div className="ml-4">
                <h3 className="text-lg font-semibold text-stone-900 mb-2">
                  API Status
                </h3>
                <p className="text-sm text-stone-600">
                  Live health checks for all external APIs and calculation audit
                </p>
              </div>
            </div>
          </Link>
        </div>

        {/* Backfill Result Display */}
        {backfillResult && (
          <div
            className={`rounded-lg border-2 p-6 mb-8 ${
              backfillResult.success
                ? 'bg-stone-50 border-stone-300'
                : 'bg-stone-100 border-stone-400'
            }`}
          >
            <div className="flex items-start">
              <div className="flex-shrink-0">
                {backfillResult.success ? (
                  <svg
                    className="h-6 w-6 text-stone-700"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                ) : (
                  <svg
                    className="h-6 w-6 text-stone-900"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                )}
              </div>
              <div className="ml-4 flex-1">
                <h3 className="text-lg font-semibold mb-2 text-stone-900">
                  {backfillResult.success ? 'Backfill Successful' : 'Backfill Failed'}
                </h3>
                <p className="text-sm mb-4 text-stone-700">
                  {backfillResult.message}
                </p>

                {backfillResult.stats && (
                  <div className="grid grid-cols-3 gap-4 mb-4">
                    <div className="bg-white rounded-lg p-3 border border-stone-200">
                      <p className="text-xs text-stone-500">Found</p>
                      <p className="text-2xl font-bold text-stone-900">
                        {backfillResult.stats.total_found}
                      </p>
                    </div>
                    <div className="bg-white rounded-lg p-3 border border-stone-200">
                      <p className="text-xs text-stone-500">Updated</p>
                      <p className="text-2xl font-bold text-stone-900">
                        {backfillResult.stats.updated}
                      </p>
                    </div>
                    <div className="bg-white rounded-lg p-3 border border-stone-200">
                      <p className="text-xs text-stone-500">Errors</p>
                      <p className="text-2xl font-bold text-stone-900">
                        {backfillResult.stats.errors}
                      </p>
                    </div>
                  </div>
                )}

                {backfillResult.errors && backfillResult.errors.length > 0 && (
                  <details className="mt-4">
                    <summary className="cursor-pointer text-sm font-semibold text-stone-900 hover:text-stone-700">
                      View Errors ({backfillResult.errors.length})
                    </summary>
                    <div className="mt-2 space-y-2">
                      {backfillResult.errors.map((error, index) => (
                        <div key={index} className="bg-white rounded p-2 text-sm border border-stone-200">
                          <p className="font-mono text-xs text-stone-600">
                            SOW ID: {error.sowId}
                          </p>
                          <p className="text-stone-800">{error.error}</p>
                        </div>
                      ))}
                    </div>
                  </details>
                )}

                <button
                  onClick={() => setBackfillResult(null)}
                  className="mt-4 text-sm font-medium text-stone-600 hover:text-stone-900"
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Info Section */}
        <div className="bg-stone-50 border border-stone-200 rounded-lg p-6">
          <div className="flex items-start">
            <div className="flex-shrink-0">
              <svg
                className="h-6 w-6 text-stone-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
            <div className="ml-4">
              <h3 className="text-sm font-semibold text-stone-900 mb-2">
                About the Backfill Tool
              </h3>
              <p className="text-sm text-stone-700">
                The backfill tool updates all SOWs that were created before the structured
                content feature was added. It will generate standardized content for each
                SOW based on its opportunity data, making them viewable and editable in the
                new format.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
