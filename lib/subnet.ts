import * as cheerio from 'cheerio'
import type { AnyNode } from 'domhandler'
import crypto from 'crypto'

const SUBNET_BASE =
  'https://legacy.sba.gov/federal-contracting/contracting-guide/prime-subcontracting/subcontracting-opportunities'

export interface SubNetRecord {
  sourceKey: string
  title: string
  primeName: string | null
  description: string | null
  state: string | null
  naicsCode: string | null
  naicsTitle: string | null
  contactEmail: string | null
  contactRaw: string | null
  closingDate: Date | null
  performanceStartDate: Date | null
  sourceUrl: string | null
}

function parseDate(raw: string | null | undefined): Date | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  const d = new Date(trimmed)
  return isNaN(d.getTime()) ? null : d
}

function parseNaics(raw: string | null | undefined): { code: string | null; title: string | null } {
  if (!raw) return { code: null, title: null }
  const match = raw.trim().match(/^(\d{2,6})(?::\s*(.+))?$/)
  if (!match) return { code: null, title: raw.trim() || null }
  return { code: match[1], title: match[2]?.trim() || null }
}

function parseRow($: cheerio.CheerioAPI, tr: AnyNode): SubNetRecord | null {
  const $row = $(tr)
  const $titleTd = $row.find('td.views-field-body')
  const $titleAnchor = $titleTd.find('span.subnet_title a').first()
  const title = $titleAnchor.text().trim() || $titleTd.find('span.subnet_title').text().trim()
  if (!title) return null

  const href = $titleAnchor.attr('href')?.trim() || null
  const slug = href?.match(/\/opportunity\/([^/?#]+)/)?.[1] || null
  const sourceUrl = href ? new URL(href, 'https://legacy.sba.gov').toString() : null

  const primeName = $titleTd.find('span.subnet_business_name').text().trim() || null
  const description = $titleTd.find('p').text().trim() || null

  const closingRaw = $row.find('td.views-field-field-subnet-closing-timestamp').text()
  const startRaw = $row.find('td.views-field-field-subnet-start-date').text()
  const state = $row.find('td.views-field-field-subnet-place-performance').text().trim() || null
  const naicsRaw = $row.find('td.views-field-field-subnet-naics').text()
  const { code: naicsCode, title: naicsTitle } = parseNaics(naicsRaw)

  const $contactTd = $row.find('td.views-field-nothing')
  const contactEmail = $contactTd.find('a[href^="mailto:"]').attr('href')?.replace(/^mailto:/i, '') || null
  const contactRaw = $contactTd.text().trim().replace(/\s+/g, ' ') || null

  const sourceKey =
    slug ||
    crypto
      .createHash('sha1')
      .update([primeName, title, closingRaw.trim()].join('|'))
      .digest('hex')
      .slice(0, 24)

  return {
    sourceKey,
    title,
    primeName,
    description,
    state,
    naicsCode,
    naicsTitle,
    contactEmail,
    contactRaw,
    closingDate: parseDate(closingRaw),
    performanceStartDate: parseDate(startRaw),
    sourceUrl,
  }
}

async function fetchPage(page: number): Promise<string> {
  const url = `${SUBNET_BASE}?state=All&keyword=&page=${page}`
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'USHER/1.0 (federal-bid-management; contact via 1stdirectionco.com)',
      Accept: 'text/html,application/xhtml+xml',
    },
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) throw new Error(`SubNet page ${page} returned ${res.status}`)
  return res.text()
}

export async function scrapeSubNet(): Promise<SubNetRecord[]> {
  const out: SubNetRecord[] = []
  const seen = new Set<string>()

  // Pull page 0, discover pagination, then fan out. Cap at 50 pages as a
  // safety net — SubNet has been ~10 pages historically, so anything past
  // that is either a scraper bug or a listing explosion worth alerting on.
  const MAX_PAGES = 50
  const firstHtml = await fetchPage(0)
  const $first = cheerio.load(firstHtml)

  const pageNums = new Set<number>([0])
  $first('a[href*="page="]').each((_, a) => {
    const m = $first(a).attr('href')?.match(/[?&]page=(\d+)/)
    if (m) pageNums.add(parseInt(m[1], 10))
  })
  const maxPage = Math.min(Math.max(...pageNums), MAX_PAGES - 1)

  const parseInto = (html: string) => {
    const $ = cheerio.load(html)
    $('table.usa-table tbody tr').each((_, tr) => {
      const rec = parseRow($, tr)
      if (rec && !seen.has(rec.sourceKey)) {
        seen.add(rec.sourceKey)
        out.push(rec)
      }
    })
  }

  parseInto(firstHtml)

  for (let p = 1; p <= maxPage; p++) {
    const html = await fetchPage(p)
    parseInto(html)
  }

  return out
}
