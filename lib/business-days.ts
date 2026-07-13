/**
 * Business-day helpers for quote-to-prime deadlines that appear in emails
 * and generated SOWs. Weekend + US federal holiday aware, so a computed
 * deadline never lands on a day the sub can't act on.
 */

function isWeekend(d: Date): boolean {
  const day = d.getDay()
  return day === 0 || day === 6
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

function nthWeekdayOfMonth(year: number, month: number, weekday: number, n: number): Date {
  const first = new Date(year, month, 1)
  const offset = (7 + weekday - first.getDay()) % 7
  return new Date(year, month, 1 + offset + (n - 1) * 7)
}

function lastWeekdayOfMonth(year: number, month: number, weekday: number): Date {
  const last = new Date(year, month + 1, 0)
  const offset = (7 + last.getDay() - weekday) % 7
  return new Date(year, month, last.getDate() - offset)
}

function observedForFixed(d: Date): Date {
  const day = d.getDay()
  if (day === 6) return new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1)
  if (day === 0) return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)
  return d
}

const holidayCache = new Map<number, Date[]>()

function federalHolidaysObserved(year: number): Date[] {
  const cached = holidayCache.get(year)
  if (cached) return cached
  const holidays: Date[] = [
    observedForFixed(new Date(year, 0, 1)),   // New Year's Day
    observedForFixed(new Date(year, 5, 19)),  // Juneteenth
    observedForFixed(new Date(year, 6, 4)),   // Independence Day
    observedForFixed(new Date(year, 10, 11)), // Veterans Day
    observedForFixed(new Date(year, 11, 25)), // Christmas
    nthWeekdayOfMonth(year, 0, 1, 3),         // MLK — 3rd Mon Jan
    nthWeekdayOfMonth(year, 1, 1, 3),         // Presidents — 3rd Mon Feb
    lastWeekdayOfMonth(year, 4, 1),           // Memorial — last Mon May
    nthWeekdayOfMonth(year, 8, 1, 1),         // Labor — 1st Mon Sep
    nthWeekdayOfMonth(year, 9, 1, 2),         // Columbus — 2nd Mon Oct
    nthWeekdayOfMonth(year, 10, 4, 4),        // Thanksgiving — 4th Thu Nov
  ]
  holidayCache.set(year, holidays)
  return holidays
}

export function isBusinessDay(d: Date): boolean {
  if (isWeekend(d)) return false
  return !federalHolidaysObserved(d.getFullYear()).some((h) => sameDay(h, d))
}

/**
 * Roll a date backward until it lands on a business day. Used for quote
 * deadlines: keeps the prime's downstream buffer intact (never eats into
 * the days remaining between quote-due and the federal response deadline)
 * and gives a stricter cue to the sub — respond before the weekend/holiday.
 */
export function previousBusinessDay(d: Date): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  while (!isBusinessDay(out)) {
    out.setDate(out.getDate() - 1)
  }
  return out
}

/**
 * Roll a date forward until it lands on a business day. Used for the "floor"
 * (today + N days) so the floor itself never lands on a non-business day.
 */
export function nextBusinessDay(d: Date): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  while (!isBusinessDay(out)) {
    out.setDate(out.getDate() + 1)
  }
  return out
}
