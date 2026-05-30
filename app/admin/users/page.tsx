"use client"

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'

interface User {
  id: string
  email: string
  name: string | null
  role: 'USER' | 'ADMIN' | 'VIEWER'
  createdAt: string
  _count?: {
    bids: number
    generatedSOWs: number
  }
}

export default function AdminUsersPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null)

  // Check admin access
  useEffect(() => {
    if (status === 'authenticated' && session?.user?.role !== 'ADMIN') {
      router.push('/dashboard')
    }
  }, [status, session, router])

  useEffect(() => {
    if (status === 'authenticated') {
      fetchUsers()
    }
  }, [status])

  const fetchUsers = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/admin/users')
      if (!response.ok) throw new Error('Failed to fetch users')
      const data = await response.json()
      setUsers(data.users)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  const updateUserRole = async (userId: string, newRole: 'USER' | 'ADMIN' | 'VIEWER') => {
    try {
      setUpdatingUserId(userId)
      const response = await fetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: newRole }),
      })
      if (!response.ok) throw new Error('Failed to update user role')
      await fetchUsers()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setUpdatingUserId(null)
    }
  }

  const deleteUser = async (userId: string) => {
    if (!confirm('Are you sure you want to delete this user?')) return

    try {
      setUpdatingUserId(userId)
      const response = await fetch(`/api/admin/users/${userId}`, {
        method: 'DELETE',
      })
      if (!response.ok) throw new Error('Failed to delete user')
      await fetchUsers()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setUpdatingUserId(null)
    }
  }

  const getRoleBadgeClass = (role: string) => {
    switch (role) {
      case 'ADMIN':
        return 'bg-stone-100 text-stone-900'
      case 'USER':
        return 'bg-stone-200 text-stone-800'
      case 'VIEWER':
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
              <h1 className="text-3xl font-bold text-stone-900">User Management</h1>
              <p className="mt-2 text-sm text-stone-600">
                Manage user accounts and permissions
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {loading && (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-stone-600"></div>
            <p className="mt-4 text-stone-600">Loading users...</p>
          </div>
        )}

        {error && (
          <div className="mb-4 p-4 bg-stone-100 border border-stone-400 rounded-md">
            <p className="text-stone-900">{error}</p>
            <button
              onClick={() => { setError(''); fetchUsers(); }}
              className="mt-2 text-sm text-stone-900 underline"
            >
              Retry
            </button>
          </div>
        )}

        {!loading && !error && (
          <div className="bg-white shadow-sm rounded-lg overflow-hidden">
            <table className="min-w-full divide-y divide-stone-200">
              <thead className="bg-stone-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-stone-500 uppercase tracking-wider">
                    User
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-stone-500 uppercase tracking-wider">
                    Role
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-stone-500 uppercase tracking-wider">
                    Activity
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-stone-500 uppercase tracking-wider">
                    Joined
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-stone-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-stone-200">
                {users.map((user) => (
                  <tr key={user.id} className={updatingUserId === user.id ? 'opacity-50' : ''}>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className="h-10 w-10 rounded-full bg-stone-800 flex items-center justify-center text-white font-semibold">
                          {user.name?.[0]?.toUpperCase() || user.email[0].toUpperCase()}
                        </div>
                        <div className="ml-4">
                          <div className="text-sm font-medium text-stone-900">
                            {user.name || 'No name'}
                          </div>
                          <div className="text-sm text-stone-500">{user.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <select
                        value={user.role}
                        onChange={(e) => updateUserRole(user.id, e.target.value as 'USER' | 'ADMIN' | 'VIEWER')}
                        disabled={updatingUserId === user.id || user.id === session?.user?.id}
                        className={`px-2 py-1 text-xs font-medium rounded-full border-0 ${getRoleBadgeClass(user.role)} ${
                          user.id === session?.user?.id ? 'cursor-not-allowed' : 'cursor-pointer'
                        }`}
                      >
                        <option value="VIEWER">Viewer</option>
                        <option value="USER">User</option>
                        <option value="ADMIN">Admin</option>
                      </select>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-stone-500">
                      <div>{user._count?.bids || 0} bids</div>
                      <div>{user._count?.generatedSOWs || 0} SOWs</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-stone-500">
                      {new Date(user.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      {user.id !== session?.user?.id && (
                        <button
                          onClick={() => deleteUser(user.id)}
                          disabled={updatingUserId === user.id}
                          className="text-stone-900 hover:text-stone-700 disabled:opacity-50"
                        >
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {users.length === 0 && (
              <div className="text-center py-12">
                <p className="text-stone-500">No users found</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
