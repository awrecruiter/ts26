import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const newAdmin = 'ashleymariecwhite@gmail.com'
  const demoted = 'admin@1stdirectionco.com'

  const before = await prisma.user.findMany({
    where: { email: { in: [newAdmin, demoted] } },
    select: { email: true, role: true, name: true },
  })
  console.log('Before:')
  console.table(before)

  const ashley = await prisma.user.upsert({
    where: { email: newAdmin },
    update: { role: 'ADMIN' },
    create: { email: newAdmin, name: 'Ashley White', role: 'ADMIN' },
  })

  const oneFirst = await prisma.user.update({
    where: { email: demoted },
    data: { role: 'AGENT' },
  })

  console.log('\nAfter:')
  console.table([
    { email: ashley.email, role: ashley.role },
    { email: oneFirst.email, role: oneFirst.role },
  ])
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    void prisma.$disconnect()
  })
