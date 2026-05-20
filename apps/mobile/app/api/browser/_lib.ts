import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import {
  extractReadableContent,
  parseAndValidateExternalUrl,
  WebpageImportError
} from '../webpage/_lib'

export const SESSION_TTL_MS = 10 * 60 * 1000
export const MAX_SESSION_PAGES = 1
export const MAX_NAVIGATION_TIME_MS = 30_000
export const MAX_IMPORT_TIME_MS = 60_000

const SCREENSHOT_TIMEOUT_MS = 6_000
const INTERACTION_SETTLE_MS = 50
const INITIAL_PAGE_SETTLE_MS = 100
const NAVIGATION_SETTLE_TIMEOUT_MS = 400
const PREVIEW_JPEG_QUALITY = 35
const PREVIEW_CACHE_MAX_AGE_MS = 200
const DEFAULT_BROWSER_LOCALE = 'en-US'
const DEFAULT_ACCEPT_LANGUAGE = 'en-US,en;q=0.9'
const GOOGLE_BLOCK_PATTERN = /unusual traffic|not a robot|automated requests|about this page/i

type BrowserPreviewSnapshot = Omit<BrowserPreview, 'sessionId'> & { capturedAt: number }

type BrowserSession = {
  id: string
  browser: Browser
  context: BrowserContext
  page: Page
  createdAt: number
  lastUsedAt: number
  previewCache: BrowserPreviewSnapshot | null
}

const browserSessionGlobal = globalThis as typeof globalThis & {
  __documindBrowserSessions?: Map<string, BrowserSession>
  __documindSharedBrowserPromise?: Promise<Browser>
}
const sessions = browserSessionGlobal.__documindBrowserSessions ?? new Map<string, BrowserSession>()
browserSessionGlobal.__documindBrowserSessions = sessions

export async function getSharedBrowser() {
  const launchOptions = {
    headless: true,
    timeout: 15_000, // Reduced from 30s to 15s
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu',
      '--disable-extensions',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-breakpad',
      '--disable-component-extensions-with-background-pages',
      '--disable-features=TranslateUI,BlinkGenPropertyTrees,CalculateNativeWinOcclusion',
      '--disable-ipc-flooding-protection',
      '--disable-renderer-backgrounding',
      '--enable-features=NetworkService,NetworkServiceInProcess',
      '--force-color-profile=srgb',
      '--metrics-recording-only',
      '--no-experiments',
      '--no-pings',
      '--no-zygote',
      '--use-mock-keychain',
      '--disable-software-rasterizer',
      '--disable-features=VizDisplayCompositor',
      '--disable-features=AudioServiceOutOfProcess',
      '--disable-back-forward-cache',
      '--disable-features=BackForwardCache',
      '--disable-features=PaintHolding',
      '--disable-features=InterestCohortAPI',
      '--disable-features=LazyFrameLoading',
      '--disable-features=GlobalMediaControls',
      '--disable-features=MediaRouter',
      '--disable-features=OptimizationHints',
      '--disable-features=PasswordImport',
      '--disable-features=PrivacySandboxAdsAPIsOverride',
      '--disable-features=Translate',
      '--disable-features=UserAgentClientHint',
      '--disable-features=WebAuthenticationCable',
      '--disable-features=WebBluetooth',
      '--disable-features=WebGPU',
      '--disable-features=WebNFC',
      '--disable-features=WebUSB',
      '--disable-features=WebXR',
      '--js-flags=--max-old-space-size=256',
    ]
  }

  // Background warm-up: Start browser initialization in background if not already started
  if (!browserSessionGlobal.__documindSharedBrowserPromise) {
    // Start browser launch in background without awaiting
    browserSessionGlobal.__documindSharedBrowserPromise = chromium.launch(launchOptions).catch((error) => {
      browserSessionGlobal.__documindSharedBrowserPromise = undefined
      console.error('Browser launch failed:', error)
      throw error
    })
    
    // Add a small delay to allow background initialization to start
    // but don't block the main thread
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  
  const browser = await browserSessionGlobal.__documindSharedBrowserPromise
  
  if (!browser.isConnected()) {
    // Browser disconnected, create new one
    browserSessionGlobal.__documindSharedBrowserPromise = chromium.launch(launchOptions).catch((error) => {
      browserSessionGlobal.__documindSharedBrowserPromise = undefined
      throw error
    })
    return browserSessionGlobal.__documindSharedBrowserPromise
  }
  
  return browser
}

