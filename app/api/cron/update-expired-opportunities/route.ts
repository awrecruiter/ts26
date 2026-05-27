import { NextResponse } from 'next/server'

export async function GET(req: Request) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // TODO: mark past-deadline opportunities as expired
  return NextResponse.json({ ok: true })
}
