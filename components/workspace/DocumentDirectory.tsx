'use client'

import { format } from 'date-fns'

interface Document {
  id: string
  type: 'bid' | 'email' | 'note'
  title: string
  status?: string
  updatedAt: string | Date
  opportunityTitle?: string
}

interface DocumentDirectoryProps {
  documents: Document[]
  activeDocumentId?: string
  onSelectDocument: (doc: Document) => void
  onCreateNew?: (type: string) => void
}

const TYPE_ICONS: Record<string, React.ReactNode> = {
  bid: (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  ),
  email: (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
    </svg>
  ),
  note: (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
    </svg>
  ),
}

const TYPE_LABELS: Record<string, string> = {
  bid: 'Bids',
  email: 'Emails',
  note: 'Notes',
}

export default function DocumentDirectory({
  documents,
  activeDocumentId,
  onSelectDocument,
  onCreateNew,
}: DocumentDirectoryProps) {
  // Group documents by type
  const grouped = documents.reduce((acc, doc) => {
    if (!acc[doc.type]) acc[doc.type] = []
    acc[doc.type].push(doc)
    return acc
  }, {} as Record<string, Document[]>)

  const typeOrder = ['bid', 'email', 'note']

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-stone-200">
        <h2 className="text-sm font-semibold text-stone-700">Documents</h2>
        <p className="text-xs text-stone-400 mt-1">{documents.length} items</p>
      </div>

      {/* Document list */}
      <div className="flex-1 overflow-y-auto">
        {typeOrder.map((type) => {
          const docs = grouped[type]
          if (!docs || docs.length === 0) return null

          return (
            <div key={type} className="border-b border-stone-100">
              {/* Type header */}
              <div className="px-4 py-2 bg-stone-50 flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-medium text-stone-500">
                  {TYPE_ICONS[type]}
                  <span>{TYPE_LABELS[type]}</span>
                  <span className="text-stone-400">({docs.length})</span>
                </div>
                {onCreateNew && (
                  <button
                    onClick={() => onCreateNew(type)}
                    className="text-stone-400 hover:text-stone-600 p-1"
                    title={`New ${type}`}
                  >
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                  </button>
                )}
              </div>

              {/* Documents in this type */}
              <div className="py-1">
                {docs.map((doc) => (
                  <button
                    key={doc.id}
                    onClick={() => onSelectDocument(doc)}
                    className={`
                      w-full text-left px-4 py-2.5 flex items-start gap-3
                      transition-colors
                      ${activeDocumentId === doc.id
                        ? 'bg-stone-100'
                        : 'hover:bg-stone-50'
                      }
                    `}
                  >
                    <span className={`mt-0.5 ${activeDocumentId === doc.id ? 'text-stone-700' : 'text-stone-400'}`}>
                      {TYPE_ICONS[doc.type]}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm truncate ${activeDocumentId === doc.id ? 'text-stone-900 font-medium' : 'text-stone-700'}`}>
                        {doc.title}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        {doc.status && (
                          <span className={`text-xs px-1.5 py-0.5 rounded ${
                            doc.status === 'SUBMITTED' ? 'bg-stone-200 text-stone-600' :
                            doc.status === 'APPROVED' ? 'bg-stone-200 text-stone-600' :
                            doc.status === 'DRAFT' ? 'bg-stone-100 text-stone-500' :
                            'bg-stone-100 text-stone-500'
                          }`}>
                            {doc.status.toLowerCase()}
                          </span>
                        )}
                        <span className="text-xs text-stone-400">
                          {format(new Date(doc.updatedAt), 'MMM d')}
                        </span>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )
        })}

        {documents.length === 0 && (
          <div className="p-8 text-center text-stone-400">
            <svg className="h-8 w-8 mx-auto mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
            <p className="text-xs">No documents yet</p>
          </div>
        )}
      </div>

      {/* Quick actions */}
      {onCreateNew && (
        <div className="p-3 border-t border-stone-200 bg-stone-50">
          <button
            onClick={() => onCreateNew('bid')}
            className="w-full px-3 py-2 text-xs text-stone-600 hover:text-stone-800 hover:bg-stone-100 rounded flex items-center justify-center gap-2 transition-colors"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New Document
          </button>
        </div>
      )}
    </div>
  )
}
