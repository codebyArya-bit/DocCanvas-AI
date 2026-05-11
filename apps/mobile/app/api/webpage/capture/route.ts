import { NextResponse } from 'next/server'
import {
  extractReadableContent,
  parseAndValidateExternalUrl,
  WebpageImportError,
  withIsolatedPage
} from '../_lib'

const CAPTURE_ERROR = 'Couldn’t capture this page visually. Try Clean Text mode or another URL.'
const PDF_TIMEOUT_MS = 22000
const SCREENSHOT_TIMEOUT_MS = 9000

export const runtime = 'nodejs'

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { url?: unknown } | null
  const rawUrl = typeof body?.url === 'string' ? body.url : ''

  try {
    const startUrl = await parseAndValidateExternalUrl(rawUrl)
    const payload = await withIsolatedPage(startUrl.toString(), async (page) => {
      page.setDefaultTimeout(PDF_TIMEOUT_MS)
      await page.emulateMedia({ media: 'screen' })

      const title = (await page.title().catch(() => '')) || new URL(page.url()).hostname
      const renderedHtml = await page.content()
      const readable = extractReadableContent(renderedHtml, page.url())

      await page.addStyleTag({
        content: `
          header, nav, footer, aside,
          [role="banner"], [role="navigation"], [role="contentinfo"],
          .ads, .ad, .advertisement, .popup, .modal, .overlay,
          .cookie-banner, .cookie-consent, .newsletter, .login, .signin,
          .sticky, [class*="sticky"], [id*="cookie"], [class*="cookie"] {
            display: none !important;
            visibility: hidden !important;
          }
          body {
            margin-top: 0 !important;
            padding-top: 0 !important;
          }
          * {
            scroll-margin-top: 0 !important;
          }
        `
      }).catch(() => undefined)

      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        preferCSSPageSize: false,
        margin: {
          top: '6mm',
          right: '10mm',
          bottom: '8mm',
          left: '10mm'
        }
      })

      const thumbnailBuffer = await page
        .screenshot({
          type: 'png',
          fullPage: false,
          timeout: SCREENSHOT_TIMEOUT_MS
        })
        .catch(() => null)

      return {
        title,
        sourceUrl: startUrl.toString(),
        finalUrl: page.url(),
        bytesBase64: Buffer.from(pdfBuffer).toString('base64'),
        sanitizedHtml: readable?.sanitizedHtml,
        markdown: readable?.markdown,
        textContent: readable?.textContent,
        sections: readable?.sections ?? [],
        thumbnailDataUrl: thumbnailBuffer ? `data:image/png;base64,${Buffer.from(thumbnailBuffer).toString('base64')}` : null
      }
    })

    return NextResponse.json(payload)
  } catch (error) {
    if (error instanceof WebpageImportError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('Visual webpage capture failed', error)
    return NextResponse.json({ error: CAPTURE_ERROR }, { status: 500 })
  }
}
