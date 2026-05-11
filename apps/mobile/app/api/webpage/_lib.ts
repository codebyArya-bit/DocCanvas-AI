import { lookup } from 'node:dns/promises'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import { JSDOM } from 'jsdom'
import createDOMPurify from 'dompurify'
import { Readability } from '@mozilla/readability'
import TurndownService from 'turndown'

const NAVIGATION_TIMEOUT_MS = 18000
const MAX_RENDERED_HTML_LENGTH = 500_000

const SAFE_URI_PATTERN = /^(?:(?:https?|mailto|tel):|\/|#)/i
const URL_PROTOCOL_BLOCK_MESSAGE = 'Only http and https webpages can be imported.'
const URL_HOST_BLOCK_MESSAGE = 'This URL is blocked for security reasons.'
const URL_INVALID_MESSAGE = 'Enter a valid URL, including https://.'

const turndown = new TurndownService()
const routeHostResolutionCache = new Map<string, boolean>()

export class WebpageImportError extends Error {
  status: number

  constructor(message: string, status = 400) {
    super(message)
    this.name = 'WebpageImportError'
    this.status = status
  }
}

export async function parseAndValidateExternalUrl(rawUrl: string) {
  const trimmed = rawUrl.trim()
  let url: URL

  try {
    url = new URL(trimmed)
  } catch {
    throw new WebpageImportError(URL_INVALID_MESSAGE, 400)
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new WebpageImportError(URL_PROTOCOL_BLOCK_MESSAGE, 400)
  }

  if (url.username || url.password) {
    throw new WebpageImportError(URL_HOST_BLOCK_MESSAGE, 400)
  }

  if (isBlockedHostname(url.hostname)) {
    throw new WebpageImportError(URL_HOST_BLOCK_MESSAGE, 400)
  }

  await assertHostResolvesToPublicAddress(url.hostname)
  return url
}

// Shared browser instance for webpage operations
const webpageBrowserGlobal = globalThis as typeof globalThis & {
  __documindWebpageBrowserPromise?: Promise<Browser>
}

export async function getWebpageBrowser() {
  const launchOptions = {
    headless: true,
    timeout: 15_000, // Reduced from 30s
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

  if (!webpageBrowserGlobal.__documindWebpageBrowserPromise) {
    webpageBrowserGlobal.__documindWebpageBrowserPromise = chromium.launch(launchOptions).catch((error) => {
      webpageBrowserGlobal.__documindWebpageBrowserPromise = undefined
      console.error('Webpage browser launch failed:', error)
      throw error
    })
    
    // Start background initialization
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  
  const browser = await webpageBrowserGlobal.__documindWebpageBrowserPromise
  
  if (!browser.isConnected()) {
    webpageBrowserGlobal.__documindWebpageBrowserPromise = chromium.launch(launchOptions).catch((error) => {
      webpageBrowserGlobal.__documindWebpageBrowserPromise = undefined
      throw error
    })
    return webpageBrowserGlobal.__documindWebpageBrowserPromise
  }
  
  return browser
}

export async function withIsolatedPage<T>(
  startUrl: string,
  run: (page: Page, context: BrowserContext) => Promise<T>
) {
  const browser = await getWebpageBrowser()
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    userAgent: 'DocuMindMobileImporter/1.0',
    ignoreHTTPSErrors: false
  })
  const page = await context.newPage()
  page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS)

  await context.route('**/*', async (route) => {
    const requestUrl = route.request().url()
    try {
      const parsed = new URL(requestUrl)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        await route.abort('blockedbyclient')
        return
      }
      if (isBlockedHostname(parsed.hostname) || isPrivateIpLiteral(parsed.hostname)) {
        await route.abort('blockedbyclient')
        return
      }
      const isPublic = await hostResolvesToPublicAddress(parsed.hostname)
      if (!isPublic) {
        await route.abort('blockedbyclient')
        return
      }
    } catch {
      await route.abort('blockedbyclient')
      return
    }
    await route.continue()
  })

  try {
    await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS })
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => undefined)
    return await run(page, context)
  } finally {
    await context.close().catch(() => undefined)
    await browser.close().catch(() => undefined)
  }
}

export async function renderSanitizedHtml(page: Page) {
  const rawHtml = await page.content()
  return sanitizeHtml(rawHtml, page.url())
}

