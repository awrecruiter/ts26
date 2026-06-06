import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function repair() {
  console.log('Scanning opportunities for misclassified NAICS codes...\n')

  const all = await prisma.opportunity.findMany({
    select: { id: true, solicitationNumber: true, title: true, naicsCode: true, pscCode: true },
  })

  const misclassified = all.filter((o) => o.naicsCode && /^\d{4}$/.test(o.naicsCode))

  console.log(`Total opportunities: ${all.length}`)
  console.log(`Misclassified (4-digit naicsCode): ${misclassified.length}\n`)

  let repaired = 0
  for (const o of misclassified) {
    const movePsc = o.pscCode === null
    await prisma.opportunity.update({
      where: { id: o.id },
      data: {
        naicsCode: null,
        ...(movePsc ? { pscCode: o.naicsCode } : {}),
      },
    })
    repaired++
    console.log(`  [${repaired}] ${o.solicitationNumber} — NAICS "${o.naicsCode}" → ${movePsc ? `PSC "${o.naicsCode}"` : 'cleared (PSC already set)'}`)
  }

  console.log(`\nDone. Repaired ${repaired} row${repaired === 1 ? '' : 's'}.`)
}

repair()
  .catch((err) => { console.error(err); process.exit(1) })
  .finally(() => prisma.$disconnect())
