/**
 * Shared types for every plan generator (APP, QCP, WMP, SSHP, SWPPP, EMP,
 * TCP, …). All plans render through the same PlanViewerModal, so they all
 * share the same section / item / field shape.
 */

export type PlanFieldSource = 'opportunity' | 'sub' | 'template' | 'admin'

export interface PlanField {
  /** Stable key for persisted overrides (admin fields only). */
  id?: string
  label: string
  value: string
  source: PlanFieldSource
  /** True when the field is missing / needs admin or sub input. */
  needsInput?: boolean
  /** For sub-sourced fields with no value yet — the sub name we're waiting on. */
  awaitedFrom?: string
  /** True when this admin field should be edited as a multi-line textarea. */
  multiline?: boolean
  /** True when the user has overridden the default value. */
  overridden?: boolean
}

/** A single numbered or lettered item within a section. */
export interface PlanItem {
  /** "1", "2", "A", "B", "a", "b" — rendered as a prefix with a period. */
  number?: string
  /** Body text — usually ends with a colon when a value follows. */
  text: string
  /** Value that fills the blank for this item. */
  field?: PlanField
  /** Nested items (e.g., section c item 1 has A–I subitems). */
  subitems?: PlanItem[]
}

/** Blank signature grid — rendered as a printable table for wet signatures. */
export interface PlanSignatureTable {
  columns: string[]
  rows: number
}

/** Weekly Safety Meeting–style checkable topic list. */
export interface PlanChecklistCategory {
  heading?: string
  items: Array<{ key: string; label: string; checked: boolean }>
}

export interface PlanChecklist {
  categories: PlanChecklistCategory[]
  fields?: PlanField[]
}

export interface PlanSection {
  key: string
  /** Section letter (b, c, d, …) shown before the title. */
  letter?: string
  title: string
  intro?: string
  items?: PlanItem[]
  signatureTable?: PlanSignatureTable
  checklist?: PlanChecklist
  /** Standalone fields (used on the cover / emergency page). */
  fields?: PlanField[]
  /** Free-form bullet list (kept for backwards compatibility). */
  bullets?: string[]
  /** True to render as a boxed appendix (Weekly Safety Meeting, ENG 3394). */
  appendix?: boolean
}

export interface GeneratedPlan {
  key: string
  displayName: string
  planCode: string
  sections: PlanSection[]
  generatedAt: string
  sourceSubcontractorId: string | null
  sourceSubcontractorName: string | null
}

// Common input shape shared by every plan generator.
export interface PlanGenerateInput {
  opportunity: {
    title: string
    solicitationNumber: string
    agency?: string | null
    state?: string | null
    placeOfPerformance?: string | null
    naicsCode?: string | null
  }
  primeCompanyName?: string | null
  selectedSub?: {
    id: string
    name: string
    // Free-form intake responses — each plan generator narrows via a
    // local interface (AppSubResponses, QcpSubResponses, …).
    responses: Record<string, string | number | undefined | null> | null
  } | null
  otherAnticipatedSubs?: Array<{ name: string; role?: string | null }>
  /** Admin edits keyed by PlanField.id. Wins over any default value. */
  overrides?: Record<string, string>
  /** Weekly-meeting (and other) checkbox state keyed by check key. */
  checks?: Record<string, boolean>
}