export type BrowserPreview = {
  sessionId: string
  url: string
  title: string
  screenshotDataUrl: string | null
  blocked?: boolean
  reason?: string
}

export function normalizeSearchEngine(value: unknown) {
  return value === 'bing' || value === 'google' || value === 'duckduckgo' ? value : 'bing'
}

export function searchUrlFor(query: string, engine: 'duckduckgo' | 'bing' | 'google') {
  const encoded = encodeURIComponent(query.trim())
  if (!encoded) return homeUrlFor(engine)
  if (engine === 'bing') return `https://www.bing.com/search?q=${encoded}&mkt=en-US&setlang=en-US&cc=US&ensearch=1`
  if (engine === 'google') return `https://www.google.com/search?q=${encoded}&hl=en&gl=US`
  return `https://duckduckgo.com/?q=${encoded}&kl=us-en`
}

export function shouldReusePreviewCache(
  cached: BrowserPreviewSnapshot | null,
  url: string,
  now: number,
  maxAgeMs = PREVIEW_CACHE_MAX_AGE_MS
) : cached is BrowserPreviewSnapshot {
  return Boolean(cached && cached.url === url && now - cached.capturedAt <= maxAgeMs)
}

export function safeDefineBrowserProperty(
  target: unknown,
  property: PropertyKey,
  descriptor: PropertyDescriptor
) {
  if ((typeof target !== 'object' && typeof target !== 'function') || target === null) return false
  try {
    Object.defineProperty(target, property, descriptor)
    return true
  } catch {
    return false
  }
}

export function homeUrlFor(engine: 'duckduckgo' | 'bing' | 'google') {
  if (engine === 'bing') return 'https://www.bing.com/?mkt=en-US&setlang=en-US&cc=US&ensearch=1'
  if (engine === 'google') return 'https://www.google.com/?hl=en&gl=US'
  return 'https://duckduckgo.com/?kl=us-en'
}

export function normalizeNavigationInput(value: string, engine: 'duckduckgo' | 'bing' | 'google') {
  const trimmed = value.trim()
  if (!trimmed) return homeUrlFor(engine)
  const searchQuery = extractSearchQuery(trimmed)
  if (searchQuery && !(engine === 'google' && isGoogleSearchUrl(trimmed))) {
    return searchUrlFor(searchQuery, engine)
  }
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  if (/^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(trimmed)) return `https://${trimmed}`
  return searchUrlFor(trimmed, engine)
}

export function extractSearchQuery(value: string) {
  try {
    const url = new URL(value)
    const host = url.hostname.toLowerCase()
    const isSearchHost =
      /(^|\.)google\./i.test(host) ||
      host === 'www.bing.com' ||
      host === 'bing.com' ||
      host === 'duckduckgo.com' ||
      host === 'www.duckduckgo.com'
    const pathLooksSearch =
      url.pathname.startsWith('/search') ||
      url.pathname === '/' ||
      url.pathname === ''
    if (!isSearchHost || !pathLooksSearch) return null
    return url.searchParams.get('q')?.trim() || null
  } catch {
    return null
  }
}

