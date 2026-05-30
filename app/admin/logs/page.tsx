"use client"

import { useState, useEffect, Suspense } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'

interface SystemLog {
  id: string
  level: 'INFO' | 'WARNING' | 'ERROR' | 'DEBUG'
  message: string
  context: any
  createdAt: string
}

function AdminLogsPageContent() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [logs, setLogs] = useState<SystemLog[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 50,
    total: 0,
    totalPages: 0,
  })

  const [level, setLevel] = useState(searchParams.get('level') || '')
  const [expandedLogs, setExpandedLogs] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (status === 'authenticated' && session?.user?.role !== 'ADMIN') {
      router.push('/dashboard')
    }
  }, [status, session, router])

  useEffect(() => {
    if (status === 'authenticated') {
      fetchLogs()
    }
  }, [status, searchParams])

  const fetchLogs = async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams()
      params.set('page', searchParams.get('page') || '1')
      params.set('limit', '50')
      if (level) params.set('level', level)

      const response = await fetch(`/api/admin/logs?${params.toString()}`)
      if (!response.ok) throw new Error('Failed to fetch logs')
      const data = await response.json()
      setLogs(data.logs)
      setPagination(data.pagination)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  const handleLevelChange = (newLevel: string) => {
    setLevel(newLevel)
    const params = new URLSearchParams()
    if (newLevel) params.set('level', newLevel)
    params.set('page', '1')
    router.push(`/admin/logs?${params.toString()}`)
  }

  const handlePageChange = (newPage: number) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set('page', newPage.toString())
    router.push(`/admin/logs?${params.toString()}`)
  }

  const toggleLogExpansion = (logId: string) => {
    const newExpanded = new Set(expandedLogs)
    if (newExpanded.has(logId)) {
      newExpanded.delete(logId)
    } else {
      newExpanded.add(logId)
    }
    setExpandedLogs(newExpanded)
  }

  const getLevelBadgeClass = (logLevel: string) => {
    switch (logLevel) {
      case 'ERROR':
        return 'bg-stone-100 text-stone-900'
      case 'WARNING':
        return 'bg-stone-200 text-stone-700'
      case 'INFO':
        return 'bg-stone-200 text-stone-800'
      case 'DEBUG':
        return 'bg-stone-100 text-stone-800'
      default:
        return 'bg-stone-100 text-stone-800'
    }
  }

  if (status === 'loading' || (status === 'authenticated' && session?.user?.role !== 'ADMIN')) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-stone-600"></div>
          <p className="mt-4 text-stone-600">Loading...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-stone-50">
      {/* Header */}
      <div className="bg-white border-b border-stone-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-3xl font-bold text-stone-900">System Logs</h1>
              <p className="mt-2 text-sm text-stone-600">
                View system events and errors
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white border-b border-stone-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex gap-4">
            <select
              value={level}
              onChange={(e) => handleLevelChange(e.target.value)}
              className="px-4 py-2 border border-stone-300 rounded-md focus:outline-none focus:ring-2 focus:ring-stone-900"
            >
              <option value="">All Levels</option>
              <option value="ERROR">Errors</option>
              <option value="WARNING">Warnings</option>
              <option value="INFO">Info</option>
              <option value="DEBUG">Debug</option>
            </select>
            <button
              onClick={() => fetchLogs()}
              className="px-4 py-2 bg-stone-800 text-white rounded-md hover:bg-stone-700"
            >
              Refresh
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {loading && (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-stone-600"></div>
            <p className="mt-4 text-stone-600">Loading logs...</p>
          </div>
        )}

        {error && (
          <div className="mb-4 p-4 bg-stone-100 border border-stone-400 rounded-md">
            <p className="text-stone-900">{error}</p>
            <button
              onClick={() => { setError(''); fetchLogs(); }}
              className="mt-2 text-sm text-stone-900 underline"
            >
              Retry
            </button>
          </div>
        )}

        {!loading && !error && (
          <>
            <div className="bg-white shadow-sm rounded-lg overflow-hidden">
              {logs.length > 0 ? (
                <div className="divide-y divide-stone-200">
                  {logs.map((log) => (
                    <div key={log.id} className="p-4">
                      <div
                        className="flex items-start gap-4 cursor-pointer"
                        onClick={() => toggleLogExpansion(log.id)}
                      >
                        <span
                          className={`px-2 py-1 text-xs font-medium rounded-full ${getLevelBadgeClass(log.level)}`}
                        >
                          {log.level}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-stone-900 font-mono break-all">
                            {log.message}
                          </p>
                          <p className="text-xs text-stone-500 mt-1">
                            {new Date(log.createdAt).toLocaleString()}
                          </p>
                        </div>
                        <svg
                          className={`h-5 w-5 text-stone-400 transition-transform ${
                            expandedLogs.has(log.id) ? 'rotate-180' : ''
                          }`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </div>
                      {expandedLogs.has(log.id) && log.context && (
                        <div className="mt-4 ml-16 p-4 bg-stone-50 rounded-md">
                          <pre className="text-xs text-stone-700 overflow-x-auto">
                            {JSON.stringify(log.context, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12">
                  <p className="text-stone-500">No logs found</p>
                  {level && (
                    <p className="text-stone-400 mt-2 text-sm">
                      Try adjusting your filters
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Pagination */}
            {pagination.totalPages > 1 && (
              <div className="flex justify-center items-center gap-4 mt-8">
                <button
                  onClick={() => handlePageChange(pagination.page - 1)}
                  disabled={pagination.page === 1}
                  className="px-4 py-2 bg-white border border-stone-300 rounded-md hover:bg-stone-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Previous
                </button>
                <span className="text-stone-600">
                  Page {pagination.page} of {pagination.totalPages}
                </span>
                <button
                  onClick={() => handlePageChange(pagination.page + 1)}
                  disabled={pagination.page === pagination.totalPages}
                  className="px-4 py-2 bg-white border border-stone-300 rounded-md hover:bg-stone-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
            )}

            <div className="text-center mt-4 text-sm text-stone-600">
              Showing {logs.length} of {pagination.total} logs
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default function AdminLogsPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-stone-600"></div>
          <p className="mt-4 text-stone-600">Loading logs...</p>
        </div>
      </div>
    }>
      <AdminLogsPageContent />
    </Suspense>
  )
}
