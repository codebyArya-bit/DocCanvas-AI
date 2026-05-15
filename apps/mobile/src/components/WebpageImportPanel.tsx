'use client'

import { type KeyboardEvent, type MouseEvent, useEffect, useRef, useState } from 'react'
import { type MobileDocumentRecord } from '../lib/mobile-store'
import { saveImportedWebDocument, type WebImportResponse } from '../lib/web-import'

type SearchEngine = 'bing'

interface WebpageImportPanelProps {
  folderId: string | null
  onImported: (record: MobileDocumentRecord) => void
  onStatusChange: (status: string) => void
}

interface BrowserPreview {
  sessionId: string
  url: string
  title: string
  screenshotDataUrl: string | null
  blocked?: boolean
  reason?: string
  error?: string
}

interface ImportResponse extends WebImportResponse {
  error?: string
}

const DEFAULT_SEARCH_ENGINE: SearchEngine = 'bing'
const TOAST_TIMEOUT_MS = 4000
const PREVIEW_SCROLL_FLUSH_MS = 40
const PREVIEW_TYPE_FLUSH_MS = 60
const PREVIEW_IDLE_REFRESH_MS = 100
const BROWSER_VIEWPORT = { width: 1280, height: 820 }

export function shouldDeferPreviewScreenshotCommit(options: {
  hasActivePointer: boolean
  isPointerDragging: boolean
  hasPendingWheelFlush: boolean
  hasPendingTypeFlush: boolean
}) {
  return (
    options.hasActivePointer ||
    options.isPointerDragging ||
    options.hasPendingWheelFlush ||
    options.hasPendingTypeFlush
  )
}

class BrowserSessionExpiredError extends Error {
  constructor(message = 'Browser session expired.') {
    super(message)
    this.name = 'BrowserSessionExpiredError'
  }
}

