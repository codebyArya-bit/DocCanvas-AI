import { NextResponse } from 'next/server'
import { extractReadableContentFromHtml, parseAndValidateExternalUrl, WebpageImportError } from '../_lib'

export const runtime = 'nodejs'

const IMPORT_ERROR = 'Couldn’t import this page from Chrome. Try again from the extension.'
const MAX_HTML_LENGTH = 1_500_000

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | {
        url?: unknown
        title?: unknown
        html?: unknown
      }
    | null

  const rawUrl = typeof body?.url === 'string' ? body.url : ''
  const title = typeof body?.title === 'string' ? body.title.trim() : ''
  const html = typeof body?.html === 'string' ? body.html : ''

  try {
    const url = await parseAndValidateExternalUrl(rawUrl)
    if (!html || html.length > MAX_HTML_LENGTH) {
      return NextResponse.json({ error: IMPORT_ERROR }, { status: 413 })
    }

    const imported = extractReadableContentFromHtml(html, url.toString(), title)
    if (!imported || !imported.textContent) {
      return NextResponse.json({ error: IMPORT_ERROR }, { status: 422 })
    }

    return NextResponse.json({
      sourceUrl: url.toString(),
      finalUrl: url.toString(),
      title: imported.title,
      sanitizedHtml: imported.sanitizedHtml,
      textContent: imported.textContent,
      markdown: imported.markdown,
      sections: imported.sections
    })
  } catch (error) {
    if (error instanceof WebpageImportError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('Chrome extension import failed', error)
    return NextResponse.json({ error: IMPORT_ERROR }, { status: 500 })
  }
}
