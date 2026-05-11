import { browserErrorResponse, importSession } from '../_lib'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { sessionId?: unknown } | null
  try {
    const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : ''
    if (!sessionId) return Response.json({ error: 'Browser session missing.' }, { status: 400 })
    return Response.json(await importSession(sessionId))
  } catch (error) {
    return browserErrorResponse(error)
  }
}
