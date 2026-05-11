import { browserErrorResponse, scrollSession } from '../_lib'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    sessionId?: unknown
    deltaX?: unknown
    deltaY?: unknown
  } | null
  try {
    const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : ''
    const deltaX = typeof body?.deltaX === 'number' ? body.deltaX : 0
    const deltaY = typeof body?.deltaY === 'number' ? body.deltaY : 0
    if (!sessionId) return Response.json({ error: 'Browser session missing.' }, { status: 400 })
    return Response.json(await scrollSession(sessionId, deltaX, deltaY))
  } catch (error) {
    return browserErrorResponse(error)
  }
}
