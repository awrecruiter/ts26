'use client'

import { useState } from 'react'

export type Stage =
  | 'DISCOVERY'
  | 'ASSESSMENT'
  | 'SOW_CREATION'
  | 'SOW_REVIEW'
  | 'BID_ASSEMBLY'
  | 'READY'
  | 'SUBMITTED'

interface Blocker {
  id: string
  description: string
  severity: 'high' | 'medium' | 'low'
}

interface NextAction {
  id: string
  description: string
  priority: 'high' | 'medium' | 'low'
  assignedTo?: string
}

interface CompletedStages {
  discovered?: boolean
  assessed?: boolean
  bidCreated?: boolean
  bidSubmitted?: boolean
}

interface ProgressData {
  currentStage: Stage
  completionPct: number
  blockers?: Blocker[]
  nextActions?: NextAction[]
  lastUpdated: string
  completedStages?: CompletedStages
}

interface WIPProgressTrackerProps {
  opportunityId: string
  progress: ProgressData
  onUpdateStage?: (newStage: Stage) => Promise<void>
  compact?: boolean
}

// Map stage keys to completedStages keys
const STAGE_COMPLETION_MAP: Record<Stage, keyof CompletedStages | null> = {
  DISCOVERY: 'discovered',
  ASSESSMENT: 'assessed',
  SOW_CREATION: null,
  SOW_REVIEW: null,
  BID_ASSEMBLY: 'bidCreated',
  READY: 'bidCreated',
  SUBMITTED: 'bidSubmitted',
}

const STAGES: { key: Stage; label: string; shortLabel: string }[] = [
  { key: 'DISCOVERY', label: 'Discovery', shortLabel: 'Discovered' },
  { key: 'ASSESSMENT', label: 'Assessment', shortLabel: 'Assessed' },
  { key: 'SOW_CREATION', label: 'SOW Creation', shortLabel: 'SOW Created' },
  { key: 'SOW_REVIEW', label: 'SOW Review', shortLabel: 'SOW Approved' },
  { key: 'BID_ASSEMBLY', label: 'Bid Assembly', shortLabel: 'Bid Ready' },
  { key: 'READY', label: 'Ready', shortLabel: 'Ready' },
  { key: 'SUBMITTED', label: 'Submitted', shortLabel: 'Submitted' },
]

