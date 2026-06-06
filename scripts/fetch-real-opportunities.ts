/**
 * Fetch real opportunities directly from SAM.gov and save to database.
 * Bypasses the API route auth for CLI use.
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const SAM_API_BASE = 'https://api.sam.gov/opportunities/v2/search'

async function fetchOpportunities() {
  const apiKey = process.env.SAM_GOV_API_KEY
  if (!apiKey) {
    console.error('SAM_GOV_API_KEY not set. Check .env.local')
    process.exit(1)
  }

  console.log('Fetching real opportunities from SAM.gov...\n')

  // Look back 90 days for opportunities
  const postedFrom = new Date()
  postedFrom.setDate(postedFrom.getDate() - 90)
  const postedFromStr = postedFrom.toLocaleDateString('en-US', {
    month: '2-digit', day: '2-digit', year: 'numeric',
  })
  const todayStr = new Date().toLocaleDateString('en-US', {
    month: '2-digit', day: '2-digit', year: 'numeric',
  })

  const url = new URL(SAM_API_BASE)
  url.searchParams.set('api_key', apiKey)
  url.searchParams.set('postedFrom', postedFromStr)
  url.searchParams.set('postedTo', todayStr)
  url.searchParams.set('limit', '100')
  url.searchParams.set('offset', '0')
  url.searchParams.set('ptype', 'o,p,k')

  console.log(`API URL: ${url.toString().replace(apiKey, '***')}\n`)

  const response = await fetch(url.toString(), {
    headers: { Accept: 'application/json' },
  })

  if (!response.ok) {
    const text = await response.text()
    console.error(`SAM.gov error ${response.status}: ${text}`)
    process.exit(1)
  }

  const data = await response.json()
  const opportunities = data.opportunitiesData || []

  console.log(`SAM.gov returned ${opportunities.length} opportunities (total available: ${data.totalRecords})\n`)

  // Filter: ≥14 days until closing
  const minDeadlineDate = new Date()
  minDeadlineDate.setDate(minDeadlineDate.getDate() + 14)

  const filtered = opportunities.filter((opp: any) => {
    if (!opp.responseDeadLine) return false
    const deadline = new Date(opp.responseDeadLine)
    return deadline >= minDeadlineDate
  })

  console.log(`${filtered.length} have ≥14 days until deadline\n`)

  let saved = 0
  let errors = 0

  for (const opp of filtered) {
    try {
      const solNum = opp.solicitationNumber || opp.noticeId
      if (!solNum) { errors++; continue }

      let postedDate = null
      if (opp.postedDate) {
        try { postedDate = new Date(opp.postedDate) } catch {}
      }

      let responseDeadline = null
      if (opp.responseDeadLine) {
        try { responseDeadline = new Date(opp.responseDeadLine) } catch {}
      }

      const description = opp.description?.body || opp.description || ''

      const popState = opp.placeOfPerformance?.state?.code
        || opp.placeOfPerformance?.state?.name
        || opp.officeAddress?.state
        || null

      const naicsCode = opp.naicsCode || null
      const pscCode = opp.classificationCode || null

      await prisma.opportunity.upsert({
        where: { solicitationNumber: solNum },
        update: {
          title: opp.title || 'Untitled',
          description: typeof description === 'string' ? description.substring(0, 10000) : JSON.stringify(description).substring(0, 10000),
          naicsCode,
          pscCode,
          agency: opp.fullParentPathName || opp.organizationName || null,
          department: opp.department || null,
          state: popState,
          postedDate,
          responseDeadline,
          lastFetched: new Date(),
          status: 'ACTIVE',
          rawData: opp,
        },
        create: {
          solicitationNumber: solNum,
          title: opp.title || 'Untitled',
          description: typeof description === 'string' ? description.substring(0, 10000) : JSON.stringify(description).substring(0, 10000),
          naicsCode,
          pscCode,
          agency: opp.fullParentPathName || opp.organizationName || null,
          department: opp.department || null,
          state: popState,
          postedDate,
          responseDeadline,
          lastFetched: new Date(),
          status: 'ACTIVE',
          rawData: opp,
        },
      })

      saved++
      const deadline = responseDeadline ? responseDeadline.toLocaleDateString() : 'N/A'
      console.log(`  [${saved}] ${solNum} - ${opp.title?.substring(0, 60)}... (deadline: ${deadline})`)
    } catch (error) {
      errors++
      console.error(`  ERROR: ${opp.solicitationNumber}: ${error instanceof Error ? error.message : 'Unknown'}`)
    }
  }

  console.log(`\nDone: ${saved} saved, ${errors} errors`)

  const total = await prisma.opportunity.count()
  console.log(`Total opportunities in database: ${total}`)
}

fetchOpportunities()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
