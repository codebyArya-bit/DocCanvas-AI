import { NextResponse } from 'next/server'
import {
  extractReadableContent,
  parseAndValidateExternalUrl,
  WebpageImportError,
  withIsolatedPage
} from '../_lib'

export const runtime = 'nodejs'

const IMPORT_ERROR = 'Couldn’t import this page. Try another URL.'

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { url?: unknown } | null
  const rawUrl = typeof body?.url === 'string' ? body.url : ''

  try {
    const startUrl = await parseAndValidateExternalUrl(rawUrl)
    const imported = await withIsolatedPage(startUrl.toString(), async (page) => {
      const renderedHtml = await page.content()
      const readable = extractReadableContent(renderedHtml, page.url())
      if (!readable) return null

      return {
        sourceUrl: startUrl.toString(),
        finalUrl: page.url(),
        title: readable.title,
        sanitizedHtml: readable.sanitizedHtml,
        textContent: readable.textContent,
        markdown: readable.markdown,
        sections: readable.sections
      }
    })

    if (!imported || !imported.textContent) {
      return NextResponse.json({ error: IMPORT_ERROR }, { status: 422 })
    }

    return NextResponse.json(imported)
  } catch (error) {
    if (error instanceof WebpageImportError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    if (error instanceof Error && error.name === 'AbortError') {
      return NextResponse.json({ error: 'Import canceled.' }, { status: 408 })
    }
    console.error('Clean webpage import failed', error)
    return NextResponse.json({ error: IMPORT_ERROR }, { status: 500 })
  }
}
