"use client"

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import Link from 'next/link'

interface Vendor {
  id: string
  name: string
  email: string | null
  phone: string | null
  website: string | null
  type: 'SUBCONTRACTOR' | 'SUPPLIER' | 'PARTNER' | 'CONSULTANT'
  status: 'PROSPECT' | 'ACTIVE' | 'INACTIVE' | 'BLACKLISTED'
  naicsCodes: string[]
  certifications: string[]
  lastContacted: string | null
  createdAt: string
  _count?: {
    communications: number
  }
}

function VendorTypeBadge({ type }: { type: Vendor['type'] }) {
  const styles: Record<Vendor['type'], string> = {
    SUBCONTRACTOR: 'bg-stone-100 text-stone-700',
    SUPPLIER: 'bg-stone-200 text-stone-700',
    PARTNER: 'bg-stone-100 text-stone-700',
    CONSULTANT: 'bg-stone-100 text-stone-700',
  }
  return (
    <span className={`px-2 py-1 text-xs font-medium rounded-full ${styles[type]}`}>
      {type.charAt(0) + type.slice(1).toLowerCase()}
    </span>
  )
}

function VendorStatusBadge({ status }: { status: Vendor['status'] }) {
  const styles: Record<Vendor['status'], string> = {
    PROSPECT: 'bg-stone-200 text-stone-700',
    ACTIVE: 'bg-stone-100 text-stone-700',
    INACTIVE: 'bg-stone-100 text-stone-600',
    BLACKLISTED: 'bg-stone-100 text-stone-500',
  }
  return (
    <span className={`px-2 py-1 text-xs font-medium rounded-full ${styles[status]}`}>
      {status.charAt(0) + status.slice(1).toLowerCase()}
    </span>
  )
}

function VendorsPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { status: sessionStatus } = useSession()

  const [vendors, setVendors] = useState<Vendor[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showCreateModal, setShowCreateModal] = useState(false)

  const [pagination, setPagination] = useState({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0,
  })

  const [search, setSearch] = useState(searchParams.get('search') || '')
  const [type, setType] = useState(searchParams.get('type') || '')
  const [status, setStatus] = useState(searchParams.get('status') || '')

  useEffect(() => {
    if (sessionStatus === 'unauthenticated') {
      router.push('/login')
    } else if (sessionStatus === 'authenticated') {
      fetchVendors()
    }
  }, [sessionStatus, searchParams])

  const fetchVendors = async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams()
      params.set('page', searchParams.get('page') || '1')
      params.set('limit', '20')
      if (search) params.set('search', search)
      if (type) params.set('type', type)
      if (status) params.set('status', status)

      const response = await fetch(`/api/vendors?${params.toString()}`)
      if (!response.ok) throw new Error('Failed to fetch vendors')
      const data = await response.json()
      setVendors(data.vendors)
      setPagination(data.pagination)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    updateFilters({ search, type, status })
  }

  const updateFilters = (filters: { search?: string; type?: string; status?: string }) => {
    const params = new URLSearchParams()
    if (filters.search) params.set('search', filters.search)
    if (filters.type) params.set('type', filters.type)
    if (filters.status) params.set('status', filters.status)
    params.set('page', '1')
    router.push(`/vendors?${params.toString()}`)
  }

  const handlePageChange = (newPage: number) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set('page', newPage.toString())
    router.push(`/vendors?${params.toString()}`)
  }

  if (sessionStatus === 'loading') {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-stone-600"></div>
          <p className="mt-4 text-stone-500">Loading...</p>
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
              <h1 className="text-3xl font-bold text-stone-900">Vendors</h1>
              <p className="mt-2 text-sm text-stone-600">
                Manage your subcontractors, suppliers, and partners
              </p>
            </div>
            <button
              onClick={() => setShowCreateModal(true)}
              className="px-4 py-2 bg-stone-800 text-white rounded-md hover:bg-stone-700"
            >
              Add Vendor
            </button>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white border-b border-stone-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <form onSubmit={handleSearchSubmit} className="flex flex-wrap gap-4">
            <input
              type="text"
              placeholder="Search by name, email, or phone..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 px-4 py-2 border border-stone-300 rounded-md focus:outline-none focus:ring-2 focus:ring-stone-400"
            />
            <select
              value={type}
              onChange={(e) => { setType(e.target.value); updateFilters({ search, type: e.target.value, status }); }}
              className="px-4 py-2 border border-stone-300 rounded-md focus:outline-none focus:ring-2 focus:ring-stone-400"
            >
              <option value="">All Types</option>
              <option value="SUBCONTRACTOR">Subcontractor</option>
              <option value="SUPPLIER">Supplier</option>
              <option value="PARTNER">Partner</option>
              <option value="CONSULTANT">Consultant</option>
            </select>
            <select
              value={status}
              onChange={(e) => { setStatus(e.target.value); updateFilters({ search, type, status: e.target.value }); }}
              className="px-4 py-2 border border-stone-300 rounded-md focus:outline-none focus:ring-2 focus:ring-stone-400"
            >
              <option value="">All Statuses</option>
              <option value="PROSPECT">Prospect</option>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
              <option value="BLACKLISTED">Blacklisted</option>
            </select>
            <button
              type="submit"
              className="px-6 py-2 bg-stone-800 text-white rounded-md hover:bg-stone-700"
            >
              Search
            </button>
          </form>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {loading && (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-stone-600"></div>
            <p className="mt-4 text-stone-600">Loading vendors...</p>
          </div>
        )}

        {error && (
          <div className="text-center py-12">
            <p className="text-stone-600 text-lg">{error}</p>
            <button onClick={fetchVendors} className="mt-4 px-4 py-2 bg-stone-800 text-white rounded-md hover:bg-stone-700">
              Retry
            </button>
          </div>
        )}

        {!loading && !error && vendors.length === 0 && (
          <div className="text-center py-12">
            <p className="text-stone-600 text-lg">No vendors found</p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="mt-4 px-4 py-2 bg-stone-800 text-white rounded-md hover:bg-stone-700"
            >
              Add Your First Vendor
            </button>
          </div>
        )}

        {!loading && !error && vendors.length > 0 && (
          <>
            <div className="bg-white shadow-sm rounded-lg overflow-hidden">
              <table className="min-w-full divide-y divide-stone-200">
                <thead className="bg-stone-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-stone-500 uppercase tracking-wider">Vendor</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-stone-500 uppercase tracking-wider">Type</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-stone-500 uppercase tracking-wider">Status</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-stone-500 uppercase tracking-wider">Contact</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-stone-500 uppercase tracking-wider">Last Contact</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-stone-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-stone-200">
                  {vendors.map((vendor) => (
                    <tr key={vendor.id} className="hover:bg-stone-50">
                      <td className="px-6 py-4">
                        <div>
                          <Link href={`/vendors/${vendor.id}`} className="text-sm font-medium text-stone-900 hover:text-stone-600">
                            {vendor.name}
                          </Link>
                          {vendor.naicsCodes.length > 0 && (
                            <p className="text-xs text-stone-500 mt-1">
                              NAICS: {vendor.naicsCodes.slice(0, 2).join(', ')}
                              {vendor.naicsCodes.length > 2 && `... +${vendor.naicsCodes.length - 2}`}
                            </p>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <VendorTypeBadge type={vendor.type} />
                      </td>
                      <td className="px-6 py-4">
                        <VendorStatusBadge status={vendor.status} />
                      </td>
                      <td className="px-6 py-4 text-sm text-stone-500">
                        {vendor.email && <div>{vendor.email}</div>}
                        {vendor.phone && <div>{vendor.phone}</div>}
                      </td>
                      <td className="px-6 py-4 text-sm text-stone-500">
                        {vendor.lastContacted
                          ? new Date(vendor.lastContacted).toLocaleDateString()
                          : 'Never'}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <Link
                          href={`/vendors/${vendor.id}`}
                          className="text-stone-700 hover:text-stone-900 text-sm font-medium"
                        >
                          View
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {pagination.totalPages > 1 && (
              <div className="flex justify-center items-center gap-4 mt-8">
                <button
                  onClick={() => handlePageChange(pagination.page - 1)}
                  disabled={pagination.page === 1}
                  className="px-4 py-2 bg-white border border-stone-300 rounded-md hover:bg-stone-50 disabled:opacity-50"
                >
                  Previous
                </button>
                <span className="text-stone-600">
                  Page {pagination.page} of {pagination.totalPages}
                </span>
                <button
                  onClick={() => handlePageChange(pagination.page + 1)}
                  disabled={pagination.page === pagination.totalPages}
                  className="px-4 py-2 bg-white border border-stone-300 rounded-md hover:bg-stone-50 disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Create Vendor Modal */}
      {showCreateModal && (
        <CreateVendorModal
          onClose={() => setShowCreateModal(false)}
          onCreated={() => { setShowCreateModal(false); fetchVendors(); }}
        />
      )}
    </div>
  )
}

function CreateVendorModal({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: () => void
}) {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    website: '',
    address: '',
    type: 'SUBCONTRACTOR',
    status: 'PROSPECT',
    naicsCodes: '',
    notes: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError('')

    try {
      const response = await fetch('/api/vendors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          naicsCodes: formData.naicsCodes.split(',').map((c) => c.trim()).filter(Boolean),
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to create vendor')
      }

      onCreated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/50">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-stone-200">
          <h2 className="text-xl font-semibold text-stone-900">Add New Vendor</h2>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-stone-50 border border-stone-200 rounded-md text-stone-700 text-sm">
              {error}
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-stone-700 mb-1">Name *</label>
            <input
              type="text"
              required
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-3 py-2 border border-stone-300 rounded-md focus:outline-none focus:ring-2 focus:ring-stone-400"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">Email</label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className="w-full px-3 py-2 border border-stone-300 rounded-md focus:outline-none focus:ring-2 focus:ring-stone-400"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">Phone</label>
              <input
                type="tel"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                className="w-full px-3 py-2 border border-stone-300 rounded-md focus:outline-none focus:ring-2 focus:ring-stone-400"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-stone-700 mb-1">Website</label>
            <input
              type="url"
              value={formData.website}
              onChange={(e) => setFormData({ ...formData, website: e.target.value })}
              className="w-full px-3 py-2 border border-stone-300 rounded-md focus:outline-none focus:ring-2 focus:ring-stone-400"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-stone-700 mb-1">Address</label>
            <input
              type="text"
              value={formData.address}
              onChange={(e) => setFormData({ ...formData, address: e.target.value })}
              className="w-full px-3 py-2 border border-stone-300 rounded-md focus:outline-none focus:ring-2 focus:ring-stone-400"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">Type</label>
              <select
                value={formData.type}
                onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                className="w-full px-3 py-2 border border-stone-300 rounded-md focus:outline-none focus:ring-2 focus:ring-stone-400"
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
                onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                className="w-full px-3 py-2 border border-stone-300 rounded-md focus:outline-none focus:ring-2 focus:ring-stone-400"
              >
                <option value="PROSPECT">Prospect</option>
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-stone-700 mb-1">NAICS Codes (comma separated)</label>
            <input
              type="text"
              value={formData.naicsCodes}
              onChange={(e) => setFormData({ ...formData, naicsCodes: e.target.value })}
              placeholder="541330, 541512"
              className="w-full px-3 py-2 border border-stone-300 rounded-md focus:outline-none focus:ring-2 focus:ring-stone-400"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-stone-700 mb-1">Notes</label>
            <textarea
              rows={3}
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              className="w-full px-3 py-2 border border-stone-300 rounded-md focus:outline-none focus:ring-2 focus:ring-stone-400"
            />
          </div>
          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-stone-300 rounded-md text-stone-700 hover:bg-stone-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 px-4 py-2 bg-stone-800 text-white rounded-md hover:bg-stone-700 disabled:opacity-50"
            >
              {saving ? 'Creating...' : 'Create Vendor'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function VendorsPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-stone-50 flex items-center justify-center">
          <div className="text-center">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-stone-600"></div>
            <p className="mt-4 text-stone-600">Loading vendors...</p>
          </div>
        </div>
      }
    >
      <VendorsPageContent />
    </Suspense>
  )
}