export async function createBrowserSession(startUrl: string) {
  cleanupExpiredSessions()
  const safeStartUrl = await parseAndValidateExternalUrl(startUrl)
  const browser = await getSharedBrowser()
  const context = await browser.newContext({
    viewport: { width: 1280, height: 820 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
    ignoreHTTPSErrors: false,
    locale: DEFAULT_BROWSER_LOCALE,
    extraHTTPHeaders: {
      'accept-language': DEFAULT_ACCEPT_LANGUAGE
    }
  })
  await context.addInitScript(() => {
    const language = 'en-US'
    const languages = ['en-US', 'en']
    const safeDefine = (target: unknown, property: PropertyKey, descriptor: PropertyDescriptor) => {
      if ((typeof target !== 'object' && typeof target !== 'function') || target === null) return
      try {
        Object.defineProperty(target, property, descriptor)
      } catch {}
    }
    const nav = globalThis.navigator
    safeDefine(nav, 'language', {
      configurable: true,
      get: () => language
    })
    safeDefine(nav, 'languages', {
      configurable: true,
      get: () => languages
    })
    safeDefine(nav, 'webdriver', {
      configurable: true,
      get: () => false
    })
    // Mock chrome object to avoid basic bot detection
    ;(window as Window & { chrome?: { runtime: Record<string, never> } }).chrome = {
      runtime: {}
    }
  })
  const page = await context.newPage()
  page.setDefaultNavigationTimeout(MAX_NAVIGATION_TIME_MS)
  page.setDefaultTimeout(MAX_NAVIGATION_TIME_MS)
  await installSafetyRoute(context)
  const session: BrowserSession = {
    id: crypto.randomUUID(),
    browser,
    context,
    page,
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
    previewCache: null
  }
  sessions.set(session.id, session)
  try {
    await loadInitialSessionPage(session, safeStartUrl.toString())
    return session
  } catch (error) {
    await closeBrowserSession(session.id)
    throw error
  }
}

export async function getBrowserSession(sessionId: string) {
  cleanupExpiredSessions()
  const session = sessions.get(sessionId)
  if (!session) throw new WebpageImportError('Browser session expired. Start a new search.', 410)
  session.lastUsedAt = Date.now()
  const pages = session.context.pages()
  await Promise.all(pages.slice(MAX_SESSION_PAGES).map((page) => page.close().catch(() => undefined)))
  return session
}

export async function navigateSession(sessionId: string, targetUrl: string) {
  const session = await getBrowserSession(sessionId)
  const safeUrl = await parseAndValidateExternalUrl(targetUrl)
  await session.page.goto(safeUrl.toString(), { waitUntil: 'domcontentloaded', timeout: MAX_NAVIGATION_TIME_MS })
  // Skip networkidle wait — domcontentloaded is sufficient for screenshot preview
  session.lastUsedAt = Date.now()
  return previewSession(session.id)
}

async function loadInitialSessionPage(session: BrowserSession, targetUrl: string) {
  await session.page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: MAX_NAVIGATION_TIME_MS })
  await session.page.waitForTimeout(INITIAL_PAGE_SETTLE_MS).catch(() => undefined)
  session.lastUsedAt = Date.now()
}

export async function goBackSession(sessionId: string) {
  const session = await getBrowserSession(sessionId)
  await session.page.goBack({ waitUntil: 'domcontentloaded', timeout: MAX_NAVIGATION_TIME_MS }).catch(() => undefined)
  // No networkidle on history navigation — avoids 5 s stall on SPAs
  session.lastUsedAt = Date.now()
  return previewSession(session.id)
}

export async function goForwardSession(sessionId: string) {
  const session = await getBrowserSession(sessionId)
  await session.page.goForward({ waitUntil: 'domcontentloaded', timeout: MAX_NAVIGATION_TIME_MS }).catch(() => undefined)
  // No networkidle on history navigation — avoids 5 s stall on SPAs
  session.lastUsedAt = Date.now()
  return previewSession(session.id)
}

