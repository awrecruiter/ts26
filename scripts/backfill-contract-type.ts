import { PrismaClient } from '@prisma/client'
import { classifyContractType } from '../lib/opportunity-classification'

const prisma = new PrismaClient()

async function main() {
  const dryRun = process.argv.includes('--dry-run')

  const opps = await prisma.opportunity.findMany({
    where: { contractTypeOverride: false },
    select: {
      id: true,
      title: true,
      description: true,
      naicsCode: true,
      pscCode: true,
      contractType: true,
    },
  })

  const dist = { SERVICES: 0, PRODUCT: 0, changed: 0 }

  for (const opp of opps) {
    const { contractType, source } = classifyContractType({
      pscCode: opp.pscCode,
      naicsCode: opp.naicsCode,
      title: opp.title,
      description: opp.description,
    })
    dist[contractType]++
    const willChange = opp.contractType !== contractType
    if (willChange) dist.changed++
    if (!dryRun && willChange) {
      await prisma.opportunity.update({
        where: { id: opp.id },
        data: { contractType, contractTypeSource: source },
      })
    }
  }

  console.log(`Scanned ${opps.length} opportunities (override-free)`)
  console.log(`  SERVICES: ${dist.SERVICES}`)
  console.log(`  PRODUCT:  ${dist.PRODUCT}`)
  console.log(`  Would change: ${dist.changed}${dryRun ? ' (dry-run — nothing written)' : ' (written)'}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
