"use client"

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import Link from 'next/link'
import WIPProgressTracker from '@/components/progress/WIPProgressTracker'

// Force dynamic rendering
export const dynamic = 'force-dynamic'

export default function DashboardPage() {
  const router = useRouter()
  const { data: session, status } = useSession()
  const [stats, setStats] = useState({
    totalOpportunities: 0,
    activeOpportunities: 0,
    totalBids: 0,
    totalSubcontractors: 0,
    totalSOWs: 0,
    pendingApprovalSOWs: 0,
  })
  const [assessmentStats, setAssessmentStats] = useState<any>(null)
  const [recentAssessments, setRecentAssessments] = useState<any[]>([])
  const [recentOpportunities, setRecentOpportunities] = useState<any[]>([])
  const [pendingSOWs, setPendingSOWs] = useState<any[]>([])
  const [opportunitiesInProgress, setOpportunitiesInProgress] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchingSAM, setFetchingSAM] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login')
    } else if (status === 'authenticated') {
      fetchDashboardData()
    }
  }, [status])

  const fetchDashboardData = async () => {
    try {
      // Fetch recent opportunities
      const oppResponse = await fetch('/api/opportunities?limit=5')
      if (oppResponse.ok) {
        const data = await oppResponse.json()
        const opportunities = data.opportunities || []

        // Fetch or auto-generate assessment for each opportunity
        const oppsWithAssessments = await Promise.all(
          opportunities.map(async (opp: any) => {
            try {
              let assessmentResponse = await fetch(`/api/opportunities/${opp.id}/assessment`)
              if (assessmentResponse.ok) {
                const assessmentData = await assessmentResponse.json()
                if (!assessmentData.assessment) {
                  const autoGenResponse = await fetch(`/api/opportunities/${opp.id}/assessment/auto-generate`, {
                    method: 'POST',
                  })
                  if (autoGenResponse.ok) {
                    const autoGenData = await autoGenResponse.json()
                    return { ...opp, assessment: autoGenData.assessment }
                  }
                } else {
                  return { ...opp, assessment: assessmentData.assessment }
                }
              }
            } catch (err) {
              console.error(`Failed to fetch/generate assessment for ${opp.id}:`, err)
            }
            return opp
          })
        )

        setRecentOpportunities(oppsWithAssessments)
        setStats(prev => ({
          ...prev,
          totalOpportunities: data.pagination?.total || 0,
          activeOpportunities: oppsWithAssessments.length,
        }))

        // Fetch progress for first 3 opportunities
        const oppsWithProgress = await Promise.all(
          oppsWithAssessments.slice(0, 3).map(async (opp: any) => {
            try {
              const progressResponse = await fetch(`/api/opportunities/${opp.id}/progress`)
              if (progressResponse.ok) {
                const progressData = await progressResponse.json()
                return { ...opp, progress: progressData }
              }
            } catch (err) {
              console.error(`Failed to fetch progress for ${opp.id}:`, err)
            }
            return null
          })
        )

        setOpportunitiesInProgress(
          oppsWithProgress.filter((opp) => opp && opp.progress)
        )
      }

      // Fetch SOWs data
      const sowResponse = await fetch('/api/sows?limit=100')
      if (sowResponse.ok) {
        const sowData = await sowResponse.json()
        const allSOWs = sowData.sows || []
        const pending = allSOWs.filter((sow: any) => sow.status === 'PENDING_REVIEW')

        setStats(prev => ({
          ...prev,
          totalSOWs: sowData.pagination?.total || 0,
          pendingApprovalSOWs: pending.length,
        }))
        setPendingSOWs(pending.slice(0, 5))
      }

      // Fetch assessment statistics
      const assessmentResponse = await fetch('/api/assessments/stats')
      if (assessmentResponse.ok) {
        const assessmentData = await assessmentResponse.json()
        setAssessmentStats(assessmentData.stats)
        setRecentAssessments(assessmentData.recentAssessments || [])
      }
    } catch (error) {
      console.error('Error fetching dashboard data:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleFetchFromSAM = async () => {
    setFetchingSAM(true)
    setFetchError(null)
    try {
      const res = await fetch('/api/opportunities/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 25, posted_days_ago: 90 }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Fetch failed')
      await fetchDashboardData()
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setFetchingSAM(false)
    }
  }

  if (status === 'loading' || loading) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-stone-600"></div>
          <p className="mt-4 text-stone-500">Loading dashboard...</p>
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
              <h1 className="text-2xl font-bold text-stone-900">Dashboard</h1>
              <p className="mt-0.5 text-sm text-stone-500">
                Welcome back, {session?.user?.name || 'User'}!
              </p>
            </div>
            <Link
              href="/opportunities"
              className="px-4 py-2 text-sm font-medium text-white bg-stone-800 rounded-lg hover:bg-stone-700 transition-colors"
            >
              View All Opportunities
            </Link>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <div className="bg-white rounded-lg border border-stone-200 p-6">
            <div className="flex items-center">
              <div className="flex-shrink-0 bg-stone-100 rounded-lg p-3">
                <svg className="h-6 w-6 text-stone-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-stone-500">Total Opportunities</p>
                <p className="text-2xl font-semibold text-stone-900">{stats.totalOpportunities}</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg border border-stone-200 p-6">
            <div className="flex items-center">
              <div className="flex-shrink-0 bg-stone-100 rounded-lg p-3">
                <svg className="h-6 w-6 text-stone-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-stone-500">Active Opportunities</p>
                <p className="text-2xl font-semibold text-stone-900">{stats.activeOpportunities}</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg border border-stone-200 p-6">
            <div className="flex items-center">
              <div className="flex-shrink-0 bg-stone-100 rounded-lg p-3">
                <svg className="h-6 w-6 text-stone-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-stone-500">Total Bids</p>
                <p className="text-2xl font-semibold text-stone-900">{stats.totalBids}</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg border border-stone-200 p-6">
            <div className="flex items-center">
              <div className="flex-shrink-0 bg-stone-100 rounded-lg p-3">
                <svg className="h-6 w-6 text-stone-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-stone-500">Subcontractors</p>
                <p className="text-2xl font-semibold text-stone-900">{stats.totalSubcontractors}</p>
              </div>
            </div>
          </div>
        </div>

        {/* SOW Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <div className="bg-white rounded-lg border border-stone-200 p-6">
            <div className="flex items-center">
              <div className="flex-shrink-0 bg-stone-100 rounded-lg p-3">
                <svg className="h-6 w-6 text-stone-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <div className="ml-4 flex-1">
                <p className="text-sm font-medium text-stone-500">Total SOWs</p>
                <p className="text-2xl font-semibold text-stone-900">{stats.totalSOWs}</p>
              </div>
              <Link
                href="/sows"
                className="text-sm text-stone-500 hover:text-stone-800 font-medium"
              >
                View All →
              </Link>
            </div>
          </div>

          <div className="bg-white rounded-lg border border-stone-200 p-6">
            <div className="flex items-center">
              <div className="flex-shrink-0 bg-stone-100 rounded-lg p-3">
                <svg className="h-6 w-6 text-stone-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="ml-4 flex-1">
                <p className="text-sm font-medium text-stone-500">Pending Approval</p>
                <p className="text-2xl font-semibold text-stone-900">{stats.pendingApprovalSOWs}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Assessment & Financial Metrics */}
        {assessmentStats && (
          <>
            {/* Financial Summary Card */}
            <div className="bg-stone-900 rounded-lg border border-stone-800 p-6 mb-8 text-white">
              <h2 className="text-base font-semibold text-stone-100 mb-4">Financial Overview</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div>
                  <p className="text-stone-400 text-xs font-medium uppercase tracking-wide mb-1">Total Pipeline Value</p>
                  <p className="text-3xl font-bold text-white">
                    ${(assessmentStats.totalEstimatedValue || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </p>
                </div>
                <div>
                  <p className="text-stone-400 text-xs font-medium uppercase tracking-wide mb-1">Estimated Profit</p>
                  <p className="text-3xl font-bold text-white">
                    ${(assessmentStats.totalEstimatedProfit || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </p>
                </div>
                <div>
                  <p className="text-stone-400 text-xs font-medium uppercase tracking-wide mb-1">Avg Profit Margin</p>
                  <p className="text-3xl font-bold text-white">
                    {(assessmentStats.avgProfitMargin || 0).toFixed(1)}%
                  </p>
                  <p className="text-stone-400 text-xs mt-1">
                    {assessmentStats.meetsTargetCount || 0} of {assessmentStats.totalAssessments || 0} meet target (≥10%)
                  </p>
                </div>
              </div>
            </div>

            {/* Assessment Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
              <div className="bg-white rounded-lg border border-stone-200 p-6">
                <div className="flex items-center">
                  <div className="flex-shrink-0 bg-stone-100 rounded-lg p-3">
                    <svg className="h-6 w-6 text-stone-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                    </svg>
                  </div>
                  <div className="ml-4">
                    <p className="text-sm font-medium text-stone-500">Total Assessments</p>
                    <p className="text-2xl font-semibold text-stone-900">{assessmentStats.totalAssessments || 0}</p>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-lg border border-stone-200 p-6">
                <div className="flex items-center">
                  <div className="flex-shrink-0 bg-stone-100 rounded-lg p-3">
                    <svg className="h-6 w-6 text-stone-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div className="ml-4">
                    <p className="text-sm font-medium text-stone-500">GO</p>
                    <p className="text-2xl font-semibold text-stone-900">{assessmentStats.goCount || 0}</p>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-lg border border-stone-200 p-6">
                <div className="flex items-center">
                  <div className="flex-shrink-0 bg-stone-100 rounded-lg p-3">
                    <svg className="h-6 w-6 text-stone-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                  </div>
                  <div className="ml-4">
                    <p className="text-sm font-medium text-stone-500">REVIEW</p>
                    <p className="text-2xl font-semibold text-stone-900">{assessmentStats.reviewCount || 0}</p>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-lg border border-stone-200 p-6">
                <div className="flex items-center">
                  <div className="flex-shrink-0 bg-stone-100 rounded-lg p-3">
                    <svg className="h-6 w-6 text-stone-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div className="ml-4">
                    <p className="text-sm font-medium text-stone-500">NO GO</p>
                    <p className="text-2xl font-semibold text-stone-900">{assessmentStats.noGoCount || 0}</p>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {/* Recent Assessments */}
        {recentAssessments.length > 0 && (
          <div className="bg-white rounded-lg border border-stone-200 mb-8">
            <div className="px-6 py-4 border-b border-stone-100">
              <h2 className="text-base font-semibold text-stone-900">Recent Margin Assessments</h2>
              <p className="text-xs text-stone-500 mt-0.5">Latest opportunity assessments and profit analysis</p>
            </div>
            <div className="p-6">
              <div className="space-y-3">
                {recentAssessments.map((assessment) => (
                  <Link
                    key={assessment.id}
                    href={`/opportunities/${assessment.opportunityId}`}
                    className="block border border-stone-200 rounded-lg p-4 hover:border-stone-400 hover:shadow-sm transition-all"
                  >
                    <div className="flex justify-between items-start mb-3">
                      <div className="flex-1">
                        <h3 className="font-medium text-stone-900 text-sm">
                          {assessment.opportunityTitle}
                        </h3>
                        <p className="text-xs text-stone-400 mt-0.5">
                          {assessment.solicitationNumber}
                        </p>
                      </div>
                      <span className={`px-2.5 py-1 text-xs font-semibold rounded-full ${
                        assessment.recommendation === 'GO' ? 'bg-stone-800 text-white' :
                        assessment.recommendation === 'REVIEW' ? 'bg-stone-200 text-stone-700' :
                        'bg-stone-100 text-stone-500'
                      }`}>
                        {assessment.recommendation?.replace('_', ' ') || 'N/A'}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                      <div>
                        <p className="text-xs text-stone-400">Contract Value</p>
                        <p className="font-semibold text-stone-900 text-sm">
                          ${(assessment.estimatedValue || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-stone-400">Profit Margin</p>
                        <p className="font-semibold text-stone-900 text-sm">
                          {(assessment.profitMarginPercent || 0).toFixed(1)}%
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-stone-400">Profit ($)</p>
                        <p className="font-semibold text-stone-900 text-sm">
                          ${(assessment.profitMarginDollar || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 pt-3 border-t border-stone-100 flex justify-between items-center">
                      <div className="flex gap-2 text-xs">
                        <span className="px-2 py-0.5 rounded bg-stone-100 text-stone-600">
                          Strategic: {assessment.strategicValue || 'N/A'}
                        </span>
                        <span className="px-2 py-0.5 rounded bg-stone-100 text-stone-600">
                          Risk: {assessment.riskLevel || 'N/A'}
                        </span>
                      </div>
                      <p className="text-xs text-stone-400">
                        Assessed by {assessment.assessedBy}
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Pending Approvals Section */}
        {pendingSOWs.length > 0 && (
          <div className="bg-white rounded-lg border border-stone-200 mb-8">
            <div className="px-6 py-4 border-b border-stone-100">
              <h2 className="text-base font-semibold text-stone-900">SOWs Pending Your Approval</h2>
            </div>
            <div className="p-6">
              <div className="space-y-3">
                {pendingSOWs.map((sow) => (
                  <Link
                    key={sow.id}
                    href={`/sows/${sow.id}`}
                    className="block border border-stone-200 bg-stone-50 rounded-lg p-4 hover:border-stone-400 hover:shadow-sm transition-all"
                  >
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <h3 className="font-medium text-stone-900 text-sm">
                          {sow.opportunity?.title || 'Untitled'}
                        </h3>
                        <p className="text-xs text-stone-500 mt-0.5">
                          {sow.opportunity?.solicitationNumber || 'N/A'} · Version {sow.version}
                        </p>
                        {sow.generatedBy && (
                          <p className="text-xs text-stone-400 mt-0.5">
                            Generated by {sow.generatedBy.name || 'Unknown'}
                          </p>
                        )}
                      </div>
                      <span className="px-2.5 py-1 bg-stone-200 text-stone-700 text-xs font-semibold rounded-full">
                        Pending Review
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Opportunities in Progress */}
        {opportunitiesInProgress.length > 0 && (
          <div className="bg-white rounded-lg border border-stone-200 mb-8">
            <div className="px-6 py-4 border-b border-stone-100">
              <h2 className="text-base font-semibold text-stone-900">Opportunities in Progress</h2>
              <p className="text-xs text-stone-500 mt-0.5">Track your active opportunities through the pipeline</p>
            </div>
            <div className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {opportunitiesInProgress.map((opp) => (
                  <Link key={opp.id} href={`/opportunities/${opp.id}`} className="block border border-stone-200 rounded-lg p-4 hover:border-stone-400 hover:shadow-sm transition-all">
                    <div className="mb-3">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-medium text-stone-900 text-sm line-clamp-2">
                          {opp.title}
                        </h3>
                        {opp.assessment && (
                          <span className={`px-2 py-0.5 text-xs font-semibold rounded-full flex-shrink-0 ${
                            opp.assessment.recommendation === 'GO' ? 'bg-stone-800 text-white' :
                            opp.assessment.recommendation === 'REVIEW' ? 'bg-stone-200 text-stone-700' :
                            opp.assessment.recommendation === 'NO_GO' ? 'bg-stone-100 text-stone-500' :
                            'bg-stone-100 text-stone-500'
                          }`}>
                            {opp.assessment.recommendation?.replace('_', ' ') || 'N/A'}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-stone-400">
                        {opp.solicitationNumber}
                      </p>

                      {opp.assessment && (
                        <div className="mt-2 pt-2 border-t border-stone-100">
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div>
                              <p className="text-stone-400">Value</p>
                              <p className="font-semibold text-stone-900">
                                ${(opp.assessment.estimatedValue || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                              </p>
                            </div>
                            <div>
                              <p className="text-stone-400">Margin</p>
                              <p className="font-semibold text-stone-800">
                                {(opp.assessment.profitMarginPercent || 0).toFixed(1)}%
                              </p>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    <WIPProgressTracker
                      opportunityId={opp.id}
                      progress={opp.progress}
                      compact={true}
                    />
                  </Link>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Recent Opportunities */}
        <div className="bg-white rounded-lg border border-stone-200">
          <div className="px-6 py-4 border-b border-stone-100">
            <h2 className="text-base font-semibold text-stone-900">Recent Opportunities</h2>
          </div>
          <div className="p-6">
            {recentOpportunities.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-stone-500">No opportunities yet</p>
                <p className="text-stone-400 text-sm mt-1">
                  Opportunities will appear here once they are fetched from SAM.gov
                </p>
                {session?.user?.role === 'ADMIN' && (
                  <div className="mt-4 space-y-2">
                    <button
                      onClick={handleFetchFromSAM}
                      disabled={fetchingSAM}
                      className="px-4 py-2 text-sm font-medium text-white bg-stone-800 rounded-lg hover:bg-stone-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {fetchingSAM ? 'Fetching from SAM.gov...' : 'Fetch Opportunities'}
                    </button>
                    {fetchError && (
                      <p className="text-xs text-red-600">{fetchError}</p>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {recentOpportunities.map((opp) => (
                  <Link
                    key={opp.id}
                    href={`/opportunities/${opp.id}`}
                    className="block border border-stone-200 rounded-lg p-4 hover:border-stone-400 hover:shadow-sm transition-all"
                  >
                    <div className="flex justify-between items-start mb-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="font-medium text-stone-900 text-sm">
                            {opp.title}
                          </h3>
                          {opp.assessment && (
                            <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${
                              opp.assessment.recommendation === 'GO' ? 'bg-stone-800 text-white' :
                              opp.assessment.recommendation === 'REVIEW' ? 'bg-stone-200 text-stone-700' :
                              opp.assessment.recommendation === 'NO_GO' ? 'bg-stone-100 text-stone-500' :
                              'bg-stone-100 text-stone-500'
                            }`}>
                              {opp.assessment.recommendation?.replace('_', ' ') || 'NOT ASSESSED'}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-stone-400 mt-0.5">
                          {opp.solicitationNumber} · {opp.agency}
                        </p>
                      </div>
                      {opp.responseDeadline && (
                        <span className="text-xs text-stone-500 flex items-center gap-1 flex-shrink-0">
                          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          {Math.ceil((new Date(opp.responseDeadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24))}d
                        </span>
                      )}
                    </div>

                    {opp.assessment ? (
                      <div className="grid grid-cols-4 gap-4 mt-3 pt-3 border-t border-stone-100">
                        <div>
                          <p className="text-xs text-stone-400">Contract Value</p>
                          <p className="font-semibold text-stone-900 text-sm">
                            ${(opp.assessment.estimatedValue || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-stone-400">Est. Cost</p>
                          <p className="font-semibold text-stone-900 text-sm">
                            ${(opp.assessment.estimatedCost || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-stone-400">Profit Margin</p>
                          <p className="font-semibold text-stone-800 text-sm">
                            {(opp.assessment.profitMarginPercent || 0).toFixed(1)}% · ${(opp.assessment.profitMarginDollar || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-stone-400">Risk / Strategic</p>
                          <div className="flex gap-1">
                            <span className="text-xs px-1.5 py-0.5 rounded bg-stone-100 text-stone-600 font-medium">
                              {opp.assessment.riskLevel || '—'}
                            </span>
                            <span className="text-xs px-1.5 py-0.5 rounded bg-stone-100 text-stone-600 font-medium">
                              {opp.assessment.strategicValue || '—'}
                            </span>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-3 pt-3 border-t border-stone-100">
                        <p className="text-xs text-stone-400">No assessment yet — click to auto-calculate margins</p>
                      </div>
                    )}
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Quick Actions */}
        <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-6">
          <Link
            href="/opportunities"
            className="bg-white rounded-lg border border-stone-200 p-6 hover:border-stone-400 hover:shadow-sm transition-all"
          >
            <h3 className="font-semibold text-stone-900 mb-1.5">Browse Opportunities</h3>
            <p className="text-sm text-stone-500">
              Search and filter government contracting opportunities
            </p>
          </Link>

          <Link
            href="/sows"
            className="bg-white rounded-lg border border-stone-200 p-6 hover:border-stone-400 hover:shadow-sm transition-all"
          >
            <h3 className="font-semibold text-stone-900 mb-1.5">Manage SOWs</h3>
            <p className="text-sm text-stone-500">
              Generate, approve, and track Statements of Work
            </p>
          </Link>

          <div className="bg-white rounded-lg border border-stone-200 p-6 opacity-50 cursor-not-allowed">
            <h3 className="font-semibold text-stone-900 mb-1.5">Find Subcontractors</h3>
            <p className="text-sm text-stone-500">
              Discover qualified subcontractors via Google Places (Coming soon)
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