export async function clickSession(sessionId: string, x: number, y: number) {
  const session = await getBrowserSession(sessionId)
  
  // Validate and clamp coordinates
  const safeX = clampCoordinate(x, 0, 1280)
  const safeY = clampCoordinate(y, 0, 820)
  
  console.log(`[Browser] Click at coordinates: ${safeX}, ${safeY} (original: ${x}, ${y})`)
  
  // Check for clickable links at the point
  const href = await hrefAtPoint(session.page, safeX, safeY)
  if (href) {
    console.log(`[Browser] Found clickable link: ${href}`)
    return navigateSession(session.id, href)
  }
  
  const beforeUrl = session.page.url()
  
  // Try to focus element at point first for better interaction
  try {
    await focusElementAtPoint(session.page, safeX, safeY)
  } catch (error) {
    console.warn(`[Browser] Focus element failed:`, error)
    // Continue anyway - focus is not critical
  }
  
  // Perform the click with retry logic
  let clickSuccess = false
  let retryCount = 0
  const maxRetries = 3
  let lastError: Error | null = null
  
  while (!clickSuccess && retryCount < maxRetries) {
    try {
      if (retryCount > 0) {
        console.log(`[Browser] Click retry attempt ${retryCount + 1}`)
        // Small delay before retry
        await session.page.waitForTimeout(100)
      }
      
      await session.page.mouse.click(safeX, safeY, {
        delay: 50, // Add small delay for more realistic click
        button: 'left'
      })
      
      clickSuccess = true
      console.log(`[Browser] Click successful`)
    } catch (error) {
      console.error(`[Browser] Click failed on attempt ${retryCount + 1}:`, error)
      lastError = error as Error
      retryCount++
      
      if (retryCount >= maxRetries) {
        // Last resort: try moving mouse and clicking
        try {
          await session.page.mouse.move(safeX, safeY)
          await session.page.mouse.down()
          await session.page.waitForTimeout(50)
          await session.page.mouse.up()
          clickSuccess = true
          console.log(`[Browser] Fallback click successful`)
        } catch (fallbackError) {
          console.error(`[Browser] Fallback click also failed:`, fallbackError)
        }
      }
    }
  }
  
  if (!clickSuccess && lastError) {
    console.error(`[Browser] All click attempts failed`)
    throw new Error(`Click failed at coordinates (${safeX}, ${safeY}): ${lastError.message}`)
  }
  
  // Check if navigation occurred
  const navigated = session.page.url() !== beforeUrl
  console.log(`[Browser] Navigation occurred: ${navigated} (before: ${beforeUrl}, after: ${session.page.url()})`)
  
  await waitForInteractionSettle(session.page, navigated)
  return previewSession(session.id, { allowCachedScreenshot: !navigated })
}

export async function scrollSession(sessionId: string, deltaX: number, deltaY: number) {
  const session = await getBrowserSession(sessionId)
  await session.page.mouse.wheel(clampDelta(deltaX), clampDelta(deltaY))
  await waitForInteractionSettle(session.page, false)
  return previewSession(session.id, { allowCachedScreenshot: true })
}

export async function typeSession(sessionId: string, text: string) {
  const session = await getBrowserSession(sessionId)
  await ensureEditableFocus(session.page)
  await insertTextIntoFocusedEditable(session.page, text.slice(0, 500))
  await waitForInteractionSettle(session.page, false)
  return previewSession(session.id, { allowCachedScreenshot: true })
}

export async function keySession(sessionId: string, key: string) {
  const session = await getBrowserSession(sessionId)
  const safeKey = normalizeBrowserKey(key)
  await session.page.keyboard.press(safeKey)
  let expectsNavigation = safeKey === 'Enter'
  if (safeKey === 'Enter') {
    const fallbackSearchUrl = await readFocusedSearchUrl(session.page)
    if (fallbackSearchUrl) {
      await session.page.goto(fallbackSearchUrl, { waitUntil: 'domcontentloaded', timeout: MAX_NAVIGATION_TIME_MS }).catch(() => undefined)
      expectsNavigation = true
    }
  }
  await waitForInteractionSettle(session.page, expectsNavigation)
  return previewSession(session.id, { allowCachedScreenshot: !expectsNavigation })
}

