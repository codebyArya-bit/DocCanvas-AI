import { browserErrorResponse, navigateSession, normalizeSearchEngine, searchUrlFor } from '../_lib'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    sessionId?: unknown
    query?: unknown
    searchEngine?: unknown
  } | null

  try {
    const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : ''
    const query = typeof body?.query === 'string' ? body.query : ''
    if (!sessionId) return Response.json({ error: 'Browser session missing.' }, { status: 400 })
    if (!query.trim()) return Response.json({ error: 'Search query missing.' }, { status: 400 })
    const searchEngine = normalizeSearchEngine(body?.searchEngine)
    return Response.json(await navigateSession(sessionId, searchUrlFor(query, searchEngine)))
  } catch (error) {
    return browserErrorResponse(error)
  }
}
