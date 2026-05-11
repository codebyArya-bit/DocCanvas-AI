import { createBrowserSession, homeUrlFor, normalizeSearchEngine, previewSession, browserErrorResponse } from '../_lib'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { searchEngine?: unknown } | null
  try {
    const searchEngine = normalizeSearchEngine(body?.searchEngine)
    const session = await createBrowserSession(homeUrlFor(searchEngine))
    return Response.json(await previewSession(session.id))
  } catch (error) {
    return browserErrorResponse(error)
  }
}
