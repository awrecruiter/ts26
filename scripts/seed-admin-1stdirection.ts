import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const email = 'admin@1stdirectionco.com'

  const user = await prisma.user.upsert({
    where: { email },
    update: { role: 'ADMIN' },
    create: {
      email,
      name: '1st Direction Admin',
      role: 'ADMIN',
    },
  })

  console.log('email:', user.email)
  console.log('role: ', user.role)
  console.log('id:   ', user.id)
  console.log('created:', user.createdAt.toISOString())
  console.log('\nSign-in: must use "Sign in with Google" (no password set).')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
