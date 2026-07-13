export type ContractType = 'SERVICES' | 'PRODUCT'

export type ResourceCategory =
  | 'professional'
  | 'subcontracted_trade'
  | 'material'
  | 'equipment'
  | 'prime_overhead'
  | 'product'
  | 'logistics_shipping'
  | 'warranty_support'

export const SERVICES_CATEGORIES: ResourceCategory[] = [
  'professional',
  'subcontracted_trade',
  'material',
  'equipment',
  'prime_overhead',
]

export const PRODUCT_CATEGORIES: ResourceCategory[] = [
  'product',
  'logistics_shipping',
  'warranty_support',
  'prime_overhead',
]

export type RiskLevel = 'low' | 'medium' | 'high'

export interface JobDescription {
  roleTitle: string
  seniority?: string
  summary: string
  responsibilities: string[]
  requiredQualifications: string[]
  preferredQualifications?: string[]
  placeOfWork: string
  schedule?: string
  compensationBasis: string
  reportingLine: string
  generatedAt: string
}

export interface ResourceLine {
  id: string
  category: ResourceCategory
  label: string
  valueDescription: string
  quantity?: string
  basis?: string
  estimatedUnitCost?: number | null
  estimatedTotalCost?: number | null
  costSource?: string
  riskLevel: RiskLevel
  riskRationale?: string
  searchQueries?: string[]
  suggestedNaics?: string | null
  linkedSubcontractorId?: string | null
  jobDescription?: JobDescription | null
}

export interface ResourcePlan {
  lines: ResourceLine[]
  primeCoordinationHours?: number | null
  bondingRequired: boolean
  insuranceMinimums?: string[]
  generatedAt: string
  modelVersion: 'gpt-4o' | 'gpt-4o-mini'
}

export interface MarginBands {
  low: number
  medium: number
  high: number
}

export const DEFAULT_MARGIN_BANDS: MarginBands = { low: 8, medium: 15, high: 25 }

export interface PricingSheet {
  costBasisTotal: number
  riskScore: number
  marginBands: MarginBands
  targetMarginPct: number
  targetMarginDollar: number
  recommendedBidPrice: number
  userOverrideMarginPct?: number | null
  updatedAt: string
}
