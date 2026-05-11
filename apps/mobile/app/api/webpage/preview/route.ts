import { NextResponse } from 'next/server'
import {
  parseAndValidateExternalUrl,
  renderSanitizedHtml,
  WebpageImportError,
  withIsolatedPage
} from '../_lib'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { url?: unknown } | null
  const rawUrl = typeof body?.url === 'string' ? body.url : ''

  try {
    const startUrl = await parseAndValidateExternalUrl(rawUrl)
    const payload = await withIsolatedPage(startUrl.toString(), async (page) => {
      const finalUrl = page.url()
      const title = (await page.title().catch(() => '')) || new URL(finalUrl).hostname
      const pageText = await page.locator('body').innerText({ timeout: 1500 }).catch(() => '')

      if (isGoogleAutomationBlock(finalUrl, pageText)) {
        return {
          mode: 'blocked' as const,
          sourceUrl: startUrl.toString(),
          finalUrl,
          title,
          reason: 'Google blocked automated preview. Open in Chrome, then import the active tab with the Docu Mind extension.'
        }
      }

      const sanitizedHtml = await renderSanitizedHtml(page)
      if (sanitizedHtml.trim().length >= 200) {
        return {
          mode: 'html' as const,
          sourceUrl: startUrl.toString(),
          finalUrl,
          title,
          sanitizedHtml
        }
      }

      const screenshot = await page
        .screenshot({
          type: 'png',
          fullPage: false,
          timeout: 9000
        })
        .catch(() => null)

      if (screenshot) {
        return {
          mode: 'screenshot' as const,
          sourceUrl: startUrl.toString(),
          finalUrl,
          title,
          screenshotDataUrl: `data:image/png;base64,${Buffer.from(screenshot).toString('base64')}`
        }
      }

      return {
        mode: 'blocked' as const,
        sourceUrl: startUrl.toString(),
        finalUrl,
        title,
        reason: 'Preview is unavailable for this page. Import can still run in isolated mode.'
      }
    })

    return NextResponse.json(payload)
  } catch (error) {
    if (error instanceof WebpageImportError) {
      return NextResponse.json({ mode: 'blocked', reason: error.message }, { status: error.status })
    }
    console.error('Webpage preview failed', error)
    return NextResponse.json({ mode: 'error', error: 'Couldn’t load preview. Try another URL.' }, { status: 500 })
  }
}

function isGoogleAutomationBlock(finalUrl: string, pageText: string) {
  try {
    const url = new URL(finalUrl)
    const host = url.hostname.toLowerCase()
    if (!/(^|\.)google\./i.test(host)) return false
    if (url.pathname.startsWith('/sorry')) return true
    return /unusual traffic|not a robot|automated requests/i.test(pageText)
  } catch {
    return /unusual traffic|not a robot|automated requests/i.test(pageText)
  }
}
