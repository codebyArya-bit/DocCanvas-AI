import { browserErrorResponse, previewSession } from '../_lib'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const sessionId = url.searchParams.get('sessionId') ?? ''
    if (!sessionId) return Response.json({ error: 'Browser session missing.' }, { status: 400 })
    return Response.json(await previewSession(sessionId))
  } catch (error) {
    return browserErrorResponse(error)
  }
}