export default function WIPProgressTracker({
  opportunityId,
  progress,
  onUpdateStage,
  compact = false,
}: WIPProgressTrackerProps) {
  const [updating, setUpdating] = useState(false)

  const currentStageIndex = STAGES.findIndex((s) => s.key === progress.currentStage)

  const handleStageClick = async (stage: Stage) => {
    if (!onUpdateStage || updating) return

    setUpdating(true)
    try {
      await onUpdateStage(stage)
    } finally {
      setUpdating(false)
    }
  }

  if (compact) {
    // Compact view for dashboard/cards
    return (
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg border border-blue-200 p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-sm font-semibold text-gray-900">
              {STAGES[currentStageIndex]?.label}
            </div>
            <div className="text-xs text-gray-600">
              Step {currentStageIndex + 1} of {STAGES.length}
            </div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold text-blue-600">
              {progress.completionPct}%
            </div>
          </div>
        </div>

        {/* Mini progress bar */}
        <div className="w-full bg-blue-200 rounded-full h-2">
          <div
            className="bg-blue-600 h-2 rounded-full transition-all duration-500"
            style={{ width: `${progress.completionPct}%` }}
          />
        </div>

        {/* Blockers alert */}
        {progress.blockers && progress.blockers.length > 0 && (
          <div className="mt-3 flex items-center gap-2 text-xs text-red-600 font-medium">
            <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                clipRule="evenodd"
              />
            </svg>
            {progress.blockers.length} blocker{progress.blockers.length > 1 ? 's' : ''}
          </div>
        )}
      </div>
    )
  }

  // Full TurboTax-style horizontal stepper
  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-4">
        <div className="flex items-center justify-between text-white">
          <div>
            <h3 className="text-lg font-semibold">Pipeline Progress</h3>
            <p className="text-sm text-blue-100 mt-1">
              Step {currentStageIndex + 1} of {STAGES.length}: {STAGES[currentStageIndex]?.label}
            </p>
          </div>
          <div className="text-right">
            <div className="text-3xl font-bold">{progress.completionPct}%</div>
            <div className="text-xs text-blue-100">Complete</div>
          </div>
        </div>
      </div>

      {/* Horizontal Stepper - TurboTax Style */}
      <div className="px-6 py-8 bg-gray-50">
        <div className="relative">
          {/* Connecting line */}
          <div className="absolute top-5 left-0 right-0 h-1 bg-gray-200">
            <div
              className="h-1 bg-blue-600 transition-all duration-500"
              style={{
                width: `${(currentStageIndex / (STAGES.length - 1)) * 100}%`,
              }}
            />
          </div>

          {/* Steps */}
          <div className="relative flex justify-between">
            {STAGES.map((stage, index) => {
              const isBeforeCurrent = index < currentStageIndex
              const isCurrent = index === currentStageIndex
              const isFuture = index > currentStageIndex

              // Check if this stage is completed based on auto-detected data
              const completionKey = STAGE_COMPLETION_MAP[stage.key]
              const isAutoCompleted = completionKey && progress.completedStages?.[completionKey]

              // A stage is considered completed if:
              // 1. It's before the current stage, OR
              // 2. It's been auto-detected as completed based on related records
              const isCompleted = isBeforeCurrent || isAutoCompleted

              return (
                <div
                  key={stage.key}
                  onClick={() => onUpdateStage && handleStageClick(stage.key)}
                  className={`flex flex-col items-center ${
                    onUpdateStage ? 'cursor-pointer group' : ''
                  }`}
                  style={{ flex: 1 }}
                >
                  {/* Circle */}
                  <div
                    className={`
                      w-10 h-10 rounded-full border-4 flex items-center justify-center
                      transition-all duration-300 z-10
                      ${
                        isCurrent
                          ? 'bg-blue-600 border-blue-600 shadow-lg scale-110'
                          : isCompleted
                          ? 'bg-green-500 border-green-500'
                          : 'bg-white border-gray-300'
                      }
                      ${onUpdateStage && !isCurrent ? 'group-hover:scale-105 group-hover:shadow-md' : ''}
                    `}
                  >
                    {isCompleted && !isCurrent ? (
                      <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 20 20">
                        <path
                          fillRule="evenodd"
                          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                          clipRule="evenodd"
                        />
                      </svg>
                    ) : isCurrent ? (
                      <div className="w-3 h-3 bg-white rounded-full animate-pulse" />
                    ) : (
                      <div className="w-3 h-3 bg-gray-300 rounded-full" />
                    )}
                  </div>

                  {/* Label */}
                  <div className="mt-3 text-center">
                    <div
                      className={`text-xs font-semibold ${
                        isCurrent
                          ? 'text-blue-600'
                          : isCompleted
                          ? 'text-green-600'
                          : 'text-gray-500'
                      }`}
                    >
                      {stage.shortLabel}
                    </div>
                    {isCurrent && (
                      <div className="text-[10px] text-blue-500 font-medium mt-1">
                        Current
                      </div>
                    )}
                    {isAutoCompleted && !isCurrent && isFuture && (
                      <div className="text-[10px] text-green-500 font-medium mt-1">
                        Done
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Blockers Section */}
      {progress.blockers && progress.blockers.length > 0 && (
        <div className="px-6 py-4 bg-red-50 border-t-2 border-red-200">
          <div className="flex items-start gap-3">
            <svg className="h-6 w-6 text-red-600 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                clipRule="evenodd"
              />
            </svg>
            <div className="flex-1">
              <h4 className="font-semibold text-red-900 mb-2">
                {progress.blockers.length} Blocker{progress.blockers.length > 1 ? 's' : ''} Detected
              </h4>
              <div className="space-y-2">
                {progress.blockers.map((blocker) => (
                  <div
                    key={blocker.id}
                    className="bg-white rounded border border-red-200 p-3 text-sm"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-gray-900">{blocker.description}</span>
                      <span
                        className={`px-2 py-0.5 text-xs font-semibold rounded flex-shrink-0 ${
                          blocker.severity === 'high'
                            ? 'bg-red-100 text-red-800'
                            : blocker.severity === 'medium'
                            ? 'bg-yellow-100 text-yellow-800'
                            : 'bg-gray-100 text-gray-800'
                        }`}
                      >
                        {blocker.severity}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Next Actions Section */}
      {progress.nextActions && progress.nextActions.length > 0 && (
        <div className="px-6 py-4 border-t border-gray-200 bg-white">
          <h4 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <svg className="h-5 w-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 5l7 7-7 7"
              />
            </svg>
            Next Steps ({progress.nextActions.length})
          </h4>
          <div className="space-y-2">
            {progress.nextActions.map((action) => {
              const priorityConfig = {
                high: { bg: 'bg-red-50', border: 'border-red-200', badge: 'bg-red-100 text-red-800' },
                medium: { bg: 'bg-yellow-50', border: 'border-yellow-200', badge: 'bg-yellow-100 text-yellow-800' },
                low: { bg: 'bg-blue-50', border: 'border-blue-200', badge: 'bg-blue-100 text-blue-800' },
              }
              const config = priorityConfig[action.priority]

              return (
                <div
                  key={action.id}
                  className={`${config.bg} border ${config.border} rounded-lg p-3 flex items-start justify-between gap-3`}
                >
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-900">{action.description}</p>
                    {action.assignedTo && (
                      <p className="text-xs text-gray-600 mt-1">
                        Assigned: {action.assignedTo}
                      </p>
                    )}
                  </div>
                  <span className={`px-2 py-1 text-xs font-semibold rounded ${config.badge} flex-shrink-0`}>
                    {action.priority}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="px-6 py-3 bg-gray-50 border-t border-gray-200">
        <p className="text-xs text-gray-500">
          Last updated: {new Date(progress.lastUpdated).toLocaleString()}
        </p>
      </div>
    </div>
  )
}
