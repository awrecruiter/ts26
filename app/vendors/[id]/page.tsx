"use client"

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'

interface Vendor {
  id: string
  name: string
  email: string | null
  phone: string | null
  website: string | null
  address: string | null
  type: 'SUBCONTRACTOR' | 'SUPPLIER' | 'PARTNER' | 'CONSULTANT'
  status: 'PROSPECT' | 'ACTIVE' | 'INACTIVE' | 'BLACKLISTED'
  naicsCodes: string[]
  certifications: string[]
  notes: string | null
  lastContacted: string | null
  createdAt: string
  updatedAt: string
  communications: Communication[]
}

interface Communication {
  id: string
  type: 'EMAIL' | 'PHONE' | 'MEETING' | 'NOTE'
  subject: string
  content: string
  sentAt: string | null
  createdAt: string
}

function CommunicationTypeBadge({ type }: { type: Communication['type'] }) {
  const config: Record<Communication['type'], { className: string; icon: string }> = {
    EMAIL: { className: 'bg-stone-100 text-stone-700', icon: '📧' },
    PHONE: { className: 'bg-stone-100 text-stone-700', icon: '📞' },
    MEETING: { className: 'bg-stone-200 text-stone-700', icon: '👥' },
    NOTE: { className: 'bg-stone-100 text-stone-700', icon: '📝' },
  }
  const { className, icon } = config[type]
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full ${className}`}>
      {icon} {type.charAt(0) + type.slice(1).toLowerCase()}
    </span>
  )
}

export default function VendorDetailPage() {
  const params = useParams()
  const router = useRouter()
  const [vendor, setVendor] = useState<Vendor | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showLogModal, setShowLogModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)

  useEffect(() => {
    fetchVendor()
  }, [params.id])

  const fetchVendor = async () => {
    try {
      setLoading(true)
      const response = await fetch(`/api/vendors/${params.id}`)
      if (!response.ok) throw new Error('Failed to fetch vendor')
      const data = await response.json()
      setVendor(data.vendor)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this vendor?')) return

    try {
      const response = await fetch(`/api/vendors/${params.id}`, { method: 'DELETE' })
      if (!response.ok) throw new Error('Failed to delete vendor')
      router.push('/vendors')
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete vendor')
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-stone-600"></div>
          <p className="mt-4 text-stone-600">Loading vendor details...</p>
        </div>
      </div>
    )
  }

  if (error || !vendor) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-stone-600 text-lg">{error || 'Vendor not found'}</p>
          <button onClick={() => router.back()} className="mt-4 px-4 py-2 bg-stone-800 text-white rounded-md hover:bg-stone-700">
            Go Back
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-stone-50">
      {/* Header */}
      <div className="bg-white border-b border-stone-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <Link href="/vendors" className="text-stone-600 hover:text-stone-900 text-sm mb-4 inline-block">
            ← Back to Vendors
          </Link>
          <div className="flex justify-between items-start">
            <div>
              <h1 className="text-3xl font-bold text-stone-900">{vendor.name}</h1>
              <div className="flex gap-2 mt-2">
                <span className="px-2 py-1 text-xs font-medium rounded-full bg-stone-100 text-stone-700">
                  {vendor.type.charAt(0) + vendor.type.slice(1).toLowerCase()}
                </span>
                <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                  vendor.status === 'ACTIVE' ? 'bg-stone-100 text-stone-700' :
                  vendor.status === 'PROSPECT' ? 'bg-stone-200 text-stone-700' :
                  vendor.status === 'INACTIVE' ? 'bg-stone-100 text-stone-600' :
                  'bg-stone-100 text-stone-500'
                }`}>
                  {vendor.status.charAt(0) + vendor.status.slice(1).toLowerCase()}
                </span>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setShowLogModal(true)}
                className="px-4 py-2 bg-stone-800 text-white rounded-md hover:bg-stone-700"
              >
                Log Communication
              </button>
              <button
                onClick={() => setShowEditModal(true)}
                className="px-4 py-2 border border-stone-300 text-stone-700 rounded-md hover:bg-stone-50"
              >
                Edit
              </button>
              <button
                onClick={handleDelete}
                className="px-4 py-2 border border-stone-300 text-stone-600 rounded-md hover:bg-stone-50"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left Column - Details */}
          <div className="lg:col-span-1 space-y-6">
            {/* Contact Information */}
            <div className="bg-white rounded-lg shadow-sm p-6">
              <h2 className="text-lg font-semibold text-stone-900 mb-4">Contact Information</h2>
              <div className="space-y-3">
                {vendor.email && (
                  <div>
                    <p className="text-sm text-stone-500">Email</p>
                    <a href={`mailto:${vendor.email}`} className="text-stone-700 hover:underline">
                      {vendor.email}
                    </a>
                  </div>
                )}
                {vendor.phone && (
                  <div>
                    <p className="text-sm text-stone-500">Phone</p>
                    <a href={`tel:${vendor.phone}`} className="text-stone-700 hover:underline">
                      {vendor.phone}
                    </a>
                  </div>
                )}
                {vendor.website && (
                  <div>
                    <p className="text-sm text-stone-500">Website</p>
                    <a href={vendor.website} target="_blank" rel="noopener noreferrer" className="text-stone-700 hover:underline">
                      {vendor.website}
                    </a>
                  </div>
                )}
                {vendor.address && (
                  <div>
                    <p className="text-sm text-stone-500">Address</p>
                    <p className="text-stone-900">{vendor.address}</p>
                  </div>
                )}
              </div>
            </div>

            {/* NAICS Codes */}
            {vendor.naicsCodes.length > 0 && (
              <div className="bg-white rounded-lg shadow-sm p-6">
                <h2 className="text-lg font-semibold text-stone-900 mb-4">NAICS Codes</h2>
                <div className="flex flex-wrap gap-2">
                  {vendor.naicsCodes.map((code) => (
                    <span key={code} className="px-2 py-1 bg-stone-100 text-stone-700 rounded text-sm">
                      {code}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Certifications */}
            {vendor.certifications.length > 0 && (
              <div className="bg-white rounded-lg shadow-sm p-6">
                <h2 className="text-lg font-semibold text-stone-900 mb-4">Certifications</h2>
                <div className="flex flex-wrap gap-2">
                  {vendor.certifications.map((cert) => (
                    <span key={cert} className="px-2 py-1 bg-stone-100 text-stone-700 rounded text-sm">
                      {cert}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Notes */}
            {vendor.notes && (
              <div className="bg-white rounded-lg shadow-sm p-6">
                <h2 className="text-lg font-semibold text-stone-900 mb-4">Notes</h2>
                <p className="text-stone-700 whitespace-pre-wrap">{vendor.notes}</p>
              </div>
            )}
          </div>

          {/* Right Column - Communications */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-lg shadow-sm">
              <div className="px-6 py-4 border-b border-stone-200 flex justify-between items-center">
                <h2 className="text-lg font-semibold text-stone-900">Communication History</h2>
                <span className="text-sm text-stone-500">
                  {vendor.communications.length} record{vendor.communications.length !== 1 ? 's' : ''}
                </span>
              </div>
              {vendor.communications.length > 0 ? (
                <div className="divide-y divide-stone-200">
                  {vendor.communications.map((comm) => (
                    <div key={comm.id} className="px-6 py-4">
                      <div className="flex items-start justify-between">
                        <div className="flex items-start gap-3">
                          <CommunicationTypeBadge type={comm.type} />
                          <div>
                            <h3 className="text-sm font-semibold text-stone-900">{comm.subject}</h3>
                            <p className="text-sm text-stone-600 mt-1 whitespace-pre-wrap">{comm.content}</p>
                          </div>
                        </div>
                        <span className="text-xs text-stone-500">
                          {new Date(comm.sentAt || comm.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="px-6 py-12 text-center text-stone-500">
                  No communications logged yet
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Log Communication Modal */}
      {showLogModal && (
        <LogCommunicationModal
          vendorId={vendor.id}
          onClose={() => setShowLogModal(false)}
          onCreated={() => { setShowLogModal(false); fetchVendor(); }}
        />
      )}

      {/* Edit Vendor Modal */}
      {showEditModal && (
        <EditVendorModal
          vendor={vendor}
          onClose={() => setShowEditModal(false)}
          onUpdated={() => { setShowEditModal(false); fetchVendor(); }}
        />
      )}
    </div>
  )
}

function LogCommunicationModal({
  vendorId,
  onClose,
  onCreated,
}: {
  vendorId: string
  onClose: () => void
  onCreated: () => void
}) {
  const [formData, setFormData] = useState({
    type: 'NOTE',
    subject: '',
    content: '',
  })
  const [saving, setSaving] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      const response = await fetch(`/api/vendors/${vendorId}/communications`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })
      if (!response.ok) throw new Error('Failed to log communication')
      onCreated()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/50">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4">
        <div className="px-6 py-4 border-b border-stone-200">
          <h2 className="text-xl font-semibold text-stone-900">Log Communication</h2>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-stone-700 mb-1">Type</label>
            <select
              value={formData.type}
              onChange={(e) => setFormData({ ...formData, type: e.target.value })}
              className="w-full px-3 py-2 border border-stone-300 rounded-md"
            >
              <option value="EMAIL">Email</option>
              <option value="PHONE">Phone Call</option>
              <option value="MEETING">Meeting</option>
              <option value="NOTE">Note</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-stone-700 mb-1">Subject *</label>
            <input
              type="text"
              required
              value={formData.subject}
              onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
              className="w-full px-3 py-2 border border-stone-300 rounded-md"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-stone-700 mb-1">Content *</label>
            <textarea
              rows={4}
              required
              value={formData.content}
              onChange={(e) => setFormData({ ...formData, content: e.target.value })}
              className="w-full px-3 py-2 border border-stone-300 rounded-md"
            />
          </div>
          <div className="flex gap-3 pt-4">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border border-stone-300 rounded-md text-stone-700 hover:bg-stone-50">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="flex-1 px-4 py-2 bg-stone-800 text-white rounded-md hover:bg-stone-700 disabled:opacity-50">
              {saving ? 'Saving...' : 'Log Communication'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function EditVendorModal({
  vendor,
  onClose,
  onUpdated,
}: {
  vendor: Vendor
  onClose: () => void
  onUpdated: () => void
}) {
  const [formData, setFormData] = useState({
    name: vendor.name,
    email: vendor.email || '',
    phone: vendor.phone || '',
    website: vendor.website || '',
    address: vendor.address || '',
    type: vendor.type,
    status: vendor.status,
    naicsCodes: vendor.naicsCodes.join(', '),
    notes: vendor.notes || '',
  })
  const [saving, setSaving] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      const response = await fetch(`/api/vendors/${vendor.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          naicsCodes: formData.naicsCodes.split(',').map((c) => c.trim()).filter(Boolean),
        }),
      })
      if (!response.ok) throw new Error('Failed to update vendor')
      onUpdated()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/50">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-stone-200">
          <h2 className="text-xl font-semibold text-stone-900">Edit Vendor</h2>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-stone-700 mb-1">Name *</label>
            <input
              type="text"
              required
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-3 py-2 border border-stone-300 rounded-md"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">Email</label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className="w-full px-3 py-2 border border-stone-300 rounded-md"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">Phone</label>
              <input
                type="tel"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                className="w-full px-3 py-2 border border-stone-300 rounded-md"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">Type</label>
              <select
                value={formData.type}
                onChange={(e) => setFormData({ ...formData, type: e.target.value as any })}
                className="w-full px-3 py-2 border border-stone-300 rounded-md"
              >
                <option value="SUBCONTRACTOR">Subcontractor</option>
                <option value="SUPPLIER">Supplier</option>
                <option value="PARTNER">Partner</option>
                <option value="CONSULTANT">Consultant</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">Status</label>
              <select
                value={formData.status}
                onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
                className="w-full px-3 py-2 border border-stone-300 rounded-md"
              >
                <option value="PROSPECT">Prospect</option>
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
                <option value="BLACKLISTED">Blacklisted</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-stone-700 mb-1">NAICS Codes (comma separated)</label>
            <input
              type="text"
              value={formData.naicsCodes}
              onChange={(e) => setFormData({ ...formData, naicsCodes: e.target.value })}
              className="w-full px-3 py-2 border border-stone-300 rounded-md"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-stone-700 mb-1">Notes</label>
            <textarea
              rows={3}
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              className="w-full px-3 py-2 border border-stone-300 rounded-md"
            />
          </div>
          <div className="flex gap-3 pt-4">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border border-stone-300 rounded-md text-stone-700 hover:bg-stone-50">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="flex-1 px-4 py-2 bg-stone-800 text-white rounded-md hover:bg-stone-700 disabled:opacity-50">
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
