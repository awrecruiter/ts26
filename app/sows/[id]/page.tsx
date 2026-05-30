"use client"

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { format } from 'date-fns'
import SOWStatusBadge from '@/components/sows/SOWStatusBadge'
import SOWViewer from '@/components/sows/SOWViewer'
import SOWDocumentEditor from '@/components/sows/SOWDocumentEditor'

export default function SOWDetailPage() {
  const params = useParams()
  const router = useRouter()
  const [sow, setSOW] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [isEditing, setIsEditing] = useState(false)

  const [approving, setApproving] = useState(false)
  const [sending, setSending] = useState(false)
  const [creatingVersion, setCreatingVersion] = useState(false)

  const [approvalAction, setApprovalAction] = useState<'APPROVED' | 'REJECTED' | 'CHANGES_REQUESTED'>('APPROVED')
  const [approvalComments, setApprovalComments] = useState('')
  const [sendEmail, setSendEmail] = useState('')
  const [sendMessage, setSendMessage] = useState('')
  const [versionSummary, setVersionSummary] = useState('')
  const [regenerate, setRegenerate] = useState(false)

  useEffect(() => {
    fetchSOW()
  }, [params.id])

  const fetchSOW = async () => {
    try {
      setLoading(true)
      const response = await fetch(`/api/sows/${params.id}`)

      if (!response.ok) {
        throw new Error('Failed to fetch SOW')
      }

      const data = await response.json()
      setSOW(data.sow)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  const handleSaveContent = async (updatedContent: any) => {
    if (!sow) return

    try {
      const response = await fetch(`/api/sows/${sow.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: updatedContent }),
      })

      if (!response.ok) {
        throw new Error('Failed to save SOW content')
      }

      alert('SOW content saved successfully!')
      setIsEditing(false)
      await fetchSOW()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to save')
      throw err
    }
  }

  const handleApproval = async () => {
    if (!sow) return

    setApproving(true)
    try {
      const response = await fetch(`/api/sows/${sow.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: approvalAction,
          comments: approvalComments || undefined,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Approval failed')
      }

      alert(`SOW ${approvalAction.toLowerCase()} successfully!`)
      setApprovalComments('')
      await fetchSOW()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Approval failed')
    } finally {
      setApproving(false)
    }
  }

  const handleSend = async () => {
    if (!sow) return

    if (!sendEmail) {
      alert('Email is required')
      return
    }

    setSending(true)
    try {
      const response = await fetch(`/api/sows/${sow.id}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: sendEmail,
          message: sendMessage || undefined,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Send failed')
      }

      alert(`SOW sent successfully to ${sendEmail}!`)
      setSendEmail('')
      setSendMessage('')
      await fetchSOW()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Send failed')
    } finally {
      setSending(false)
    }
  }

  const handleCreateVersion = async () => {
    if (!sow) return

    if (!versionSummary) {
      alert('Version summary is required')
      return
    }

    setCreatingVersion(true)
    try {
      const response = await fetch(`/api/sows/${sow.id}/versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          changesSummary: versionSummary,
          regenerate,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Version creation failed')
      }

      const data = await response.json()
      alert('New version created successfully!')
      router.push(`/sows/${data.sow.id}`)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Version creation failed')
    } finally {
      setCreatingVersion(false)
    }
  }

  const handleDownload = () => {
    if (sow?.fileUrl) {
      window.open(sow.fileUrl, '_blank')
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-stone-600"></div>
          <p className="mt-4 text-stone-600">Loading SOW...</p>
        </div>
      </div>
    )
  }

  if (error || !sow) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-stone-600 text-lg">{error || 'SOW not found'}</p>
          <button
            onClick={() => router.push('/sows')}
            className="mt-4 px-4 py-2 bg-stone-800 text-white rounded-md hover:bg-stone-700"
          >
            Back to SOWs
          </button>
        </div>
      </div>
    )
  }

  const canApprove = sow.status === 'PENDING_REVIEW' || sow.status === 'DRAFT'
  const canSend = sow.status === 'APPROVED'
  const canCreateVersion = sow.status !== 'SUPERSEDED'

  return (
    <div className="min-h-screen bg-stone-50">
      {/* Header */}
      <div className="bg-white border-b border-stone-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <button
            onClick={() => router.push('/sows')}
            className="text-stone-600 hover:text-stone-900 mb-4 flex items-center"
          >
            ← Back to SOWs
          </button>
          <div className="flex justify-between items-start">
            <div>
              <h1 className="text-3xl font-bold text-stone-900">{sow.opportunity.title}</h1>
              <p className="mt-2 text-sm text-stone-500">
                {sow.opportunity.solicitationNumber} • Version {sow.version}
              </p>
            </div>
            <SOWStatusBadge status={sow.status} />
          </div>
        </div>
      </div>

      {/* Content */}
      <div className={isEditing ? '' : 'max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8'}>
        <div className={isEditing ? '' : 'grid grid-cols-1 lg:grid-cols-3 gap-8'}>
          {/* Main Content */}
          <div className={isEditing ? '' : 'lg:col-span-2 space-y-6'}>
            {/* File Info */}
            {!isEditing && (
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-xl font-semibold text-stone-900 mb-4">Document</h2>
              <div className="space-y-3">
                <p className="text-sm text-stone-600">
                  <span className="font-medium">File:</span> {sow.fileName || 'N/A'}
                </p>
                <p className="text-sm text-stone-600">
                  <span className="font-medium">Size:</span> {sow.fileSize ? `${(sow.fileSize / 1024).toFixed(2)} KB` : 'N/A'}
                </p>
                <p className="text-sm text-stone-600">
                  <span className="font-medium">Generated:</span> {format(new Date(sow.generatedAt), 'PPpp')}
                </p>
                {sow.generatedBy && (
                  <p className="text-sm text-stone-600">
                    <span className="font-medium">Generated by:</span> {sow.generatedBy.name || sow.generatedBy.email}
                  </p>
                )}
                {sow.fileUrl && (
                  <button
                    onClick={handleDownload}
                    className="mt-4 w-full px-4 py-2 bg-stone-800 text-white rounded-md hover:bg-stone-700"
                  >
                    📄 Download PDF
                  </button>
                )}
              </div>
            </div>
            )}

            {/* SOW Content Viewer/Editor */}
            {sow.content && (
              <div className={isEditing ? '' : 'bg-white rounded-lg shadow'}>
                {!isEditing && (
                  <div className="p-6 border-b border-stone-200 flex justify-between items-center">
                    <h2 className="text-xl font-semibold text-stone-900">SOW Content</h2>
                    {sow.status === 'DRAFT' && (
                      <button
                        onClick={() => setIsEditing(true)}
                        className="px-4 py-2 text-sm bg-stone-800 text-white rounded-md hover:bg-stone-700"
                      >
                        ✏️ Edit Content
                      </button>
                    )}
                  </div>
                )}
                <div className={isEditing ? '' : 'p-6'}>
                  {isEditing ? (
                    <SOWDocumentEditor
                      content={sow.content}
                      onSave={handleSaveContent}
                      onCancel={() => setIsEditing(false)}
                    />
                  ) : (
                    <SOWViewer content={sow.content} opportunityId={sow.opportunityId} />
                  )}
                </div>
              </div>
            )}

            {!isEditing && (
            <>
            {/* Opportunity Details */}
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-xl font-semibold text-stone-900 mb-4">Opportunity Details</h2>
              <div className="space-y-3">
                <p className="text-sm text-stone-600">
                  <span className="font-medium">Agency:</span> {sow.opportunity.agency || 'N/A'}
                </p>
                <p className="text-sm text-stone-600">
                  <span className="font-medium">NAICS Code:</span> {sow.opportunity.naicsCode || 'N/A'}
                </p>
                {sow.opportunity.responseDeadline && (
                  <p className="text-sm text-stone-600">
                    <span className="font-medium">Deadline:</span> {format(new Date(sow.opportunity.responseDeadline), 'PPP')}
                  </p>
                )}
                <button
                  onClick={() => router.push(`/opportunities/${sow.opportunityId}`)}
                  className="mt-4 text-stone-600 hover:text-stone-900 text-sm"
                >
                  View Full Opportunity →
                </button>
              </div>
            </div>

            {/* Approval Section */}
            {canApprove && (
              <div className="bg-white rounded-lg shadow p-6">
                <h2 className="text-xl font-semibold text-stone-900 mb-4">Approval</h2>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-stone-700 mb-2">
                      Action
                    </label>
                    <select
                      value={approvalAction}
                      onChange={(e) => setApprovalAction(e.target.value as any)}
                      className="w-full px-4 py-2 border border-stone-300 rounded-md focus:outline-none focus:ring-2 focus:ring-stone-400"
                    >
                      <option value="APPROVED">Approve</option>
                      <option value="REJECTED">Reject</option>
                      <option value="CHANGES_REQUESTED">Request Changes</option>
                      {sow.status === 'DRAFT' && <option value="SUBMITTED">Submit for Review</option>}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-stone-700 mb-2">
                      Comments (optional)
                    </label>
                    <textarea
                      value={approvalComments}
                      onChange={(e) => setApprovalComments(e.target.value)}
                      rows={3}
                      className="w-full px-4 py-2 border border-stone-300 rounded-md focus:outline-none focus:ring-2 focus:ring-stone-400"
                      placeholder="Add comments about your decision..."
                    />
                  </div>
                  <button
                    onClick={handleApproval}
                    disabled={approving}
                    className="w-full px-4 py-2 bg-stone-800 text-white rounded-md hover:bg-stone-700 disabled:opacity-50"
                  >
                    {approving ? 'Processing...' : 'Submit'}
                  </button>
                </div>
              </div>
            )}

            {/* Approval History */}
            {sow.approvals && sow.approvals.length > 0 && (
              <div className="bg-white rounded-lg shadow p-6">
                <h2 className="text-xl font-semibold text-stone-900 mb-4">Approval History</h2>
                <div className="space-y-4">
                  {sow.approvals.map((approval: any) => (
                    <div key={approval.id} className="border-l-4 border-stone-400 pl-4 py-2">
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="font-medium text-stone-900">{approval.action}</p>
                          <p className="text-sm text-stone-600">
                            by {approval.approver.name || approval.approver.email}
                          </p>
                          {approval.comments && (
                            <p className="text-sm text-stone-700 mt-2">{approval.comments}</p>
                          )}
                        </div>
                        <span className="text-xs text-stone-500">
                          {format(new Date(approval.createdAt), 'PPp')}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Activity Timeline */}
            {sow.activities && sow.activities.length > 0 && (
              <div className="bg-white rounded-lg shadow p-6">
                <h2 className="text-xl font-semibold text-stone-900 mb-4">Activity Timeline</h2>
                <div className="space-y-4">
                  {sow.activities.slice(0, 10).map((activity: any) => (
                    <div key={activity.id} className="flex gap-4">
                      <div className="flex-shrink-0 w-2 h-2 mt-2 bg-stone-500 rounded-full"></div>
                      <div className="flex-1">
                        <p className="text-sm text-stone-900">{activity.description}</p>
                        <p className="text-xs text-stone-500 mt-1">
                          {format(new Date(activity.createdAt), 'PPp')}
                          {activity.user && ` • ${activity.user.name || activity.user.email}`}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            </>
            )}
          </div>

          {/* Sidebar */}
          {!isEditing && (
          <div className="space-y-6">
            {/* Key Details */}
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-lg font-semibold text-stone-900 mb-4">Details</h2>
              <div className="space-y-3">
                {sow.currentApprover && (
                  <div>
                    <p className="text-sm text-stone-500">Current Approver</p>
                    <p className="font-medium text-stone-900">
                      {sow.currentApprover.name || sow.currentApprover.email}
                    </p>
                  </div>
                )}
                {sow.sentToEmail && (
                  <div>
                    <p className="text-sm text-stone-500">Sent To</p>
                    <p className="font-medium text-stone-900">{sow.sentToEmail}</p>
                    {sow.sentAt && (
                      <p className="text-xs text-stone-500 mt-1">
                        {format(new Date(sow.sentAt), 'PPp')}
                      </p>
                    )}
                  </div>
                )}
                {sow.viewedAt && (
                  <div>
                    <p className="text-sm text-stone-500">Viewed</p>
                    <p className="font-medium text-stone-900">
                      {format(new Date(sow.viewedAt), 'PPp')}
                    </p>
                  </div>
                )}
                {sow.acceptedAt && (
                  <div>
                    <p className="text-sm text-stone-500">Accepted</p>
                    <p className="font-medium text-stone-900">
                      {format(new Date(sow.acceptedAt), 'PPp')}
                    </p>
                  </div>
                )}
                {sow.notes && (
                  <div>
                    <p className="text-sm text-stone-500">Notes</p>
                    <p className="text-sm text-stone-900 mt-1">{sow.notes}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Send to Subcontractor */}
            {canSend && (
              <div className="bg-white rounded-lg shadow p-6">
                <h2 className="text-lg font-semibold text-stone-900 mb-4">Send to Subcontractor</h2>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-stone-700 mb-2">
                      Email *
                    </label>
                    <input
                      type="email"
                      value={sendEmail}
                      onChange={(e) => setSendEmail(e.target.value)}
                      className="w-full px-4 py-2 border border-stone-300 rounded-md focus:outline-none focus:ring-2 focus:ring-stone-400"
                      placeholder="subcontractor@example.com"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-stone-700 mb-2">
                      Message (optional)
                    </label>
                    <textarea
                      value={sendMessage}
                      onChange={(e) => setSendMessage(e.target.value)}
                      rows={3}
                      className="w-full px-4 py-2 border border-stone-300 rounded-md focus:outline-none focus:ring-2 focus:ring-stone-400"
                      placeholder="Include a message..."
                    />
                  </div>
                  <button
                    onClick={handleSend}
                    disabled={sending || !sendEmail}
                    className="w-full px-4 py-2 bg-stone-800 text-white rounded-md hover:bg-stone-700 disabled:opacity-50"
                  >
                    {sending ? 'Sending...' : 'Send SOW'}
                  </button>
                </div>
              </div>
            )}

            {/* Create New Version */}
            {canCreateVersion && (
              <div className="bg-white rounded-lg shadow p-6">
                <h2 className="text-lg font-semibold text-stone-900 mb-4">Create New Version</h2>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-stone-700 mb-2">
                      Changes Summary *
                    </label>
                    <textarea
                      value={versionSummary}
                      onChange={(e) => setVersionSummary(e.target.value)}
                      rows={3}
                      className="w-full px-4 py-2 border border-stone-300 rounded-md focus:outline-none focus:ring-2 focus:ring-stone-400"
                      placeholder="Describe what changed in this version..."
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="regenerate"
                      checked={regenerate}
                      onChange={(e) => setRegenerate(e.target.checked)}
                      className="rounded border-stone-300"
                    />
                    <label htmlFor="regenerate" className="text-sm text-stone-700">
                      Regenerate PDF from opportunity data
                    </label>
                  </div>
                  <button
                    onClick={handleCreateVersion}
                    disabled={creatingVersion || !versionSummary}
                    className="w-full px-4 py-2 bg-stone-800 text-white rounded-md hover:bg-stone-700 disabled:opacity-50"
                  >
                    {creatingVersion ? 'Creating...' : 'Create Version'}
                  </button>
                </div>
              </div>
            )}

            {/* Version History */}
            {sow.versions && sow.versions.length > 0 && (
              <div className="bg-white rounded-lg shadow p-6">
                <h2 className="text-lg font-semibold text-stone-900 mb-4">Version History</h2>
                <div className="space-y-3">
                  {sow.versions.map((version: any) => (
                    <div key={version.id} className="border-b border-stone-200 pb-3 last:border-0">
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="font-medium text-stone-900">Version {version.versionNumber}</p>
                          <p className="text-xs text-stone-500 mt-1">
                            {format(new Date(version.createdAt), 'PPp')}
                          </p>
                          <p className="text-sm text-stone-700 mt-1">{version.changesSummary}</p>
                        </div>
                        <a
                          href={version.fileUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-stone-600 hover:text-stone-900 text-sm"
                        >
                          Download
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          )}
        </div>
      </div>
    </div>
  )
}