export async function previewSession(
  sessionId: string,
  options: { allowCachedScreenshot?: boolean } = {}
): Promise<BrowserPreview> {
  const session = await getBrowserSession(sessionId)
  const url = session.page.url()
  const cached = session.previewCache
  const now = Date.now()

  if (options.allowCachedScreenshot && shouldReusePreviewCache(cached, url, now)) {
    return {
      sessionId: session.id,
      ...cached
    }
  }

  const title = (await session.page.title().catch(() => '')) || new URL(url).hostname
  const pageText = shouldProbeBlockText(url)
    ? await session.page.evaluate(() => document.body?.innerText?.slice(0, 4000) ?? '').catch(() => '')
    : ''
  const blocked = isAutomatedBlockPage(url, pageText)
  const screenshot = blocked
    ? null
    : await session.page
        .screenshot({
          type: 'jpeg',
          quality: PREVIEW_JPEG_QUALITY,
          fullPage: false,
          scale: 'device', // Use device scale for consistent dimensions
          timeout: SCREENSHOT_TIMEOUT_MS
        })
        .catch(() => null)

  const snapshot: BrowserPreviewSnapshot = {
    url,
    title,
    screenshotDataUrl: screenshot ? `data:image/jpeg;base64,${Buffer.from(screenshot).toString('base64')}` : null,
    blocked,
    reason: blocked ? 'Automated browser block detected. This page cannot be imported.' : undefined,
    capturedAt: now
  }
  session.previewCache = snapshot

  return {
    sessionId: session.id,
    ...snapshot
  }
}

export async function importSession(sessionId: string) {
  const session = await getBrowserSession(sessionId)
  const page = session.page
  const finalUrl = page.url()
  const pageText = await page.locator('body').innerText({ timeout: 2000 }).catch(() => '')
  if (isAutomatedBlockPage(finalUrl, pageText)) {
    throw new WebpageImportError('Automated browser block detected. Choose another result.', 409)
  }

  await removePageChrome(page)
  const title = (await page.title().catch(() => '')) || new URL(finalUrl).hostname
  const renderedHtml = await page.content()
  const readable = extractReadableContent(renderedHtml, finalUrl)
  const pdfBuffer = await withTimeout(
    page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: false,
      margin: { top: '6mm', right: '10mm', bottom: '8mm', left: '10mm' }
    }),
    MAX_IMPORT_TIME_MS
  ).catch(() => null)
  const thumbnailBuffer = await page
    .screenshot({ type: 'jpeg', quality: 70, fullPage: false, timeout: SCREENSHOT_TIMEOUT_MS })
    .catch(() => null)

  await closeBrowserSession(sessionId)
  if (!pdfBuffer && !readable?.textContent) {
    throw new WebpageImportError('Could not capture this page. Choose another result.', 422)
  }
  return {
    sourceUrl: finalUrl,
    finalUrl,
    title: readable?.title || title,
    bytesBase64: pdfBuffer ? Buffer.from(pdfBuffer).toString('base64') : undefined,
    thumbnailDataUrl: thumbnailBuffer ? `data:image/jpeg;base64,${Buffer.from(thumbnailBuffer).toString('base64')}` : null,
    sanitizedHtml: readable?.sanitizedHtml,
    markdown: readable?.markdown,
    textContent: readable?.textContent,
    sections: readable?.sections ?? []
  }
}

export async function closeBrowserSession(sessionId: string) {
  const session = sessions.get(sessionId)
  if (!session) return
  sessions.delete(sessionId)
  await session.context.close().catch(() => undefined)
}

