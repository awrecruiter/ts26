'use client'

import { useState } from 'react'

interface SubcontractorEstimate {
  name: string
  service: string
  estimated_cost: number
  is_actual_quote: boolean
}

interface BidContent {
  header: {
    title: string
    date: string
    bid_id: string
    prepared_for: string
    prepared_by: string
  }
  opportunity: {
    title: string
    solicitation_number: string
    agency: string
    naics_code: string
  }
  pricing: {
    recommended_price: number
    cost_basis: number
    gross_margin: number
    confidence: string
    source: string
  }
  sections: Array<{
    title: string
    content: string
  }>
  subcontractor_estimates: SubcontractorEstimate[]
}

interface BidDocumentEditorProps {
  content: BidContent
  onSave: (updatedContent: BidContent) => Promise<void>
  onCancel: () => void
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

export default function BidDocumentEditor({ content, onSave, onCancel }: BidDocumentEditorProps) {
  const [editedContent, setEditedContent] = useState<BidContent>(content)
  const [saving, setSaving] = useState(false)
  const [activeSection, setActiveSection] = useState<string | null>(null)

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSave(editedContent)
    } finally {
      setSaving(false)
    }
  }

  const updateHeader = (field: keyof BidContent['header'], value: string) => {
    setEditedContent({
      ...editedContent,
      header: { ...editedContent.header, [field]: value },
    })
  }

  const updateOpportunity = (field: keyof BidContent['opportunity'], value: string) => {
    setEditedContent({
      ...editedContent,
      opportunity: { ...editedContent.opportunity, [field]: value },
    })
  }

  const updateSection = (index: number, field: 'title' | 'content', value: string) => {
    const newSections = [...editedContent.sections]
    newSections[index] = { ...newSections[index], [field]: value }
    setEditedContent({ ...editedContent, sections: newSections })
  }

  const addSection = () => {
    setEditedContent({
      ...editedContent,
      sections: [...editedContent.sections, { title: 'New Section', content: 'Enter content here...' }],
    })
  }

  const removeSection = (index: number) => {
    const newSections = editedContent.sections.filter((_, i) => i !== index)
    setEditedContent({ ...editedContent, sections: newSections })
  }

  return (
    <div className="relative">
      {/* Fixed Toolbar */}
      <div className="sticky top-0 z-10 bg-stone-100 border-b border-stone-300 px-6 py-3 flex justify-between items-center shadow-sm">
        <div className="flex items-center gap-4">
          <div className="text-sm text-stone-600">
            📄 Editing: {editedContent.header.bid_id}
          </div>
          <div className="text-xs text-stone-500">
            Click any text to edit
          </div>
        </div>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            disabled={saving}
            className="px-4 py-2 text-sm border border-stone-300 bg-white text-stone-700 rounded hover:bg-stone-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 text-sm bg-stone-800 text-white rounded hover:bg-stone-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {saving ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                Saving...
              </>
            ) : (
              <>Save Changes</>
            )}
          </button>
        </div>
      </div>

      {/* Document Container - Fixed height with internal scroll */}
      <div className="bg-stone-200 h-[calc(100vh-60px)] overflow-y-auto p-8">
        <div className="max-w-4xl mx-auto bg-white shadow-2xl">
          {/* PDF-like document with A4 proportions */}
          <div className="p-16 space-y-6" style={{ minHeight: '297mm' }}>

            {/* Header - Editable */}
            <div className="text-center mb-12 pb-8 border-b-4 border-stone-800">
              <h1
                contentEditable
                suppressContentEditableWarning
                onBlur={(e) => updateHeader('title', e.currentTarget.textContent || '')}
                className="text-4xl font-bold text-stone-900 mb-6 outline-none focus:bg-stone-50 px-2 py-1 rounded transition-colors"
              >
                {editedContent.header.title}
              </h1>

              <div className="grid grid-cols-2 gap-4 text-sm text-stone-700 max-w-2xl mx-auto">
                <div className="text-left">
                  <span className="font-semibold">Date:</span>{' '}
                  <span
                    contentEditable
                    suppressContentEditableWarning
                    onBlur={(e) => updateHeader('date', e.currentTarget.textContent || '')}
                    className="outline-none focus:bg-yellow-50 px-1 rounded"
                  >
                    {editedContent.header.date}
                  </span>
                </div>
                <div className="text-left">
                  <span className="font-semibold">Bid ID:</span>{' '}
                  <span className="text-stone-600">{editedContent.header.bid_id}</span>
                </div>
                <div className="text-left">
                  <span className="font-semibold">Prepared For:</span>{' '}
                  <span
                    contentEditable
                    suppressContentEditableWarning
                    onBlur={(e) => updateHeader('prepared_for', e.currentTarget.textContent || '')}
                    className="outline-none focus:bg-yellow-50 px-1 rounded"
                  >
                    {editedContent.header.prepared_for}
                  </span>
                </div>
                <div className="text-left">
                  <span className="font-semibold">Prepared By:</span>{' '}
                  <span
                    contentEditable
                    suppressContentEditableWarning
                    onBlur={(e) => updateHeader('prepared_by', e.currentTarget.textContent || '')}
                    className="outline-none focus:bg-yellow-50 px-1 rounded"
                  >
                    {editedContent.header.prepared_by}
                  </span>
                </div>
              </div>
            </div>

            {/* Opportunity Information */}
            <div className="mb-10 pb-6 border-b-2 border-stone-300">
              <h2 className="text-xl font-bold text-stone-900 mb-4">Opportunity Information</h2>
              <div className="space-y-3 text-sm">
                <div>
                  <span className="font-semibold text-stone-800">Project:</span>{' '}
                  <span
                    contentEditable
                    suppressContentEditableWarning
                    onBlur={(e) => updateOpportunity('title', e.currentTarget.textContent || '')}
                    className="outline-none focus:bg-yellow-50 px-1 rounded text-stone-700"
                  >
                    {editedContent.opportunity.title}
                  </span>
                </div>
                <div>
                  <span className="font-semibold text-stone-800">Solicitation Number:</span>{' '}
                  <span className="text-stone-600">{editedContent.opportunity.solicitation_number}</span>
                </div>
                <div>
                  <span className="font-semibold text-stone-800">Government Agency:</span>{' '}
                  <span
                    contentEditable
                    suppressContentEditableWarning
                    onBlur={(e) => updateOpportunity('agency', e.currentTarget.textContent || '')}
                    className="outline-none focus:bg-yellow-50 px-1 rounded text-stone-700"
                  >
                    {editedContent.opportunity.agency}
                  </span>
                </div>
                <div>
                  <span className="font-semibold text-stone-800">NAICS Code:</span>{' '}
                  <span className="text-stone-600">{editedContent.opportunity.naics_code}</span>
                </div>
              </div>
            </div>

            {/* Pricing Summary - Read-only display */}
            <div className="mb-10 pb-6 border-b-2 border-stone-300">
              <h2 className="text-xl font-bold text-stone-900 mb-4">Pricing Summary</h2>
              <div className="bg-stone-50 rounded-lg p-6">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                  <div>
                    <p className="text-xs text-stone-500 uppercase tracking-wide">Recommended Price</p>
                    <p className="text-2xl font-bold text-stone-900">
                      {formatCurrency(editedContent.pricing.recommended_price)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-stone-500 uppercase tracking-wide">Cost Basis</p>
                    <p className="text-2xl font-bold text-stone-700">
                      {formatCurrency(editedContent.pricing.cost_basis)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-stone-500 uppercase tracking-wide">Gross Margin</p>
                    <p className="text-2xl font-bold text-stone-600">
                      {editedContent.pricing.gross_margin.toFixed(1)}%
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-stone-500 uppercase tracking-wide">Confidence</p>
                    <p className="text-lg font-semibold text-stone-700 capitalize">
                      {editedContent.pricing.confidence.replace('_', ' ')}
                    </p>
                  </div>
                </div>
                <div className="mt-4 pt-4 border-t border-stone-200">
                  <p className="text-xs text-stone-500">
                    Data Source:{' '}
                    <span className="font-medium text-stone-700">
                      {editedContent.pricing.source === 'usaspending_api'
                        ? 'USASpending Historical Data'
                        : editedContent.pricing.source === 'subcontractor_quotes'
                        ? 'Subcontractor Quotes'
                        : editedContent.pricing.source === 'cost_based'
                        ? 'Cost-Based Analysis'
                        : 'Industry Estimate'}
                    </span>
                  </p>
                </div>
              </div>
            </div>

            {/* Subcontractor Involvement */}
            {editedContent.subcontractor_estimates && editedContent.subcontractor_estimates.length > 0 && (
              <div className="mb-10 pb-6 border-b-2 border-stone-300">
                <h2 className="text-xl font-bold text-stone-900 mb-4">Subcontractor Involvement</h2>
                <table className="min-w-full border border-stone-300">
                  <thead className="bg-stone-100">
                    <tr>
                      <th className="px-4 py-2 text-left text-sm font-semibold text-stone-700 border-b">Subcontractor</th>
                      <th className="px-4 py-2 text-left text-sm font-semibold text-stone-700 border-b">Service</th>
                      <th className="px-4 py-2 text-right text-sm font-semibold text-stone-700 border-b">Estimated Cost</th>
                      <th className="px-4 py-2 text-center text-sm font-semibold text-stone-700 border-b">Quote Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {editedContent.subcontractor_estimates.map((sub, index) => (
                      <tr key={index} className={index % 2 === 0 ? 'bg-white' : 'bg-stone-50'}>
                        <td className="px-4 py-2 text-sm text-stone-900 border-b">{sub.name}</td>
                        <td className="px-4 py-2 text-sm text-stone-700 border-b">{sub.service}</td>
                        <td className="px-4 py-2 text-sm text-stone-900 text-right border-b">
                          {formatCurrency(sub.estimated_cost)}
                        </td>
                        <td className="px-4 py-2 text-center border-b">
                          <span
                            className={`px-2 py-1 text-xs font-medium rounded-full ${
                              sub.is_actual_quote
                                ? 'bg-stone-100 text-stone-700'
                                : 'bg-stone-200 text-stone-700'
                            }`}
                          >
                            {sub.is_actual_quote ? 'Quoted' : 'Estimated'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Editable Sections */}
            <div className="space-y-8">
              {editedContent.sections.map((section, index) => (
                <div key={index} className="group relative">
                  <button
                    onClick={() => removeSection(index)}
                    className="absolute -right-4 top-0 opacity-0 group-hover:opacity-100 transition-opacity text-stone-500 hover:text-stone-700 p-1"
                    title="Remove section"
                  >
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                  <h2
                    contentEditable
                    suppressContentEditableWarning
                    onBlur={(e) => updateSection(index, 'title', e.currentTarget.textContent || '')}
                    onFocus={() => setActiveSection(`title-${index}`)}
                    className={`text-2xl font-bold text-stone-900 mb-4 outline-none focus:bg-stone-50 px-2 py-1 -ml-2 rounded transition-colors ${
                      activeSection === `title-${index}` ? 'ring-2 ring-stone-400' : ''
                    }`}
                  >
                    {section.title}
                  </h2>
                  <div
                    contentEditable
                    suppressContentEditableWarning
                    onBlur={(e) => updateSection(index, 'content', e.currentTarget.textContent || '')}
                    onFocus={() => setActiveSection(`content-${index}`)}
                    className={`text-stone-700 leading-relaxed whitespace-pre-wrap outline-none focus:bg-yellow-50 px-2 py-2 -ml-2 rounded min-h-[100px] transition-colors ${
                      activeSection === `content-${index}` ? 'ring-2 ring-yellow-400' : ''
                    }`}
                  >
                    {section.content}
                  </div>
                </div>
              ))}
            </div>

            {/* Add Section Button */}
            <div className="mt-8">
              <button
                onClick={addSection}
                className="w-full py-3 border-2 border-dashed border-stone-300 text-stone-500 hover:border-stone-400 hover:text-stone-700 rounded-lg transition-colors"
              >
                + Add Section
              </button>
            </div>

            {/* Signature Section */}
            <div className="mt-20 pt-10 border-t border-stone-300">
              <div className="grid grid-cols-2 gap-12">
                <div>
                  <div className="border-t-2 border-stone-400 pt-2">
                    <p className="text-sm text-stone-600">Authorized Representative</p>
                    <p className="text-xs text-stone-500 mt-1">Signature & Date</p>
                  </div>
                </div>
                <div>
                  <div className="border-t-2 border-stone-400 pt-2">
                    <p className="text-sm text-stone-600">Contracting Officer</p>
                    <p className="text-xs text-stone-500 mt-1">Signature & Date</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Helper Text */}
      <div className="bg-stone-100 border-t border-stone-300 px-6 py-3 text-center text-sm text-stone-600">
        Click on any text to edit it. Changes are highlighted as you type. Don't forget to save!
      </div>
    </div>
  )
}
