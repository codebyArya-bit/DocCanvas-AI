import { browserErrorResponse, keySession } from '../_lib'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { sessionId?: unknown; key?: unknown } | null
  try {
    const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : ''
    const key = typeof body?.key === 'string' ? body.key : 'Enter'
    if (!sessionId) return Response.json({ error: 'Browser session missing.' }, { status: 400 })
    return Response.json(await keySession(sessionId, key))
  } catch (error) {
    return browserErrorResponse(error)
  }
}
