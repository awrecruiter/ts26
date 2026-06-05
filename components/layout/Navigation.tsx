'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useSession, signOut } from 'next-auth/react'

interface DropdownItem {
  label: string
  href: string
  adminOnly?: boolean
}

interface NavItem {
  label: string
  href?: string
  items?: DropdownItem[]
}

export default function Navigation() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { data: session } = useSession()
  const [openDropdown, setOpenDropdown] = useState<string | null>(null)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const isAdmin = session?.user?.role === 'ADMIN'

  const navItems: NavItem[] = [
    {
      label: 'Dashboard',
      href: '/dashboard',
    },
    {
      label: 'Opportunities',
      items: [
        { label: 'All Opportunities', href: '/opportunities' },
        { label: 'Active', href: '/opportunities?status=ACTIVE' },
        { label: 'Expired', href: '/opportunities?status=EXPIRED' },
        { label: 'Awarded', href: '/opportunities?status=AWARDED' },
      ],
    },
    {
      label: 'SOWs',
      items: [
        { label: 'All SOWs', href: '/sows' },
        { label: 'Pending Approval', href: '/sows?status=PENDING_REVIEW' },
        { label: 'Approved', href: '/sows?status=APPROVED' },
        { label: 'Sent', href: '/sows?status=SENT' },
      ],
    },
    {
      label: 'Bids',
      items: [
        { label: 'All Bids', href: '/bids' },
        { label: 'In Progress', href: '/bids?status=DRAFT' },
        { label: 'Submitted', href: '/bids?status=SUBMITTED' },
      ],
    },
    {
      label: 'Vendors',
      items: [
        { label: 'All Vendors', href: '/vendors' },
        { label: 'Subcontractors', href: '/vendors?type=SUBCONTRACTOR' },
        { label: 'Partners', href: '/vendors?type=PARTNER' },
        { label: 'Active', href: '/vendors?status=ACTIVE' },
      ],
    },
    {
      label: 'Reports',
      items: [
        { label: 'Pipeline Report', href: '/reports/pipeline' },
        { label: 'Margin Analysis', href: '/reports/margins' },
        { label: 'Win Rate', href: '/reports/win-rate' },
      ],
    },
  ]

  // Add admin menu if user is admin
  if (isAdmin) {
    navItems.push({
      label: 'Admin',
      items: [
        { label: 'Users', href: '/admin/users', adminOnly: true },
        { label: 'Settings', href: '/admin/settings', adminOnly: true },
        { label: 'Admin Tools', href: '/admin', adminOnly: true },
        { label: 'System Logs', href: '/admin/logs', adminOnly: true },
      ],
    })
  }

  const isActivePath = (href: string) => {
    const [hrefPath, hrefQuery] = href.split('?')
    if (hrefPath === '/dashboard') return pathname === hrefPath
    if (!pathname.startsWith(hrefPath)) return false
    if (!hrefQuery) return true
    // If the link has query params, all of them must match the current URL
    const hrefParams = new URLSearchParams(hrefQuery)
    for (const [key, value] of hrefParams.entries()) {
      if (searchParams.get(key) !== value) return false
    }
    return true
  }

  const handleDropdownToggle = (label: string) => {
    setOpenDropdown(openDropdown === label ? null : label)
  }

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = () => setOpenDropdown(null)
    if (openDropdown) {
      document.addEventListener('click', handleClickOutside)
      return () => document.removeEventListener('click', handleClickOutside)
    }
  }, [openDropdown])

  return (
    <nav className="bg-white border-b border-stone-200 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          {/* Logo and main nav */}
          <div className="flex">
            {/* Logo */}
            <Link href="/dashboard" className="flex items-center px-2 py-2">
              <div className="flex-shrink-0 flex items-center">
                <span className="text-2xl font-bold text-stone-900">USHER</span>
              </div>
            </Link>

            {/* Desktop navigation */}
            <div className="hidden md:ml-6 md:flex md:items-center md:space-x-1">
              {navItems.map((item) => {
                if (item.href) {
                  // Simple link
                  return (
                    <Link
                      key={item.label}
                      href={item.href}
                      className={`inline-flex items-center px-4 py-2 text-sm font-medium transition-colors ${
                        isActivePath(item.href)
                          ? 'text-stone-900 bg-stone-100'
                          : 'text-stone-600 hover:text-stone-900 hover:bg-stone-50'
                      }`}
                    >
                      {item.label}
                    </Link>
                  )
                } else if (item.items) {
                  // Dropdown
                  return (
                    <div key={item.label} className="relative">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          handleDropdownToggle(item.label)
                        }}
                        className={`inline-flex items-center px-4 py-2 text-sm font-medium transition-colors ${
                          item.items.some((i) => isActivePath(i.href))
                            ? 'text-stone-900 bg-stone-100'
                            : 'text-stone-600 hover:text-stone-900 hover:bg-stone-50'
                        }`}
                      >
                        {item.label}
                        <svg
                          className="ml-1 h-4 w-4"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M19 9l-7 7-7-7"
                          />
                        </svg>
                      </button>

                      {/* Dropdown menu */}
                      {openDropdown === item.label && (
                        <div className="absolute z-10 mt-2 w-48 rounded-md shadow-lg bg-white ring-1 ring-stone-200">
                          <div className="py-1">
                            {item.items.map((subItem) => (
                              <Link
                                key={subItem.href}
                                href={subItem.href}
                                className={`block px-4 py-2 text-sm transition-colors ${
                                  isActivePath(subItem.href)
                                    ? 'bg-stone-100 text-stone-900'
                                    : 'text-stone-700 hover:bg-stone-50 hover:text-stone-900'
                                }`}
                                onClick={() => setOpenDropdown(null)}
                              >
                                {subItem.label}
                              </Link>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                }
                return null
              })}
            </div>
          </div>

          {/* Right side - User menu */}
          <div className="flex items-center">
            {session && (
              <div className="relative ml-3">
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDropdownToggle('user')
                  }}
                  className="flex items-center text-sm rounded-full focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-stone-400"
                >
                  <div className="h-8 w-8 rounded-full bg-stone-800 flex items-center justify-center text-white font-semibold">
                    {session.user?.name?.[0]?.toUpperCase() || 'U'}
                  </div>
                  <span className="ml-2 text-stone-700 hidden md:block">
                    {session.user?.name}
                  </span>
                  <svg
                    className="ml-1 h-4 w-4 text-stone-500 hidden md:block"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 9l-7 7-7-7"
                    />
                  </svg>
                </button>

                {/* User dropdown */}
                {openDropdown === 'user' && (
                  <div className="absolute right-0 z-10 mt-2 w-48 rounded-md shadow-lg bg-white ring-1 ring-stone-200">
                    <div className="py-1">
                      <div className="px-4 py-2 text-xs text-stone-500 border-b border-stone-100">
                        {session.user?.email}
                      </div>
                      <Link
                        href="/profile"
                        onClick={() => setOpenDropdown(null)}
                        className="block w-full text-left px-4 py-2 text-sm text-stone-700 hover:bg-stone-50"
                      >
                        Profile &amp; organization
                      </Link>
                      <button
                        onClick={() => { setOpenDropdown(null); signOut({ callbackUrl: '/login' }) }}
                        className="block w-full text-left px-4 py-2 text-sm text-stone-700 hover:bg-stone-50"
                      >
                        Sign out
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Mobile menu button */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden ml-2 inline-flex items-center justify-center p-2 rounded-md text-stone-700 hover:text-stone-900 hover:bg-stone-100"
            >
              <svg
                className="h-6 w-6"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                {mobileMenuOpen ? (
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                ) : (
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 6h16M4 12h16M4 18h16"
                  />
                )}
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Mobile menu */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-stone-200">
          <div className="px-2 pt-2 pb-3 space-y-1">
            {navItems.map((item) => {
              if (item.href) {
                return (
                  <Link
                    key={item.label}
                    href={item.href}
                    className={`block px-3 py-2 rounded-md text-base font-medium ${
                      isActivePath(item.href)
                        ? 'text-stone-900 bg-stone-100'
                        : 'text-stone-700 hover:text-stone-900 hover:bg-stone-50'
                    }`}
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    {item.label}
                  </Link>
                )
              } else if (item.items) {
                return (
                  <div key={item.label}>
                    <div className="px-3 py-2 text-base font-semibold text-stone-900">
                      {item.label}
                    </div>
                    {item.items.map((subItem) => (
                      <Link
                        key={subItem.href}
                        href={subItem.href}
                        className={`block pl-6 pr-3 py-2 rounded-md text-sm ${
                          isActivePath(subItem.href)
                            ? 'text-stone-900 bg-stone-100'
                            : 'text-stone-600 hover:text-stone-900 hover:bg-stone-50'
                        }`}
                        onClick={() => setMobileMenuOpen(false)}
                      >
                        {subItem.label}
                      </Link>
                    ))}
                  </div>
                )
              }
              return null
            })}
          </div>
        </div>
      )}
    </nav>
  )
}
