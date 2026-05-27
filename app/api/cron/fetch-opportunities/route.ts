import { NextResponse } from 'next/server'

export async function GET(req: Request) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // TODO: trigger SAM.gov opportunity fetch and sync
  return NextResponse.json({ ok: true })
}