export function sanitizeHtml(rawHtml: string, pageUrl: string) {
  const dom = new JSDOM(rawHtml, { url: pageUrl })
  const purify = createDOMPurify(dom.window as unknown as typeof globalThis)

  const body = dom.window.document.body
  body.querySelectorAll('script,noscript,iframe,object,embed,form,canvas,svg,img,picture,source,video,audio').forEach((node: Element) => node.remove())

  body.querySelectorAll('a[href]').forEach((node: Element) => {
    const anchor = node as HTMLAnchorElement
    const href = anchor.getAttribute('href') ?? ''
    if (!SAFE_URI_PATTERN.test(href)) {
      anchor.removeAttribute('href')
    }
    anchor.setAttribute('target', '_self')
    anchor.setAttribute('rel', 'noopener noreferrer')
  })

  const sanitized = purify.sanitize(body.innerHTML, {
    WHOLE_DOCUMENT: false,
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'canvas', 'svg', 'img', 'picture', 'source', 'video', 'audio'],
    FORBID_ATTR: ['src', 'srcset', 'poster', 'style'],
    ALLOWED_URI_REGEXP: SAFE_URI_PATTERN
  })

  return clampLength(sanitized, MAX_RENDERED_HTML_LENGTH)
}

export function extractReadableContent(rawHtml: string, pageUrl: string) {
  const dom = new JSDOM(rawHtml, { url: pageUrl })
  const article = new Readability(dom.window.document).parse()
  if (!article?.content) return null

  const sanitizedHtml = sanitizeHtml(article.content, pageUrl)
  const plainText = normalizeText(article.textContent ?? '')
  const markdown = turndown.turndown(sanitizedHtml)
  const sections = toSectionsFromText(plainText)

  return {
    title: normalizeText(article.title || dom.window.document.title || new URL(pageUrl).hostname),
    sanitizedHtml,
    textContent: plainText,
    markdown,
    sections
  }
}

export function extractReadableContentFromHtml(rawHtml: string, sourceUrl: string, titleHint?: string) {
  const readable = extractReadableContent(rawHtml, sourceUrl)
  if (readable) {
    return titleHint ? { ...readable, title: titleHint || readable.title } : readable
  }

  const sanitizedHtml = sanitizeHtml(rawHtml, sourceUrl)
  const plainText = normalizeText(new JSDOM(sanitizedHtml, { url: sourceUrl }).window.document.body.textContent ?? '')
  if (!plainText) return null

  return {
    title: normalizeText(titleHint || new URL(sourceUrl).hostname),
    sanitizedHtml,
    textContent: plainText,
    markdown: turndown.turndown(sanitizedHtml),
    sections: toSectionsFromText(plainText)
  }
}

export function toSectionsFromText(text: string) {
  return text
    .split(/\n{2,}/)
    .map((entry) => normalizeText(entry))
    .filter(Boolean)
    .slice(0, 220)
    .map((entry) => ({ kind: 'paragraph' as const, text: entry }))
}

export function normalizeText(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function clampLength(value: string, max: number) {
  return value.length > max ? value.slice(0, max) : value
}

function isBlockedHostname(hostname: string) {
  const normalized = hostname.trim().toLowerCase()
  if (!normalized) return true
  if (normalized === 'localhost' || normalized.endsWith('.localhost') || normalized.endsWith('.local')) return true
  if (isPrivateIpLiteral(normalized)) return true
  return false
}

function isPrivateIpLiteral(value: string) {
  if (isPrivateIpv4(value)) return true
  if (value === '::1' || value === '[::1]') return true
  if (value.startsWith('fe80:') || value.startsWith('fc') || value.startsWith('fd')) return true
  return false
}

function isPrivateIpv4(value: string) {
  const match = value.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (!match) return false
  const octets = match.slice(1).map((entry) => Number(entry))
  if (octets.some((entry) => !Number.isInteger(entry) || entry < 0 || entry > 255)) return false
  const [first, second] = octets
  if (first === 10) return true
  if (first === 127) return true
  if (first === 169 && second === 254) return true
  if (first === 172 && second >= 16 && second <= 31) return true
  if (first === 192 && second === 168) return true
  if (first === 0) return true
  if (first === 100 && second >= 64 && second <= 127) return true
  if (first === 192 && second === 0) return true
  if (first === 198 && (second === 18 || second === 19)) return true
  if (first >= 224) return true
  return false
}

async function assertHostResolvesToPublicAddress(hostname: string) {
  const records = await lookup(hostname, { all: true, verbatim: true }).catch(() => [])
  if (!records.length) {
    throw new WebpageImportError('Could not resolve the requested host.', 400)
  }
  const hasBlocked = records.some((record) => isPrivateIpLiteral(record.address) || isPrivateIpv4(record.address))
  if (hasBlocked) {
    throw new WebpageImportError(URL_HOST_BLOCK_MESSAGE, 400)
  }
}

async function hostResolvesToPublicAddress(hostname: string) {
  const normalized = hostname.trim().toLowerCase()
  if (!normalized) return false
  const cached = routeHostResolutionCache.get(normalized)
  if (typeof cached === 'boolean') return cached

  const records = await lookup(normalized, { all: true, verbatim: true }).catch(() => [])
  const isPublic = records.length > 0 && records.every((record) => !isPrivateIpLiteral(record.address) && !isPrivateIpv4(record.address))
  routeHostResolutionCache.set(normalized, isPublic)
  if (routeHostResolutionCache.size > 500) {
    routeHostResolutionCache.clear()
  }
  return isPublic
}
