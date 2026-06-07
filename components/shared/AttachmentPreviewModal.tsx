'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { RichAttachment } from '@/lib/types/attachment'
import { isPreviewable } from '@/lib/attachment-preview'

interface AttachmentPreviewModalProps {
  attachment: RichAttachment
  opportunityId: string
  onClose: () => void
}

export default function AttachmentPreviewModal({
  attachment,
  opportunityId,
  onClose,
}: AttachmentPreviewModalProps) {
  // Portal to document.body so the modal escapes any ancestor with a CSS
  // transform — the workspace panel-slide container uses translateX which
  // would otherwise become the containing block for position:fixed children,
  // anchoring the modal off-screen when the email panel is active.
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  if (!mounted) return null

  const proxyUrl = `/api/opportunities/${opportunityId}/attachments/${attachment.id}/proxy`
  const downloadUrl = `${proxyUrl}?download=1`

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex flex-col bg-stone-900/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex flex-col flex-1 m-0 sm:m-6 rounded-none sm:rounded-xl overflow-hidden bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-stone-200 bg-stone-50 flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <svg className="h-4 w-4 text-stone-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
            <p className="text-sm font-medium text-stone-800 truncate">{attachment.currentName}</p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0 ml-4">
            <a
              href={downloadUrl}
              download
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-stone-700 bg-white border border-stone-300 rounded hover:bg-stone-50 transition-colors"
            >
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Download
            </a>
            <button
              onClick={onClose}
              className="p-1.5 text-stone-400 hover:text-stone-600 hover:bg-stone-100 rounded transition-colors"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
        {isPreviewable(attachment.currentName) ? (
          <iframe
            src={proxyUrl}
            className="flex-1 w-full border-0"
            title={attachment.currentName}
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 bg-stone-50">
            <svg className="h-12 w-12 text-stone-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
            <div className="text-center space-y-1">
              <p className="text-sm font-medium text-stone-700">Preview not available</p>
              <p className="text-xs text-stone-400">This file type cannot be displayed in the browser. Download it to view.</p>
            </div>
            <a
              href={downloadUrl}
              download
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-stone-800 rounded hover:bg-stone-700 transition-colors"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Download {attachment.currentName}
            </a>
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}
