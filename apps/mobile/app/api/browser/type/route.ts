import { browserErrorResponse, typeSession } from '../_lib'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { sessionId?: unknown; text?: unknown } | null
  try {
    const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : ''
    const text = typeof body?.text === 'string' ? body.text : ''
    if (!sessionId) return Response.json({ error: 'Browser session missing.' }, { status: 400 })
    if (!text) return Response.json({ error: 'Text missing.' }, { status: 400 })
    return Response.json(await typeSession(sessionId, text))
  } catch (error) {
    return browserErrorResponse(error)
  }
}
