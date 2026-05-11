import { browserErrorResponse, goBackSession, goForwardSession, navigateSession, normalizeNavigationInput, normalizeSearchEngine } from '../_lib'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    sessionId?: unknown
    target?: unknown
    action?: unknown
    searchEngine?: unknown
  } | null

  try {
    const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : ''
    if (!sessionId) return Response.json({ error: 'Browser session missing.' }, { status: 400 })
    if (body?.action === 'back') return Response.json(await goBackSession(sessionId))
    if (body?.action === 'forward') return Response.json(await goForwardSession(sessionId))
    const target = typeof body?.target === 'string' ? body.target : ''
    const searchEngine = normalizeSearchEngine(body?.searchEngine)
    return Response.json(await navigateSession(sessionId, normalizeNavigationInput(target, searchEngine)))
  } catch (error) {
    return browserErrorResponse(error)
  }
}