export function WebpageImportPanel({ folderId, onImported, onStatusChange }: WebpageImportPanelProps) {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [inputValue, setInputValue] = useState('')
  const [preview, setPreview] = useState<BrowserPreview | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isInteracting, setIsInteracting] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isPreviewFocused, setIsPreviewFocused] = useState(false)
  const [isPointerDragging, setIsPointerDragging] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const actionAbortRef = useRef<AbortController | null>(null)
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const previewRefreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pointerActiveRef = useRef(false)
  const typeBufferRef = useRef('')
  const typeFlushTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wheelFlushTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wheelDeltaRef = useRef({ deltaX: 0, deltaY: 0 })
  const lastTouchYRef = useRef<number | null>(null)
  const requestIdRef = useRef(0)
  const previewShellRef = useRef<HTMLDivElement>(null)

  // Initial browser boot should happen once per panel mount.
  useEffect(() => {
    setIsLoading(true)
    onStatusChange('Starting isolated browser...')
    void createSession(DEFAULT_SEARCH_ENGINE)
      .then(() => {
        onStatusChange('Unsigned browser ready.')
      })
      .catch((error) => {
        if (isAbortError(error)) return
        const message = error instanceof Error ? error.message : 'Could not start browser.'
        showToast(message)
        onStatusChange(message)
      })
      .finally(() => {
        setIsLoading(false)
      })
    return () => {
      actionAbortRef.current?.abort()
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current)
      if (previewRefreshTimeoutRef.current) clearTimeout(previewRefreshTimeoutRef.current)
      if (typeFlushTimeoutRef.current) clearTimeout(typeFlushTimeoutRef.current)
      if (wheelFlushTimeoutRef.current) clearTimeout(wheelFlushTimeoutRef.current)
    }
  }, [onStatusChange]) // eslint-disable-line react-hooks/exhaustive-deps

  function showToast(message: string) {
    setToast(message)
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current)
    toastTimeoutRef.current = setTimeout(() => setToast(null), TOAST_TIMEOUT_MS)
  }

  async function requestBrowser<T>(
    endpoint: string,
    body?: Record<string, unknown>,
    method: 'GET' | 'POST' = 'POST',
    abortPrevious = true,
    markAsLatest = true
  ) {
    if (abortPrevious) {
      actionAbortRef.current?.abort()
    }
    const controller = new AbortController()
    const requestId = markAsLatest ? requestIdRef.current + 1 : requestIdRef.current
    if (markAsLatest) {
      requestIdRef.current = requestId
    }
    if (abortPrevious) {
      actionAbortRef.current = controller
    }
    try {
      const response = await fetch(endpoint, {
        method,
        headers: method === 'POST' ? { 'content-type': 'application/json' } : undefined,
        body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
        signal: controller.signal
      })
      const payload = (await response.json().catch(() => null)) as (T & { error?: string }) | null
      if (markAsLatest && requestId !== requestIdRef.current) {
        throw new DOMException('Stale browser response ignored.', 'AbortError')
      }
      if (response.status === 410) {
        throw new BrowserSessionExpiredError(payload?.error ?? 'Browser session expired.')
      }
      if (!response.ok || !payload) {
        throw new Error(payload?.error ?? 'Browser action failed.')
      }
      return payload
    } finally {
      if (abortPrevious && actionAbortRef.current === controller) {
        actionAbortRef.current = null
      }
    }
  }

  async function createSession(engine: SearchEngine, preservePreview = false) {
    if (!preservePreview) {
      setPreview(null)
    }
    const payload = await requestBrowser<BrowserPreview>('/api/browser/session', { searchEngine: engine })
    commitPreview(payload)
    return payload
  }

  async function restartSessionAfterExpiry() {
    setSessionId(null)
    typeBufferRef.current = ''
    wheelDeltaRef.current = { deltaX: 0, deltaY: 0 }
    const payload = await createSession(DEFAULT_SEARCH_ENGINE, true)
    showToast('Session restarted. Retry your last browser action.')
    onStatusChange('Session restarted. Retry your last browser action.')
    return payload
  }

  async function startSession(engine: SearchEngine) {
    setIsLoading(true)
    onStatusChange('Starting isolated browser...')
    try {
      await createSession(engine)
      onStatusChange('Unsigned browser ready.')
    } catch (error) {
      if (isAbortError(error)) return
      const message = error instanceof Error ? error.message : 'Could not start browser.'
      showToast(message)
      onStatusChange(message)
    } finally {
      setIsLoading(false)
    }
  }

  function commitPreview(payload: BrowserPreview) {
    setSessionId((current) => (current === payload.sessionId ? current : payload.sessionId))
    setPreview((current) => {
      if (
        current &&
        current.sessionId === payload.sessionId &&
        current.url === payload.url &&
        current.title === payload.title &&
        current.screenshotDataUrl === payload.screenshotDataUrl &&
        Boolean(current.blocked) === Boolean(payload.blocked) &&
        (current.reason ?? '') === (payload.reason ?? '')
      ) {
        return current
      }
      return payload
    })
    setInputValue((current) => (current === payload.url ? current : payload.url))
    if (payload.blocked) {
      showToast(payload.reason ?? 'Automated block detected.')
    }
  }

  function commitPreviewMetadata(payload: BrowserPreview) {
    setSessionId((current) => (current === payload.sessionId ? current : payload.sessionId))
    setPreview((current) => {
      const nextScreenshot =
        shouldDeferVisualCommit() && current && current.sessionId === payload.sessionId
          ? current.screenshotDataUrl
          : payload.screenshotDataUrl
      if (
        current &&
        current.sessionId === payload.sessionId &&
        current.url === payload.url &&
        current.title === payload.title &&
        current.screenshotDataUrl === nextScreenshot &&
        Boolean(current.blocked) === Boolean(payload.blocked) &&
        (current.reason ?? '') === (payload.reason ?? '')
      ) {
        return current
      }
      return {
        ...payload,
        screenshotDataUrl: nextScreenshot
      }
    })
    setInputValue((current) => (current === payload.url ? current : payload.url))
    if (payload.blocked) {
      showToast(payload.reason ?? 'Automated block detected.')
    }
  }

  function schedulePreviewRefresh(nextSessionId: string | null) {
    if (!nextSessionId) {
      return
    }
    if (previewRefreshTimeoutRef.current) {
      clearTimeout(previewRefreshTimeoutRef.current)
    }
    previewRefreshTimeoutRef.current = setTimeout(() => {
      if (pointerActiveRef.current) {
        schedulePreviewRefresh(nextSessionId)
        return
      }
      previewRefreshTimeoutRef.current = null
      void refreshPreview(nextSessionId)
    }, PREVIEW_IDLE_REFRESH_MS)
  }

  async function refreshPreview(nextSessionId: string) {
    try {
      const payload = await requestBrowser<BrowserPreview>(
        `/api/browser/preview?sessionId=${encodeURIComponent(nextSessionId)}`,
        undefined,
        'GET',
        false,
        false
      )
      commitPreview(payload)
    } catch (error) {
      if (isAbortError(error) || error instanceof BrowserSessionExpiredError) {
        return
      }
      console.warn('Preview refresh failed', error)
    }
  }

  async function navigate(action?: 'back' | 'forward' | 'home') {
    if (!sessionId && action !== 'home') return
    setIsLoading(true)
    setToast(null)
    onStatusChange(action === 'home' ? 'Opening home...' : 'Loading page...')
    try {
      if (action === 'home') {
        await startSession(DEFAULT_SEARCH_ENGINE)
        return
      }
      const payload = await requestBrowser<BrowserPreview>('/api/browser/navigate', {
        sessionId,
        action,
        target: inputValue,
        searchEngine: DEFAULT_SEARCH_ENGINE
      })
      commitPreview(payload)
      onStatusChange(payload.blocked ? 'Preview blocked.' : `${payload.title} loaded.`)
    } catch (error) {
      if (isAbortError(error)) return
      if (error instanceof BrowserSessionExpiredError) {
        try {
          const nextSession = await restartSessionAfterExpiry()
          if (!action) {
            const payload = await requestBrowser<BrowserPreview>('/api/browser/navigate', {
              sessionId: nextSession.sessionId,
              target: inputValue,
              searchEngine: DEFAULT_SEARCH_ENGINE
            })
            commitPreview(payload)
            onStatusChange(payload.blocked ? 'Preview blocked.' : `${payload.title} loaded.`)
          }
        } catch (restartError) {
          if (isAbortError(restartError)) return
          const message = restartError instanceof Error ? restartError.message : 'Could not restart browser session.'
          showToast(message)
          onStatusChange(message)
        }
        return
      }
      const message = error instanceof Error ? error.message : 'Navigation failed.'
      showToast(message)
      onStatusChange(message)
    } finally {
      setIsLoading(false)
    }
  }

  async function search() {
    const value = inputValue.trim()
    if (!value) return
    const extractedQuery = extractSearchQuery(value)
    if (extractedQuery) {
      await runSearchQuery(extractedQuery)
      return
    }
    if (looksLikeUrl(value)) {
      await navigate()
      return
    }
    await runSearchQuery(value)
  }

  async function runSearchQuery(query: string) {
    if (!sessionId) {
      await startSession(DEFAULT_SEARCH_ENGINE)
      return
    }
    setIsLoading(true)
    setToast(null)
    onStatusChange(`Searching ${searchEngineLabel()}...`)
    try {
      const payload = await requestBrowser<BrowserPreview>('/api/browser/search', {
        sessionId,
        query,
        searchEngine: DEFAULT_SEARCH_ENGINE
      })
      commitPreview(payload)
      onStatusChange(payload.blocked ? 'Search page blocked.' : `${payload.title} loaded.`)
    } catch (error) {
      if (isAbortError(error)) return
      if (error instanceof BrowserSessionExpiredError) {
        try {
          const nextSession = await restartSessionAfterExpiry()
          const payload = await requestBrowser<BrowserPreview>('/api/browser/search', {
            sessionId: nextSession.sessionId,
            query,
            searchEngine: DEFAULT_SEARCH_ENGINE
          })
          commitPreview(payload)
          onStatusChange(payload.blocked ? 'Search page blocked.' : `${payload.title} loaded.`)
        } catch (restartError) {
          if (isAbortError(restartError)) return
          const message = restartError instanceof Error ? restartError.message : 'Could not restart browser session.'
          showToast(message)
          onStatusChange(message)
        }
        return
      }
      const message = error instanceof Error ? error.message : 'Search failed.'
      showToast(message)
      onStatusChange(message)
    } finally {
      setIsLoading(false)
    }
  }

  async function interactWithPreview(
    endpoint: '/api/browser/click' | '/api/browser/type' | '/api/browser/key' | '/api/browser/scroll',
    body: Record<string, unknown>,
    options: { silent?: boolean; suppressStatus?: boolean; deferVisualCommit?: boolean } = {}
  ) {
    if (!sessionId || isImporting || isSaving) return
    if (!options.silent) {
      setIsInteracting(true)
    }
    setToast(null)
    try {
      const payload = await requestBrowser<BrowserPreview>(endpoint, { sessionId, ...body }, 'POST', false)
      if (options.deferVisualCommit) {
        commitPreviewMetadata(payload)
        schedulePreviewRefresh(payload.sessionId)
      } else {
        commitPreview(payload)
      }
      if (!options.suppressStatus) {
        onStatusChange(payload.blocked ? 'Preview blocked.' : `${payload.title} loaded.`)
      }
    } catch (error) {
      if (isAbortError(error)) return
      if (error instanceof BrowserSessionExpiredError) {
        try {
          await restartSessionAfterExpiry()
        } catch (restartError) {
          if (isAbortError(restartError)) return
          const message = restartError instanceof Error ? restartError.message : 'Could not restart browser session.'
          showToast(message)
          onStatusChange(message)
        }
        return
      }
      const message = error instanceof Error ? error.message : 'Browser interaction failed.'
      showToast(message)
      onStatusChange(message)
    } finally {
      if (!options.silent) {
        setIsInteracting(false)
      }
    }
  }

  function shouldDeferVisualCommit() {
    return shouldDeferPreviewScreenshotCommit({
      hasActivePointer: pointerActiveRef.current,
      isPointerDragging,
      hasPendingWheelFlush: Boolean(wheelFlushTimeoutRef.current),
      hasPendingTypeFlush: Boolean(typeFlushTimeoutRef.current)
    })
  }

  function queuePreviewScroll(deltaX: number, deltaY: number) {
    wheelDeltaRef.current = {
      deltaX: wheelDeltaRef.current.deltaX + deltaX,
      deltaY: wheelDeltaRef.current.deltaY + deltaY
    }
    if (wheelFlushTimeoutRef.current) clearTimeout(wheelFlushTimeoutRef.current)
    wheelFlushTimeoutRef.current = setTimeout(() => {
      void flushPreviewScroll()
    }, PREVIEW_SCROLL_FLUSH_MS)
  }

  async function flushPreviewScroll() {
    if (wheelFlushTimeoutRef.current) {
      clearTimeout(wheelFlushTimeoutRef.current)
      wheelFlushTimeoutRef.current = null
    }
    const nextDelta = wheelDeltaRef.current
    wheelDeltaRef.current = { deltaX: 0, deltaY: 0 }
    if (!nextDelta.deltaX && !nextDelta.deltaY) return
    await interactWithPreview('/api/browser/scroll', nextDelta, {
      silent: true,
      suppressStatus: true,
      deferVisualCommit: true
    })
  }

  // Native wheel/touch listeners with { passive: false } so preventDefault() works.
  // React synthetic onWheel is passive → preventDefault() silently fails → page scrolls.
  useEffect(() => {
    const el = previewShellRef.current
    if (!el) return

    function onWheel(event: WheelEvent) {
      if (!sessionId || preview?.blocked) return
      event.preventDefault()
      event.stopPropagation()
      setIsPreviewFocused(true)
      queuePreviewScroll(event.deltaX, event.deltaY)
    }

    function onTouchStart(event: globalThis.TouchEvent) {
      lastTouchYRef.current = event.touches[0]?.clientY ?? null
      setIsPreviewFocused(true)
    }

    function onTouchMove(event: globalThis.TouchEvent) {
      if (!sessionId || preview?.blocked) return
      const nextY = event.touches[0]?.clientY
      const previousY = lastTouchYRef.current
      if (typeof nextY !== 'number' || typeof previousY !== 'number') return
      event.preventDefault()
      event.stopPropagation()
      queuePreviewScroll(0, previousY - nextY)
      lastTouchYRef.current = nextY
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
    }
  }) // intentionally no deps — reattach every render to capture latest sessionId/preview

  function handleScreenshotClick(event: MouseEvent<HTMLImageElement>) {
    const img = event.currentTarget
    const rect = img.getBoundingClientRect()
    
    // Calculate rendered image size accounting for object-fit: contain
    const scale = Math.min(rect.width / img.naturalWidth, rect.height / img.naturalHeight)
    const renderedWidth = img.naturalWidth * scale
    const renderedHeight = img.naturalHeight * scale
    
    // Calculate image offsets within the container
    const offsetX = (rect.width - renderedWidth) / 2
    const offsetY = (rect.height - renderedHeight) / 2

    // Map click coordinates relative to the rendered image
    const clickX = event.clientX - rect.left - offsetX
    const clickY = event.clientY - rect.top - offsetY

    // Validate coordinates are within the rendered image (accounting for centering)
    const isWithinImage = (
      clickX >= 0 &&
      clickX <= renderedWidth &&
      clickY >= 0 &&
      clickY <= renderedHeight
    )
    
    const hasValidDimensions = renderedWidth > 0 && renderedHeight > 0
    
    if (!isWithinImage || !hasValidDimensions) {
      console.warn('Click outside rendered image area or invalid dimensions', {
        clickX, clickY, renderedWidth, renderedHeight,
        rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        offsetX, offsetY,
        natural: { width: img.naturalWidth, height: img.naturalHeight },
        client: { x: event.clientX, y: event.clientY },
        isWithinImage,
        hasValidDimensions
      })
      return
    }

    // Map to browser viewport coordinates
    const x = Math.round((clickX / renderedWidth) * BROWSER_VIEWPORT.width)
    const y = Math.round((clickY / renderedHeight) * BROWSER_VIEWPORT.height)
    
    // Clamp to viewport bounds
    const clampedX = Math.max(0, Math.min(BROWSER_VIEWPORT.width - 1, x))
    const clampedY = Math.max(0, Math.min(BROWSER_VIEWPORT.height - 1, y))
    
    console.log('Browser click mapping:', {
      click: { x: event.clientX, y: event.clientY },
      rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      rendered: { width: renderedWidth, height: renderedHeight },
      image: { naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight },
      offset: { x: offsetX, y: offsetY },
      relative: { x: clickX, y: clickY },
      mapped: { x, y },
      clamped: { x: clampedX, y: clampedY },
      viewport: BROWSER_VIEWPORT
    })

    setIsPreviewFocused(true)
    void interactWithPreview('/api/browser/click', { x: clampedX, y: clampedY })
  }

  function queuePreviewText(text: string) {
    typeBufferRef.current += text
    if (typeFlushTimeoutRef.current) clearTimeout(typeFlushTimeoutRef.current)
    typeFlushTimeoutRef.current = setTimeout(() => {
      void flushPreviewText()
    }, PREVIEW_TYPE_FLUSH_MS)
  }

  async function flushPreviewText(
    options: { silent?: boolean; suppressStatus?: boolean; deferVisualCommit?: boolean } = {
      silent: true,
      suppressStatus: true,
      deferVisualCommit: true
    }
  ) {
    if (typeFlushTimeoutRef.current) {
      clearTimeout(typeFlushTimeoutRef.current)
      typeFlushTimeoutRef.current = null
    }
    const text = typeBufferRef.current
    typeBufferRef.current = ''
    if (!text) return
    await interactWithPreview('/api/browser/type', { text }, options)
  }

  function handlePreviewKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!isPreviewFocused || !sessionId) return
    const printable = event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey
    const commandKeys = new Set([
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
    if (printable) {
      event.preventDefault()
      queuePreviewText(event.key)
      return
    }
    if (commandKeys.has(event.key)) {
      event.preventDefault()
      void (async () => {
        await flushPreviewText({ silent: true, suppressStatus: true })
        await interactWithPreview('/api/browser/key', { key: event.key })
      })()
    }
  }

  async function importCurrentPage() {
    if (!sessionId || isSaving || isImporting) return
    setIsImporting(true)
    setIsSaving(false)
    setToast(null)
    onStatusChange('Capturing visual document and extracting text...')
    const documentId = crypto.randomUUID()

    try {
      const payload = await requestBrowser<ImportResponse>('/api/browser/import', { sessionId })
      setIsSaving(true)
      onStatusChange('Saving document...')
      const record = await saveImportedWebDocument({
        payload,
        mode: payload.bytesBase64 ? 'hybrid' : 'readable-text',
        folderId,
        previewMode: payload.bytesBase64 ? 'screenshot' : 'blocked',
        documentId
      })
      onImported(record)
      onStatusChange(`${record.document.title} imported.`)
    } catch (error) {
      if (isAbortError(error)) return
      if (error instanceof BrowserSessionExpiredError) {
        try {
          await restartSessionAfterExpiry()
        } catch (restartError) {
          if (isAbortError(restartError)) return
          const message = restartError instanceof Error ? restartError.message : 'Could not restart browser session.'
          showToast(message)
          onStatusChange(message)
        }
        return
      }
      const message = error instanceof Error ? error.message : 'Could not import webpage.'
      showToast(message)
      onStatusChange(message)
    } finally {
      setIsImporting(false)
      setIsSaving(false)
    }
  }

  return (
    <section className="webpage-import-panel webpage-browser-panel" aria-label="Unsigned web browser import">
      <div className="webpage-browser-topbar">
        <button type="button" className="webpage-browser-icon-button" disabled={isLoading} onClick={() => void navigate('home')}>
          Home
        </button>
        <button type="button" className="webpage-browser-icon-button" disabled={isLoading || !sessionId} onClick={() => void navigate('back')}>
          Back
        </button>
        <button type="button" className="webpage-browser-icon-button" disabled={isLoading || !sessionId} onClick={() => void navigate('forward')}>
          Forward
        </button>
        <form
          className="webpage-import-row"
          onSubmit={(event) => {
            event.preventDefault()
            void search()
          }}
        >
          <input
            value={inputValue}
            aria-label="Search or enter URL"
            inputMode="url"
            placeholder="Search Bing or enter a URL"
            onChange={(event) => setInputValue(event.target.value)}
          />
          <span className="webpage-engine-pill" aria-label="Search engine">Bing</span>
          <button className="mobile-secondary-button" type="submit" disabled={isLoading || !sessionId}>
            Go
          </button>
        </form>
        <button
          className="mobile-primary-button"
          type="button"
          disabled={!sessionId || isLoading || isImporting || isSaving || preview?.blocked}
          onClick={() => void importCurrentPage()}
        >
          {isSaving ? 'Saving...' : isImporting ? 'Importing...' : 'Import PDF'}
        </button>
      </div>
      <small className="webpage-session-note">
        Unsigned isolated session. Cookies are not saved. Scroll or click inside preview. Use top bar for direct URL/search.
      </small>
      <div
        ref={previewShellRef}
        className={isPreviewFocused ? `webpage-preview-shell is-focused${isPointerDragging ? ' is-dragging' : ''}` : `webpage-preview-shell${isPointerDragging ? ' is-dragging' : ''}`}
        tabIndex={0}
        onKeyDown={handlePreviewKeyDown}
        onPointerDown={() => {
          pointerActiveRef.current = true
          setIsPointerDragging(true)
        }}
        onPointerUp={() => {
          pointerActiveRef.current = false
          setIsPointerDragging(false)
          schedulePreviewRefresh(sessionId)
        }}
        onPointerCancel={() => {
          pointerActiveRef.current = false
          setIsPointerDragging(false)
        }}
        onFocus={() => setIsPreviewFocused(true)}
        onBlur={() => setIsPreviewFocused(false)}
      >
        {toast ? (
          <div className="webpage-toast" role="status">
            {toast}
          </div>
        ) : null}
        {isLoading && !preview ? <div className="webpage-preview-loading">Loading browser...</div> : null}
        {isInteracting && preview && !preview.blocked ? <div className="webpage-preview-busy" aria-hidden="true" /> : null}
        {!isLoading && preview?.blocked ? (
          <div className="webpage-preview-fallback">
            <strong>Page blocked</strong>
            <span>{preview.reason ?? 'This page cannot be imported from an automated unsigned browser.'}</span>
          </div>
        ) : null}
        {preview?.screenshotDataUrl && !preview.blocked ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={preview.screenshotDataUrl}
            alt={`Preview of ${preview.title}`}
            className="webpage-browser-screenshot"
            decoding="async"
            draggable={false}
            onDragStart={(event) => event.preventDefault()}
            onClick={handleScreenshotClick}
          />
          </>
        ) : null}
        {!isLoading && !preview ? <DefaultBrowserHome /> : null}
      </div>
      {preview ? (
        <div className="webpage-browser-footer">
          <span>{preview.title}</span>
          <span>{preview.url}</span>
        </div>
      ) : null}
    </section>
  )
}

function looksLikeUrl(value: string) {
  return /^https?:\/\//i.test(value.trim()) || /^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(value.trim())
}

function extractSearchQuery(value: string) {
  try {
    const url = new URL(value.trim())
    const host = url.hostname.toLowerCase()
    const isSearchHost =
      /(^|\.)google\./i.test(host) ||
      host === 'www.bing.com' ||
      host === 'bing.com' ||
      host === 'duckduckgo.com' ||
      host === 'www.duckduckgo.com'
    const pathLooksSearch = url.pathname.startsWith('/search') || url.pathname === '/' || url.pathname === ''
    if (!isSearchHost || !pathLooksSearch) return null
    return url.searchParams.get('q')?.trim() || null
  } catch {
    return null
  }
}

function searchEngineLabel() {
  return 'Bing'
}

function isAbortError(error: unknown) {
  if (error instanceof DOMException && error.name === 'AbortError') return true
  if (error instanceof Error && /abort|aborted/i.test(error.message)) return true
  return false
}

function DefaultBrowserHome() {
  return (
    <div className="webpage-default-search">
      <div className="webpage-default-search-logo">Docu Browser</div>
      <p>Search the web in an isolated unsigned browser, open a result, then import it as a document.</p>
    </div>
  )
}
