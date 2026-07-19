/**
 * Shared plan-generator helpers.
 *
 * Every plan generator (APP, QCP, WMP, SSHP, SWPPP, EMP, TCP, …) uses the
 * same set of PlanField builders: `opp` reads a value off the opportunity,
 * `sub` reads it off the selected sub's intake, `tpl` is boilerplate
 * template text, and `admin` is a blank the admin must fill. Every builder
 * checks the shared `overrides` map first so an admin edit wins over the
 * default value.
 *
 * All builders return a { opp, sub, tpl, admin, checked, awaitedFor }
 * closure set so a generator can call `helpers.admin('SSHO name', 'ssho')`
 * without threading the overrides map through every call site.
 */
import type { PlanField, PlanItem, GeneratedPlan } from './types'

export interface HelperContext {
  overrides?: Record<string, string>
  checks?: Record<string, boolean>
  /** Human-readable name of the sub whose intake is populating this plan. */
  selectedSubName?: string | null
}

export function makePlanHelpers({ overrides = {}, checks = {}, selectedSubName = null }: HelperContext) {
  const subName = selectedSubName ?? null

  const opp = (v: string | null | undefined, label: string, id?: string): PlanField => {
    const overridden = id != null && overrides[id] != null
    const value = overridden ? overrides[id]! : (v ?? '').trim()
    return {
      id, label,
      value: value || 'Needs input',
      source: 'opportunity',
      needsInput: !value,
      overridden,
    }
  }

  const sub = (v: string | number | null | undefined, label: string, id?: string): PlanField => {
    const overridden = id != null && overrides[id] != null
    const raw = v == null ? '' : String(v).trim()
    const value = overridden ? overrides[id]! : raw
    return {
      id, label,
      value: value || (subName ? `Waiting on ${subName}` : 'Waiting — no sub selected for bid yet'),
      source: 'sub',
      needsInput: !value,
      awaitedFrom: subName ?? undefined,
      overridden,
    }
  }

  const tpl = (v: string, label: string, id?: string): PlanField => {
    const overridden = id != null && overrides[id] != null
    return {
      id, label,
      value: overridden ? overrides[id]! : v,
      source: 'template',
      needsInput: false,
      overridden,
    }
  }

  const admin = (
    label: string,
    id: string,
    opts: { placeholder?: string; multiline?: boolean } = {},
  ): PlanField => {
    const value = overrides[id] ?? ''
    return {
      id, label,
      value: value || (opts.placeholder ?? 'Click to add'),
      source: 'admin',
      needsInput: !value,
      multiline: opts.multiline ?? false,
      overridden: !!value,
    }
  }

  const checked = (key: string): boolean => !!checks[key]

  return { opp, sub, tpl, admin, checked, subName }
}

// Walks items → subitems → checklist fields so callers can compute a % of
// slots that have been populated.
export function collectPlanFields(plan: GeneratedPlan): PlanField[] {
  const out: PlanField[] = []
  const visit = (item: PlanItem) => {
    if (item.field) out.push(item.field)
    for (const s of item.subitems ?? []) visit(s)
  }
  for (const section of plan.sections) {
    for (const f of section.fields ?? []) out.push(f)
    for (const i of section.items ?? []) visit(i)
    for (const f of section.checklist?.fields ?? []) out.push(f)
  }
  return out
}