export function browserErrorResponse(error: unknown) {
  if (error instanceof WebpageImportError) {
    return Response.json({ error: error.message }, { status: error.status })
  }
  console.error('Browser session failed', error)
  return Response.json({ error: 'Browser action failed. Try another URL.' }, { status: 500 })
}

async function installSafetyRoute(context: BrowserContext) {
  await context.route('**/*', async (route) => {
    try {
      const requestUrl = route.request().url()
      await parseAndValidateExternalUrl(requestUrl)
      await route.continue()
    } catch {
      await route.abort('blockedbyclient').catch(() => undefined)
    }
  })
}

async function removePageChrome(page: Page) {
  await page.addStyleTag({
    content: `
      header, nav, footer, aside,
      [role="banner"], [role="navigation"], [role="contentinfo"],
      .ads, .ad, .advertisement, .popup, .modal, .overlay, .paywall,
      .cookie-banner, .cookie-consent, .newsletter, .login, .signin,
      .chat, .intercom, .sticky, [class*="sticky"], [id*="cookie"], [class*="cookie"] {
        display: none !important;
        visibility: hidden !important;
      }
      * {
        scroll-margin-top: 0 !important;
      }
      body {
        margin-top: 0 !important;
        padding-top: 0 !important;
      }
    `
  }).catch(() => undefined)

  await page.evaluate(() => {
    const blocked = ['fixed', 'sticky']
    document.querySelectorAll<HTMLElement>('*').forEach((node) => {
      const style = window.getComputedStyle(node)
      const text = `${node.id} ${node.className}`.toLowerCase()
      if (
        blocked.includes(style.position) ||
        /cookie|gdpr|consent|subscribe|newsletter|paywall|modal|popup|chat|ad-|ads/.test(text)
      ) {
        node.remove()
      }
    })
  }).catch(() => undefined)
}

async function focusElementAtPoint(page: Page, x: number, y: number) {
  await page.evaluate(
    ({ x, y }) => {
      const target = document.elementFromPoint(x, y) as HTMLElement | null
      const editable = target?.closest('input, textarea, [contenteditable="true"]') as HTMLElement | null
      editable?.focus()
      editable?.click()
    },
    { x, y }
  ).catch(() => undefined)
}

