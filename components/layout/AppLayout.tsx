'use client'

import { Suspense } from 'react'
import { usePathname } from 'next/navigation'
import { useSession } from 'next-auth/react'
import Navigation from './Navigation'
import Breadcrumbs from './Breadcrumbs'

interface AppLayoutProps {
  children: React.ReactNode
}

export default function AppLayout({ children }: AppLayoutProps) {
  const pathname = usePathname()
  const { status } = useSession()

  // Don't show navigation on login, register, or root page
  const hideNavigation = pathname === '/' || pathname === '/login' || pathname === '/register' || pathname === '/auth/signin' || pathname === '/auth/error'

  // Don't show navigation if not authenticated
  const showNavigation = status === 'authenticated' && !hideNavigation

  return (
    <>
      {showNavigation && <Suspense fallback={null}><Navigation /></Suspense>}
      {showNavigation && <Breadcrumbs />}
      <main>
        {children}
      </main>
    </>
  )
}
