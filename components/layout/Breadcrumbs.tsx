'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useMemo, useState, useEffect } from 'react'

interface BreadcrumbItem {
  label: string
  href?: string
}

export default function Breadcrumbs() {
  const pathname = usePathname()
  const [dynamicTitles, setDynamicTitles] = useState<Record<string, string>>({})

  // Fetch titles for opportunity and bid IDs
  useEffect(() => {
    const segments = pathname.split('/').filter(Boolean)
    const fetchTitles = async () => {
      const titles: Record<string, string> = {}

      for (let i = 0; i < segments.length; i++) {
        const segment = segments[i]
        const prevSegment = i > 0 ? segments[i - 1] : null

        // If this is an ID after "opportunities"
        if (prevSegment === 'opportunities' && segment.length > 15) {
          try {
            const res = await fetch(`/api/opportunities/${segment}`)
            if (res.ok) {
              const data = await res.json()
              titles[segment] = data.opportunity?.title || data.opportunity?.solicitationNumber || segment
            }
          } catch (err) {
            console.error('Failed to fetch opportunity title:', err)
          }
        }

        // If this is an ID after "bids"
        if (prevSegment === 'bids' && segment.length > 15) {
          try {
            const res = await fetch(`/api/bids/${segment}`)
            if (res.ok) {
              const data = await res.json()
              titles[segment] = data.bid?.opportunity?.title || data.bid?.opportunity?.solicitationNumber || segment
            }
          } catch (err) {
            console.error('Failed to fetch bid title:', err)
          }
        }

      }

      setDynamicTitles(titles)
    }

    fetchTitles()
  }, [pathname])

  const breadcrumbs = useMemo(() => {
    const items: BreadcrumbItem[] = []

    // Don't show breadcrumbs on homepage or dashboard
    if (pathname === '/' || pathname === '/dashboard') {
      return items
    }

    // Always start with Dashboard
    items.push({ label: 'Dashboard', href: '/dashboard' })

    // Parse the path
    const segments = pathname.split('/').filter(Boolean)

    // Build breadcrumbs from path segments
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i]
      const href = `/${segments.slice(0, i + 1).join('/')}`

      // Check if this is the last segment (current page)
      const isLast = i === segments.length - 1

      // Format label
      let label = segment

      // Special cases for readable labels
      switch (segment) {
        case 'opportunities':
          label = 'Opportunities'
          break
        case 'bids':
          label = 'Bids'
          break
        case 'reports':
          label = 'Reports'
          break
        case 'admin':
          label = 'Admin'
          break
        case 'users':
          label = 'Users'
          break
        case 'settings':
          label = 'Settings'
          break
        case 'logs':
          label = 'System Logs'
          break
        case 'pipeline':
          label = 'Pipeline Report'
          break
        case 'margins':
          label = 'Margin Analysis'
          break
        case 'win-rate':
          label = 'Win Rate'
          break
        case 'profile':
          label = 'Your Profile'
          break
        default:
          // If we have a dynamic title for this segment, use it
          if (dynamicTitles[segment]) {
            label = dynamicTitles[segment]
          } else if (segment.length > 15) {
            // If it's a CUID or ID (long alphanumeric) and we haven't loaded the title yet
            label = 'Loading...'
          } else {
            // Capitalize first letter
            label = segment.charAt(0).toUpperCase() + segment.slice(1)
          }
      }

      items.push({
        label,
        href: isLast ? undefined : href, // Last item shouldn't be clickable
      })
    }

    return items
  }, [pathname, dynamicTitles])

  // Don't render if no breadcrumbs
  if (breadcrumbs.length === 0) {
    return null
  }

  return (
    <div className="bg-gray-50 border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
        <nav className="flex" aria-label="Breadcrumb">
          <ol className="flex items-center space-x-2 text-sm">
            {breadcrumbs.map((item, index) => (
              <li key={index} className="flex items-center">
                {index > 0 && (
                  <svg
                    className="flex-shrink-0 h-4 w-4 text-gray-400 mx-2"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                )}
                {item.href ? (
                  <Link
                    href={item.href}
                    className="text-gray-600 hover:text-blue-600 transition-colors truncate max-w-md"
                    title={item.label}
                  >
                    {item.label}
                  </Link>
                ) : (
                  <span className="text-gray-900 font-medium truncate max-w-md" title={item.label}>
                    {item.label}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </nav>
      </div>
    </div>
  )
}