async function hrefAtPoint(page: Page, x: number, y: number) {
  const exactHref = await page.evaluate(
    ({ x, y }) => {
      const target = document.elementFromPoint(x, y) as HTMLElement | null
      const anchor = findActionableAnchor(target, x, y)
      if (!anchor) return null
      return toTargetHref(anchor.getAttribute('href') ?? '')

      function findActionableAnchor(target: HTMLElement | null, x: number, y: number) {
        const direct = target?.closest('a[href]') as HTMLAnchorElement | null
        const directHref = direct ? new URL(direct.getAttribute('href') ?? '', window.location.href).toString() : ''
        if (direct && isActionableHref(directHref)) return direct

        const resultContainer = target?.closest('li.b_algo, .b_algo, [data-bm], article, [role="article"], .result') as HTMLElement | null
        const links = Array.from(resultContainer?.querySelectorAll<HTMLAnchorElement>('a[href]') ?? [])
        const visibleLinks = links
          .map((entry) => {
            const rect = entry.getBoundingClientRect()
            const href = new URL(entry.getAttribute('href') ?? '', window.location.href).toString()
            if (rect.width <= 8 || rect.height <= 8 || !isActionableHref(href)) return null
            const verticalDistance = y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0
            const horizontalDistance = x < rect.left ? rect.left - x : x > rect.right ? x - rect.right : 0
            return { anchor: entry, distance: verticalDistance * 1.8 + horizontalDistance }
          })
          .filter(Boolean) as Array<{ anchor: HTMLAnchorElement; distance: number }>
        visibleLinks.sort((left, right) => left.distance - right.distance)
        return visibleLinks[0]?.anchor ?? null
      }

      function isActionableHref(href: string) {
        if (!href || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) return false
        try {
          const url = new URL(href)
          return /^https?:$/.test(url.protocol)
        } catch {
          return false
        }
      }

      function toTargetHref(href: string) {
        const url = new URL(href, window.location.href)
        const bingTarget = decodeBingTarget(url)
        return bingTarget ?? url.toString()
      }

      function decodeBingTarget(url: URL) {
        if (!/(^|\.)bing\.com$/i.test(url.hostname)) return null
        const encoded = url.searchParams.get('u')
        if (!encoded) return null
        const payload = encoded.startsWith('a1') ? encoded.slice(2) : encoded
        try {
          const padded = payload.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payload.length / 4) * 4, '=')
          const decoded = atob(padded)
          return /^https?:\/\//i.test(decoded) ? decoded : null
        } catch {
          return null
        }
      }
    },
    { x, y }
  ).catch(() => null)
  if (exactHref) return exactHref

  return page.evaluate(
    ({ x, y }) => {
      const padding = 46
      const candidates = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))
        .map((anchor) => {
          const rect = anchor.getBoundingClientRect()
          const inside =
            rect.width > 8 &&
            rect.height > 8 &&
            x >= rect.left - padding &&
            x <= rect.right + padding &&
            y >= rect.top - padding &&
            y <= rect.bottom + padding
          if (!inside) return null
          const href = toTargetHref(anchor.getAttribute('href') ?? '')
          if (!isActionableHref(href)) return null
          const verticalDistance = y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0
          const horizontalDistance = x < rect.left ? rect.left - x : x > rect.right ? x - rect.right : 0
          return { href, distance: verticalDistance * 1.8 + horizontalDistance }
        })
        .filter(Boolean) as Array<{ href: string; distance: number }>
      candidates.sort((left, right) => left.distance - right.distance)
      return candidates[0]?.href ?? null

      function isActionableHref(href: string) {
        if (!href || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) return false
        try {
          const url = new URL(href)
          if (!/^https?:$/.test(url.protocol)) return false
          if (/bing\.com$/i.test(url.hostname) && /\/(images|videos|maps|news|shop|translator|account|profile|rewards)/i.test(url.pathname)) return false
          return true
        } catch {
          return false
        }
      }

      function toTargetHref(href: string) {
        const url = new URL(href, window.location.href)
        const bingTarget = decodeBingTarget(url)
        return bingTarget ?? url.toString()
      }

      function decodeBingTarget(url: URL) {
        if (!/(^|\.)bing\.com$/i.test(url.hostname)) return null
        const encoded = url.searchParams.get('u')
        if (!encoded) return null
        const payload = encoded.startsWith('a1') ? encoded.slice(2) : encoded
        try {
          const padded = payload.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payload.length / 4) * 4, '=')
          const decoded = atob(padded)
          return /^https?:\/\//i.test(decoded) ? decoded : null
        } catch {
          return null
        }
      }
    },
    { x, y }
  ).catch(() => null)
}

async function ensureEditableFocus(page: Page) {
  const hasEditableFocus = await page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null
    if (!active) return false
    const tag = active.tagName.toLowerCase()
    return tag === 'input' || tag === 'textarea' || active.isContentEditable
  }).catch(() => false)
  if (hasEditableFocus) return
  await page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll<HTMLElement>(
      'input[name="q"], textarea[name="q"], input[type="search"], input[aria-label*="Search" i], textarea[aria-label*="Search" i], input'
    ))
    const visible = candidates.find((node) => {
      const rect = node.getBoundingClientRect()
      const style = window.getComputedStyle(node)
      return rect.width > 80 && rect.height > 18 && style.visibility !== 'hidden' && style.display !== 'none'
    })
    visible?.focus()
    visible?.click()
  }).catch(() => undefined)
}

