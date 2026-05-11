import { browserErrorResponse, clickSession } from '../_lib'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { sessionId?: unknown; x?: unknown; y?: unknown } | null
  try {
    const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : ''
    const x = typeof body?.x === 'number' ? body.x : Number.NaN
    const y = typeof body?.y === 'number' ? body.y : Number.NaN
    if (!sessionId) return Response.json({ error: 'Browser session missing.' }, { status: 400 })
    return Response.json(await clickSession(sessionId, x, y))
  } catch (error) {
    return browserErrorResponse(error)
  }
}
