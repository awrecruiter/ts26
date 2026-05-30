import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'

export interface ApiStatusResult {
  name: string
  status: 'ok' | 'error' | 'unconfigured'
  latencyMs?: number
  error?: string
}

async function probeSamGov(): Promise<ApiStatusResult> {
  const apiKey = process.env.SAM_GOV_API_KEY
  if (!apiKey) {
    return { name: 'SAM.gov', status: 'unconfigured', error: 'SAM_GOV_API_KEY not set' }
  }

  const start = Date.now()
  try {
    const url = `https://api.sam.gov/opportunities/v2/search?limit=1&api_key=${encodeURIComponent(apiKey)}`
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    })
    const latencyMs = Date.now() - start

    if (!res.ok) {
      return {
        name: 'SAM.gov',
        status: 'error',
        latencyMs,
        error: `HTTP ${res.status} ${res.statusText}`,
      }
    }

    return { name: 'SAM.gov', status: 'ok', latencyMs }
  } catch (err) {
    return {
      name: 'SAM.gov',
      status: 'error',
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : 'Unknown error',
    }
  }
}

async function probeUSASpending(): Promise<ApiStatusResult> {
  const start = Date.now()
  try {
    const body = {
      filters: {
        award_type_codes: ['A', 'B', 'C', 'D'],
        naics_codes: { require: ['541512'] },
        time_period: [
          {
            start_date: '2024-01-01',
            end_date: '2024-12-31',
            date_type: 'action_date',
          },
        ],
      },
      fields: ['Award ID', 'Award Amount'],
      page: 1,
      limit: 1,
      sort: 'Award Amount',
      order: 'desc',
    }

    const res = await fetch('https://api.usaspending.gov/api/v2/search/spending_by_award/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    })
    const latencyMs = Date.now() - start

    if (!res.ok) {
      return {
        name: 'USASpending',
        status: 'error',
        latencyMs,
        error: `HTTP ${res.status} ${res.statusText}`,
      }
    }

    return { name: 'USASpending', status: 'ok', latencyMs }
  } catch (err) {
    return {
      name: 'USASpending',
      status: 'error',
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : 'Unknown error',
    }
  }
}

function probeOpenAI(): ApiStatusResult {
  const key = process.env.OPENAI_API_KEY
  if (!key || key.trim() === '') {
    return { name: 'OpenAI', status: 'unconfigured', error: 'OPENAI_API_KEY not set' }
  }
  return { name: 'OpenAI', status: 'ok' }
}

function probeGooglePlaces(): ApiStatusResult {
  const key = process.env.GOOGLE_PLACES_API_KEY
  if (
    !key ||
    key.trim() === '' ||
    key.includes('your_actual') ||
    key.includes('your_google')
  ) {
    return {
      name: 'Google Places',
      status: 'unconfigured',
      error: 'GOOGLE_PLACES_API_KEY not set or is placeholder',
    }
  }
  return { name: 'Google Places', status: 'ok' }
}

function probeVercelBlob(): ApiStatusResult {
  const token = process.env.BLOB_READ_WRITE_TOKEN
  if (!token || token.trim() === '') {
    return {
      name: 'Vercel Blob',
      status: 'unconfigured',
      error: 'BLOB_READ_WRITE_TOKEN not set',
    }
  }
  return { name: 'Vercel Blob', status: 'ok' }
}

function probeSMTP(): ApiStatusResult {
  const smtpConfigured =
    process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS
  const sendgridConfigured = !!process.env.SENDGRID_API_KEY

  if (!smtpConfigured && !sendgridConfigured) {
    return {
      name: 'SMTP / Email',
      status: 'unconfigured',
      error:
        'Neither SMTP (SMTP_HOST + SMTP_USER + SMTP_PASS) nor SENDGRID_API_KEY is configured',
    }
  }

  return { name: 'SMTP / Email', status: 'ok' }
}

export async function GET(): Promise<NextResponse> {
  const session = await auth()

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Run live probes in parallel; env-only checks are synchronous
  const [samResult, usaspendingResult] = await Promise.all([
    probeSamGov(),
    probeUSASpending(),
  ])

  const results: ApiStatusResult[] = [
    samResult,
    usaspendingResult,
    probeOpenAI(),
    probeGooglePlaces(),
    probeVercelBlob(),
    probeSMTP(),
  ]

  return NextResponse.json({ results, checkedAt: new Date().toISOString() })
}