async function insertTextIntoFocusedEditable(page: Page, text: string) {
  const inserted = await page.evaluate((text) => {
    const active = document.activeElement as HTMLInputElement | HTMLTextAreaElement | HTMLElement | null
    if (!active) return false
    const tag = active.tagName.toLowerCase()
    if (tag === 'input' || tag === 'textarea') {
      const control = active as HTMLInputElement | HTMLTextAreaElement
      const start = typeof control.selectionStart === 'number' ? control.selectionStart : control.value.length
      const end = typeof control.selectionEnd === 'number' ? control.selectionEnd : control.value.length
      control.value = `${control.value.slice(0, start)}${text}${control.value.slice(end)}`
      const nextCursor = start + text.length
      control.setSelectionRange(nextCursor, nextCursor)
      control.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }))
      control.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    }
    if (active.isContentEditable) {
      active.textContent = `${active.textContent ?? ''}${text}`
      active.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }))
      return true
    }
    return false
  }, text).catch(() => false)
  if (!inserted) {
    await page.keyboard.type(text)
  }
}

async function readFocusedSearchUrl(page: Page) {
  return page.evaluate(() => {
    const active = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null
    const tag = active?.tagName.toLowerCase()
    if (tag !== 'input' && tag !== 'textarea') return null
    const query = active?.value.trim() ?? ''
    if (!query) return null
    const host = window.location.hostname.toLowerCase()
    if (host === 'www.bing.com' || host === 'bing.com') {
      return `https://www.bing.com/search?q=${encodeURIComponent(query)}&mkt=en-US&setlang=en-US&cc=US&ensearch=1`
    }
    if (host === 'duckduckgo.com' || host === 'www.duckduckgo.com') {
      return `https://duckduckgo.com/?q=${encodeURIComponent(query)}&kl=us-en`
    }
    if (/(^|\.)google\./i.test(host)) {
      return `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=en&gl=US`
    }
    return null
  }).catch(() => null)
}

function isAutomatedBlockPage(url: string, text: string) {
  try {
    const parsed = new URL(url)
    if (/(^|\.)google\./i.test(parsed.hostname) && parsed.pathname.startsWith('/sorry')) return true
    if (/(^|\.)duckduckgo\.com$/i.test(parsed.hostname) && parsed.pathname.includes('/418')) return true
  } catch {}
  return GOOGLE_BLOCK_PATTERN.test(text)
}

function shouldProbeBlockText(url: string) {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return /(^|\.)google\./i.test(host) || host.includes('bing.') || host.includes('duckduckgo.com')
  } catch {
    return true
  }
}

async function waitForInteractionSettle(page: Page, expectNavigation: boolean) {
  if (!expectNavigation) {
    await page.waitForTimeout(INTERACTION_SETTLE_MS).catch(() => undefined)
    return
  }

  // Only wait for DOM — networkidle on interaction-triggered navigations causes multi-second stalls
  await page.waitForLoadState('domcontentloaded', { timeout: NAVIGATION_SETTLE_TIMEOUT_MS }).catch(() => undefined)
}

function isGoogleSearchUrl(value: string) {
  try {
    const url = new URL(value)
    return /(^|\.)google\./i.test(url.hostname) && url.pathname.startsWith('/search')
  } catch {
    return false
  }
}

function clampCoordinate(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, Math.round(value)))
}

function clampDelta(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.max(-1400, Math.min(1400, Math.round(value)))
}

function normalizeBrowserKey(key: string) {
  const allowed = new Set([
    'Enter',
    'Backspace',
    'Delete',
    'Tab',
    'Escape',
    'ArrowLeft',
    'ArrowRight',
    'ArrowUp',
    'ArrowDown',
    'Home',
    'End'
  ])
  return allowed.has(key) ? key : 'Enter'
}

function cleanupExpiredSessions() {
  const now = Date.now()
  for (const [sessionId, session] of sessions) {
    if (now - session.lastUsedAt > SESSION_TTL_MS) {
      void closeBrowserSession(sessionId)
    }
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error('Timed out.')), timeoutMs)
    })
  ])
}
