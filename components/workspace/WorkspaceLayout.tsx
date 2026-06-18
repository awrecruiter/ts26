'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'

interface WorkspacePanel {
  id: string
  label: string
  icon: React.ReactNode
  content: React.ReactNode
}

interface WorkspaceProgress {
  bidCreated?: boolean
  sowCreated?: boolean
  subcontractorsFound?: boolean
  quotesReceived?: boolean
  bidSubmitted?: boolean
}

interface WorkspaceLayoutProps {
  panels: WorkspacePanel[]
  activePanel?: string
  onPanelChange?: (panelId: string) => void
  sidebarContent?: React.ReactNode
  headerContent?: React.ReactNode
  progress?: WorkspaceProgress
  nextAction?: string
  /** Only ADMIN users see the Submit stage and submit affordances. */
  isAdmin?: boolean
  /** Opportunity id + status enable the header Dismiss/Restore action. */
  opportunityId?: string
  opportunityStatus?: string
}

export default function WorkspaceLayout({
  panels,
  activePanel,
  onPanelChange,
  sidebarContent,
  headerContent,
  progress,
  nextAction,
  isAdmin = false,
  opportunityId,
  opportunityStatus,
}: WorkspaceLayoutProps) {
  const router = useRouter()
  const [dismissPending, setDismissPending] = useState(false)
  const isDismissed = opportunityStatus === 'DISMISSED'

  const handleDismiss = async () => {
    if (!opportunityId || dismissPending) return
    if (!window.confirm('Dismiss this opportunity? You can restore it from the Dismissed view.')) return
    setDismissPending(true)
    try {
      const res = await fetch(`/api/opportunities/${opportunityId}/dismiss`, {
        method: 'POST',
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      router.push('/opportunities')
    } catch {
      alert('Could not dismiss this opportunity. Please try again.')
      setDismissPending(false)
    }
  }

  const handleRestore = async () => {
    if (!opportunityId || dismissPending) return
    setDismissPending(true)
    try {
      const res = await fetch(`/api/opportunities/${opportunityId}/restore`, {
        method: 'POST',
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      router.refresh()
    } catch {
      alert('Could not restore this opportunity. Please try again.')
    } finally {
      setDismissPending(false)
    }
  }

  const [currentIndex, setCurrentIndex] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [startX, setStartX] = useState(0)

  // Sync with external activePanel prop
  useEffect(() => {
    if (activePanel) {
      const idx = panels.findIndex((p) => p.id === activePanel)
      if (idx >= 0) setCurrentIndex(idx)
    }
  }, [activePanel, panels])

  const goToPanel = (index: number) => {
    if (index >= 0 && index < panels.length) {
      setCurrentIndex(index)
      onPanelChange?.(panels[index].id)
    }
  }

  const goNext = () => goToPanel(currentIndex + 1)
  const goPrev = () => goToPanel(currentIndex - 1)

  // Mouse drag for panning
  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true)
    setStartX(e.pageX - (containerRef.current?.offsetLeft || 0))
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return
    e.preventDefault()
  }

  const handleMouseUp = (e: React.MouseEvent) => {
    if (!isDragging) return
    setIsDragging(false)
    const x = e.pageX - (containerRef.current?.offsetLeft || 0)
    const walk = startX - x
    if (walk > 100) goNext()
    else if (walk < -100) goPrev()
  }

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault()
        goNext()
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault()
        goPrev()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [currentIndex])

  // Calculate progress percentage — denominator drops to 4 for non-admins
  // since they can't reach the Submit stage.
  const progressSteps = progress ? [
    progress.sowCreated,
    progress.subcontractorsFound,
    progress.quotesReceived,
    progress.bidCreated,
    ...(isAdmin ? [progress.bidSubmitted] : []),
  ] : []
  const completedSteps = progressSteps.filter(Boolean).length
  const progressPercent = progressSteps.length > 0 ? (completedSteps / progressSteps.length) * 100 : 0

  return (
    <div className="h-[100dvh] flex flex-col bg-stone-50 overflow-hidden">
      {/* Minimal header */}
      {headerContent && (
        <div className="flex-shrink-0 border-b border-stone-200 bg-white">
          <div className="flex items-stretch">
            <div className="flex-1 min-w-0">{headerContent}</div>
            {opportunityId && (
              <div className="flex items-center pr-3 flex-shrink-0">
                {isDismissed ? (
                  <button
                    type="button"
                    onClick={handleRestore}
                    disabled={dismissPending}
                    className="text-xs font-medium text-stone-500 hover:text-stone-800 px-2 py-1 rounded disabled:opacity-50"
                    title="Restore this opportunity"
                  >
                    {dismissPending ? 'Restoring…' : 'Restore'}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleDismiss}
                    disabled={dismissPending}
                    className="text-xs font-medium text-stone-400 hover:text-stone-700 px-2 py-1 rounded disabled:opacity-50"
                    title="Dismiss this opportunity"
                    aria-label="Dismiss this opportunity"
                  >
                    {dismissPending ? 'Dismissing…' : 'Dismiss'}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Subtle progress bar - only show if progress prop exists */}
      {progress && (
        <div className="flex-shrink-0 bg-white border-b border-stone-100">
          <div className="h-1 bg-stone-100">
            <div
              className="h-full bg-stone-400 transition-all duration-500"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          {/* Progress steps indicator */}
          <div className="px-3 py-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 sm:gap-4 overflow-x-auto">
              <ProgressStep n={1} label="SOW" completed={progress.sowCreated} />
              <ProgressStep n={2} label="Subs" completed={progress.subcontractorsFound} />
              <ProgressStep n={3} label="Quotes" completed={progress.quotesReceived} />
              <ProgressStep n={4} label="Bid" completed={progress.bidCreated} />
              {isAdmin && <ProgressStep n={5} label="Submit" completed={progress.bidSubmitted} />}
            </div>
            {nextAction && (
              <p className="text-xs text-stone-500 flex-shrink-0 hidden sm:block">
                Next: <span className="text-stone-700">{nextAction}</span>
              </p>
            )}
          </div>
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        {/* Left sidebar - Document directory — hidden on mobile */}
        {sidebarContent && (
          <div className="hidden md:block w-64 flex-shrink-0 border-r border-stone-200 bg-white overflow-y-auto">
            {sidebarContent}
          </div>
        )}

        {/* Main workspace area */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          {/* Panel navigation tabs — horizontally scrollable on mobile */}
          <div className="flex-shrink-0 bg-white border-b border-stone-200">
            <div className="flex items-center overflow-x-auto">
              <div className="flex items-center gap-0 px-2 min-w-max">
                {panels.map((panel, idx) => (
                  <button
                    key={panel.id}
                    onClick={() => goToPanel(idx)}
                    className={`
                      flex items-center gap-1.5 px-3 sm:px-4 py-3 text-sm font-medium whitespace-nowrap
                      border-b-2 transition-colors min-h-[44px]
                      ${idx === currentIndex
                        ? 'border-stone-800 text-stone-900'
                        : 'border-transparent text-stone-500 hover:text-stone-700 hover:border-stone-300'
                      }
                    `}
                  >
                    <span className="opacity-60">{panel.icon}</span>
                    {panel.label}
                  </button>
                ))}
              </div>

              {/* Navigation arrows */}
              <div className="ml-auto flex items-center gap-1 pr-2 flex-shrink-0">
                <button
                  onClick={goPrev}
                  disabled={currentIndex === 0}
                  className="p-2 text-stone-400 hover:text-stone-600 disabled:opacity-30 disabled:cursor-not-allowed min-h-[44px] min-w-[44px] flex items-center justify-center"
                  title="Previous (←)"
                >
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <span className="text-xs text-stone-400 tabular-nums hidden sm:inline">
                  {currentIndex + 1} / {panels.length}
                </span>
                <button
                  onClick={goNext}
                  disabled={currentIndex === panels.length - 1}
                  className="p-2 text-stone-400 hover:text-stone-600 disabled:opacity-30 disabled:cursor-not-allowed min-h-[44px] min-w-[44px] flex items-center justify-center"
                  title="Next (→)"
                >
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
            </div>
          </div>

          {/* Panel content with horizontal slide */}
          <div
            ref={containerRef}
            className="flex-1 overflow-hidden relative"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={() => setIsDragging(false)}
          >
            <div
              className="absolute inset-0 flex transition-transform duration-300 ease-out"
              style={{ transform: `translateX(-${currentIndex * 100}%)` }}
            >
              {panels.map((panel) => (
                <div
                  key={panel.id}
                  className="w-full h-full flex-shrink-0 overflow-auto"
                >
                  {panel.content}
                </div>
              ))}
            </div>
          </div>

          {/* Bottom navigation dots */}
          <div className="flex-shrink-0 bg-white border-t border-stone-200 px-4 py-2">
            <div className="flex items-center justify-between text-xs text-stone-400">
              <span className="hidden sm:inline">← → Arrow keys to navigate</span>
              <div className="flex items-center gap-2 mx-auto sm:mx-0">
                {panels.map((_, idx) => (
                  <button
                    key={idx}
                    onClick={() => goToPanel(idx)}
                    className={`w-2 h-2 rounded-full transition-colors ${
                      idx === currentIndex ? 'bg-stone-600' : 'bg-stone-300 hover:bg-stone-400'
                    }`}
                  />
                ))}
              </div>
              <span className="hidden sm:inline">Drag to pan</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// Progress step indicator component
function ProgressStep({ n, label, completed }: { n?: number; label: string; completed?: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className={`w-5 h-5 rounded-full flex items-center justify-center ${
        completed ? 'bg-stone-600' : 'bg-stone-200'
      }`}>
        {completed ? (
          <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
          </svg>
        ) : n !== undefined ? (
          <span className="text-[10px] font-semibold text-stone-500">{n}</span>
        ) : null}
      </div>
      <span className={`text-xs ${completed ? 'text-stone-700' : 'text-stone-400'}`}>
        {label}
      </span>
    </div>
  )
}
