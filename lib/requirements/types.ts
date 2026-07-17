/**
 * Shared types for the prework-requirements system. A RequirementTemplate is a
 * static, code-defined description of one component of a required prework plan
 * (APP, QCP, WMP, SF-1413, etc.) that a subcontractor answers via magic link.
 *
 * A RequirementInstance (Prisma model) is one template × opportunity × sub.
 */

export type SubmittalGroup =
  | 'app'               // Accident Prevention Plan
  | 'qcp'               // Quality Control Plan
  | 'wmp'               // Waste Management Plan
  | 'sf1413'            // Labor Standards Compliance (subcontractor cert)
  | 'sub_list'          // Prime's Subcontractor List
  | 'insurance'         // Certificates of Insurance / bonding
  | 'super_letter'      // Project Superintendent designation
  | 'sov'               // Schedule of Values (per-trade pricing)
  | 'quote_submission'  // Sub-facing: submit basic info + priced quote in one form

export interface SubmittalGroupInfo {
  key: SubmittalGroup
  displayName: string
  shortName: string
  description: string
  sowReference?: string
}

export type FieldType =
  | 'text'
  | 'textarea'
  | 'email'
  | 'phone'
  | 'date'
  | 'number'
  | 'currency'
  | 'select'
  | 'file'
  | 'signature'

export interface FormField {
  key: string
  label: string
  type: FieldType
  required?: boolean
  helpText?: string
  placeholder?: string
  /** For type=select */
  options?: { value: string; label: string }[]
  /** For type=file — accepted MIME types */
  accept?: string
  /** For type=file — allow multiple */
  multiple?: boolean
}

export interface FormSection {
  title: string
  description?: string
  fields: FormField[]
}

export interface RequirementTemplate {
  /** Stable key stored on RequirementInstance.templateKey */
  key: string
  submittalGroup: SubmittalGroup
  displayName: string
  /** One-line explainer shown in the prime UI + email invite */
  purpose: string
  /** Hint for who on the sub's team should answer this */
  suggestedRole: 'admin' | 'safety' | 'qc' | 'super' | 'estimator' | 'payroll' | 'principal'
  formSchema: FormSection[]
  /** Days from creation to due date (default: 14) */
  defaultDueDays?: number
}

/** Shape of a sub's answer to a submitted requirement. */
export type RequirementResponses = Record<string, string | number | string[] | null>
