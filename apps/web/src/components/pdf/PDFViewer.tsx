'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react'
import type { Bookmark, PageAnchor } from '@workspace/domain'
import type { PersistedPdfDocument } from '../../lib/workspace/workspace-state'
import {
  resolveAnchorClientRects,
  restorePdfSelectionFromAnchor,
  type SelectionArtifactInput
} from '../../lib/excerpts/pdf-selection'
import { measureAnchorMetric, type AnchorViewportMetric } from './AnchorService'
import { clampPopupPosition } from './AnchorService'
import { SelectionManager, type SelectionPopupState } from './SelectionManager'

let pdfModulePromise: Promise<any> | null = null
let pdfModuleConfigured = false

async function loadPdfModule() {
  if (!pdfModulePromise) {
    pdfModulePromise = import('pdfjs-dist/legacy/build/pdf.mjs')
  }

  const pdfjs = await pdfModulePromise
  if (!pdfModuleConfigured) {
    pdfModuleConfigured = true
    try {
      const workerUrl = new URL('pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url)
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl.toString()
    } catch {}
  }

  return pdfjs
}

class PdfDocumentController {
  private chain: Promise<void> = Promise.resolve()
  private activeTask: any = null
  private activeDocument: any = null

  private async destroyCurrent() {
    const task = this.activeTask
    const document = this.activeDocument

    this.activeTask = null
    this.activeDocument = null

    if (task) {
      try {
        await task.destroy()
      } catch {}
      return
    }

    if (document?.destroy) {
      try {
        await document.destroy()
      } catch {}
    }
  }

  private async openWithFallback(pdfjs: any, bytes: Uint8Array, preferDisableWorker: boolean) {
    const baseOptions: any = { data: bytes }
    const options = preferDisableWorker ? { ...baseOptions, disableWorker: true } : baseOptions
    let task: any = null

    try {
      task = pdfjs.getDocument(options)
      const document = await task.promise
      return { task, document }
    } catch (error: any) {
      if (task?.destroy) {
        try {
          await task.destroy()
        } catch {}
      }

      const message = error instanceof Error ? error.message : String(error)
      const looksLikeWorkerFailure =
        error?.name === 'UnknownErrorException' ||
        /worker/i.test(message) ||
        /Setting up fake worker failed/i.test(message) ||
        /Failed to fetch dynamically imported module/i.test(message)

      if (!preferDisableWorker && looksLikeWorkerFailure) {
        task = pdfjs.getDocument({ ...baseOptions, disableWorker: true })
        const document = await task.promise
        return { task, document }
      }

      throw error
    }
  }

  load(bytes: Uint8Array, onSuccess: (doc: any) => void, onError: (message: string) => void): () => void {
    let cancelled = false
    this.chain = this.chain.then(async () => {
      await this.destroyCurrent()
      if (cancelled) {
        return
      }

      try {
        const pdfjs = await loadPdfModule()
        if (cancelled) {
          return
        }

        const { task, document } = await this.openWithFallback(pdfjs, bytes, false)
        this.activeTask = task
        if (cancelled) {
          await this.destroyCurrent()
          return
        }

        this.activeDocument = document
        onSuccess(document)
      } catch (error: any) {
        await this.destroyCurrent()
        if (cancelled || error?.name === 'AbortException') {
          return
        }
        if (error?.name === 'PasswordException') {
          onError('This PDF is password-protected and cannot be opened.')
          return
        }
        if (error?.name === 'InvalidPDFException') {
          onError('This file is not a valid PDF.')
          return
        }
        onError(error instanceof Error ? error.message : 'Failed to open PDF document.')
      }
    })

    return () => {
      cancelled = true
    }
  }

  unload() {
    this.chain = this.chain.then(async () => {
      await this.destroyCurrent()
    })
  }
}

const pdfController = new PdfDocumentController()

export interface HighlightDescriptor {
  anchorId: string
  pageNumber: number
  boundingBox: PageAnchor['boundingBox']
  quadPoints?: number[]
  viewportScale?: number
  selectionColor: string
  tags?: string[]
}

function indexTextLayerSpans(textLayer: HTMLElement) {
  let index = 0
  textLayer.querySelectorAll<HTMLElement>('span').forEach((span) => {
    const textContent = span.textContent ?? ''
    if (textContent.length === 0) {
      delete span.dataset.textIndex
      return
    }

    span.dataset.textIndex = String(index)
    index += 1
  })
}

interface PdfViewerProps {
  shellRef: RefObject<HTMLElement | null>
  workspaceId: string
  documentState: PersistedPdfDocument | null
  anchors: PageAnchor[]
  highlightedAnchors: HighlightDescriptor[]
  bookmarks: Bookmark[]
  excerptNodes: { id: string; sourceAnchorId: string; title: string; text: string; selectionColor: string }[]
  activeSourceFocus: {
    anchorId: string
    selectionColor: string
    jumpKey: number
  } | null
  onDocumentImported: (document: PersistedPdfDocument) => void
  onAutoExcerpt: (payload: { selection: SelectionArtifactInput; viewportRatio: number }) => void
  onComment: (payload: { selection: SelectionArtifactInput; viewportRatio: number }) => void
  onBookmark: (selection: SelectionArtifactInput) => void
  onTag: (selection: SelectionArtifactInput, tags: string[]) => void
  onSelectionChange: (selection: SelectionArtifactInput) => void
  onOpenAnchor: (anchorId: string) => void
  onAnchorMetricsChange: (metrics: Record<string, AnchorViewportMetric>) => void
}

export function PDFViewer({
  shellRef,
  workspaceId,
  documentState,
  anchors,
  highlightedAnchors,
  bookmarks,
  excerptNodes,
  activeSourceFocus,
  onDocumentImported,
  onAutoExcerpt,
  onComment,
  onBookmark,
  onTag,
  onSelectionChange,
  onOpenAnchor,
  onAnchorMetricsChange
}: PdfViewerProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pageCanvasMapRef = useRef(new Map<number, HTMLCanvasElement>())
  const pageElementMapRef = useRef(new Map<number, HTMLElement>())
  const [pdfDocument, setPdfDocument] = useState<any>(null)
  const [viewerError, setViewerError] = useState<string | null>(null)
  const [popupState, setPopupState] = useState<SelectionPopupState | null>(null)
  const [pageRenderTick, setPageRenderTick] = useState(0)
  const [zoom, setZoom] = useState(1)
  const baseViewportScale = 1.35
  const viewportScale = useMemo(() => Number((baseViewportScale * zoom).toFixed(3)), [zoom])
  const handlePageRendered = useCallback(() => {
    setPageRenderTick((current) => current + 1)
  }, [])
  const handlePageRenderError = useCallback((pageNumber: number, error: unknown) => {
    setViewerError((current) => {
      if (current) return current
      const message = error instanceof Error ? error.message : String(error)
      return `Failed to render PDF page ${pageNumber}. ${message}`
    })
  }, [])
  const registerCanvas = useCallback((pageNumber: number, canvas: HTMLCanvasElement | null) => {
    if (canvas) {
      pageCanvasMapRef.current.set(pageNumber, canvas)
    } else {
      pageCanvasMapRef.current.delete(pageNumber)
    }
  }, [])
  const registerPage = useCallback((pageNumber: number, page: HTMLDivElement | null) => {
    if (page) {
      pageElementMapRef.current.set(pageNumber, page)
    } else {
      pageElementMapRef.current.delete(pageNumber)
    }
  }, [])

  const anchorIndex = useMemo(() => new Map(anchors.map((anchor) => [anchor.id, anchor])), [anchors])
  const bookmarkedAnchorIds = useMemo(() => bookmarks.map((bookmark) => bookmark.sourceAnchorId), [bookmarks])
  const focusedAnchor = activeSourceFocus ? anchorIndex.get(activeSourceFocus.anchorId) ?? null : null
  const focusedAnchorId = focusedAnchor?.id ?? null
  const focusedAnchorPage = focusedAnchor?.pageNumber ?? null
  const focusedAnchorY = focusedAnchor?.boundingBox.y ?? null
  const focusedAnchorHeight = focusedAnchor?.boundingBox.height ?? null
  const focusJumpKey = activeSourceFocus?.jumpKey ?? 0

  useEffect(() => {
    return () => {
      pdfController.unload()
    }
  }, [])

  useEffect(() => {
    if (!documentState) {
      pdfController.unload()
      setPdfDocument(null)
      setViewerError(null)
      return
    }

    setPdfDocument(null)
    setViewerError(null)

    const cancel = pdfController.load(
      documentState.bytes.slice(),
      (doc) => setPdfDocument(doc),
      (message) => setViewerError(message)
    )

    return () => {
      cancel()
    }
  }, [documentState])

  useEffect(() => {
    if (!rootRef.current || !focusedAnchor) {
      return
    }

    const root = rootRef.current
    let cancelled = false

    const scrollToFocusedAnchor = () => {
      const page = root.querySelector<HTMLElement>(`.page[data-page-number="${focusedAnchor.pageNumber}"]`)
      if (!page) {
        return false
      }

      const anchorRects = resolveAnchorClientRects(page, focusedAnchor)
      const targetRect = anchorRects[0] ?? null
      const pageRect = page.getBoundingClientRect()
      const targetTop = Math.max(
        0,
        page.offsetTop + ((targetRect?.top ?? pageRect.top) - pageRect.top) - 120
      )
      root.scrollTo({
        top: targetTop,
        behavior: 'smooth'
      })
      return true
    }

    if (scrollToFocusedAnchor()) {
      return
    }

    let attempts = 0
    const retry = () => {
      if (cancelled) {
        return
      }
      attempts += 1
      if (scrollToFocusedAnchor() || attempts >= 6) {
        return
      }
      window.setTimeout(retry, 120)
    }

    const retryId = window.setTimeout(retry, 120)

    return () => {
      cancelled = true
      window.clearTimeout(retryId)
    }
  }, [focusJumpKey, focusedAnchorHeight, focusedAnchorId, focusedAnchorPage, focusedAnchorY])

  const openAnchorPopup = useCallback(
    (anchorId: string) => {
      const root = rootRef.current
      const anchor = anchorIndex.get(anchorId)
      if (!root || !anchor) {
        return
      }

      const pageElement = pageElementMapRef.current.get(anchor.pageNumber)
      if (!pageElement) {
        return
      }

      const rootRect = root.getBoundingClientRect()
      const pageRect = pageElement.getBoundingClientRect()
      const anchorRects = resolveAnchorClientRects(pageElement, anchor)
      const primaryRect =
        anchorRects[0] ??
        new DOMRect(
          pageRect.left + anchor.boundingBox.x,
          pageRect.top + anchor.boundingBox.y,
          anchor.boundingBox.width,
          anchor.boundingBox.height
        )
      const popupPosition = clampPopupPosition({
        containerRect: rootRect,
        selectionRect: primaryRect,
        popupWidth: 560,
        popupHeight: 124
      })

      const selectionBounds = {
        left: primaryRect.left - rootRect.left + root.scrollLeft,
        top: primaryRect.top - rootRect.top + root.scrollTop,
        width: primaryRect.width,
        height: primaryRect.height
      }

      setPopupState({
        selection: {
          workspaceId,
          documentId: documentState?.record.id ?? anchor.documentId,
          text: anchor.textQuote,
          pageNumber: anchor.pageNumber,
          startSpanIndex: anchor.startSpanIndex,
          startOffset: anchor.startOffset,
          endSpanIndex: anchor.endSpanIndex,
          endOffset: anchor.endOffset,
          boundingBox: anchor.boundingBox,
          quadPoints: anchor.quadPoints,
          viewportScale: anchor.viewportScale,
          selectionColor:
            highlightedAnchors.find((item) => item.anchorId === anchorId)?.selectionColor ?? '#5d5df6',
          tags: anchor.tags ?? []
        },
        left: popupPosition.left + root.scrollLeft,
        top: popupPosition.top + root.scrollTop,
        viewportRatio:
          root.clientHeight > 0 ? (primaryRect.top - rootRect.top + root.scrollTop) / root.clientHeight : 0.25,
        tags: anchor.tags ?? [],
        selectionBounds
      })
      restorePdfSelectionFromAnchor(pageElement, anchor)
      onOpenAnchor(anchorId)
    },
    [anchorIndex, documentState?.record.id, highlightedAnchors, onOpenAnchor, workspaceId]
  )

  useEffect(() => {
    const root = rootRef.current
    const shell = shellRef.current
    if (!root || !shell || !documentState) {
      return
    }

    const measure = () => {
      const shellRect = shell.getBoundingClientRect()
      const metrics: Record<string, AnchorViewportMetric> = {}
      anchors.forEach((anchor) => {
        const pageElement = pageElementMapRef.current.get(anchor.pageNumber) ?? null
        const metric = measureAnchorMetric(anchor, pageElement, shellRect)
        if (metric) {
          metrics[anchor.id] = metric
        }
      })
      onAnchorMetricsChange(metrics)
    }

    const scheduleMeasure = () => {
      requestAnimationFrame(measure)
    }

    scheduleMeasure()
    root.addEventListener('scroll', scheduleMeasure)
    window.addEventListener('resize', scheduleMeasure)

    return () => {
      root.removeEventListener('scroll', scheduleMeasure)
      window.removeEventListener('resize', scheduleMeasure)
    }
  }, [anchors, documentState, onAnchorMetricsChange, pageRenderTick, shellRef])

  const isPdfFile = useCallback((file: File | null | undefined) => {
    if (!file) return false
    const name = file.name?.toLowerCase?.() ?? ''
    const type = file.type?.toLowerCase?.() ?? ''
    return type === 'application/pdf' || name.endsWith('.pdf')
  }, [])

  const clampZoom = useCallback((next: number) => Math.max(0.6, Math.min(3, Number(next.toFixed(2)))), [])
  const zoomIn = useCallback(() => setZoom((current) => clampZoom(current + 0.1)), [clampZoom])
  const zoomOut = useCallback(() => setZoom((current) => clampZoom(current - 0.1)), [clampZoom])
  const zoomReset = useCallback(() => setZoom(1), [])

  useEffect(() => {
    const root = rootRef.current
    if (!root) {
      return
    }

    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) {
        return
      }

      event.preventDefault()
      if (event.deltaY < 0) {
        setZoom((current) => clampZoom(current + 0.1))
      } else if (event.deltaY > 0) {
        setZoom((current) => clampZoom(current - 0.1))
      }
    }

    root.addEventListener('wheel', onWheel, { passive: false })
    return () => root.removeEventListener('wheel', onWheel as any)
  }, [clampZoom])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey) {
        return
      }

      if (event.key === '+' || event.key === '=') {
        event.preventDefault()
        zoomIn()
      } else if (event.key === '-') {
        event.preventDefault()
        zoomOut()
      } else if (event.key === '0') {
        event.preventDefault()
        zoomReset()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [zoomIn, zoomOut, zoomReset])

  async function importPdfFile(file: File) {
    let loadingTask: any = null

    try {
      if (!isPdfFile(file)) {
        setViewerError('Only PDF files are supported right now.')
        return
      }

      const pdfjs = await loadPdfModule()
      const sourceBytes = new Uint8Array(await file.arrayBuffer())
      const viewerBytes = sourceBytes.slice()
      const storedBytes = sourceBytes.slice()
      loadingTask = pdfjs.getDocument({ data: viewerBytes })
      let pdf: any = null
      try {
        pdf = await loadingTask.promise
      } catch (error: any) {
        const message = error instanceof Error ? error.message : String(error)
        const looksLikeWorkerFailure =
          error?.name === 'UnknownErrorException' ||
          /worker/i.test(message) ||
          /Setting up fake worker failed/i.test(message) ||
          /Failed to fetch dynamically imported module/i.test(message)
        if (!looksLikeWorkerFailure) {
          throw error
        }

        if (loadingTask?.destroy) {
          try {
            await loadingTask.destroy()
          } catch {}
        }

        loadingTask = pdfjs.getDocument({ data: viewerBytes, disableWorker: true })
        pdf = await loadingTask.promise
      }
      const now = new Date().toISOString()

      await loadingTask.destroy()
      loadingTask = null

      onDocumentImported({
        record: {
          id: `document-${file.name.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()}-${sourceBytes.byteLength}`,
          workspaceId,
          title: file.name,
          storageKey: file.name,
          mimeType: 'application/pdf',
          pageCount: pdf.numPages,
          checksum: `${sourceBytes.byteLength}-${sourceBytes[0] ?? 0}-${sourceBytes[sourceBytes.length - 1] ?? 0}`,
          createdAt: now,
          updatedAt: now
        },
        bytes: storedBytes
      })

      setViewerError(null)
    } catch (error) {
      if (loadingTask?.destroy) {
        try {
          await loadingTask.destroy()
        } catch {}
      }

      const err = error as any
      if (err?.name === 'PasswordException') {
        setViewerError('This PDF is password-protected and cannot be opened.')
      } else if (err?.name === 'InvalidPDFException') {
        setViewerError('This file is not a valid PDF.')
      } else {
        setViewerError(error instanceof Error ? error.message : 'Failed to import PDF.')
      }
    }
  }

  return (
    <div className="document-layout">
      <div className="document-topbar">
        <div className="split-title">Source Document</div>
        <div className="document-topbar-actions">
          <button className="document-button" type="button" onClick={() => fileInputRef.current?.click()}>
            Import PDF
          </button>
          {documentState ? <span className="document-meta">{documentState.record.title}</span> : null}
          {documentState && viewerError ? <span className="document-import-error">{viewerError}</span> : null}
          {documentState && pdfDocument ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button className="document-button" type="button" onClick={zoomOut}>
                -
              </button>
              <button className="document-button" type="button" onClick={zoomReset}>
                {Math.round(zoom * 100)}%
              </button>
              <button className="document-button" type="button" onClick={zoomIn}>
                +
              </button>
            </div>
          ) : null}
        </div>
        <input
          ref={fileInputRef}
          hidden
          type="file"
          accept="application/pdf,.pdf"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) {
              void importPdfFile(file)
            }
            event.target.value = ''
          }}
        />
      </div>

      {!documentState || !pdfDocument ? (
        <div
          className="document-import-surface"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault()
            const file = event.dataTransfer.files?.[0]
            if (isPdfFile(file)) {
              void importPdfFile(file)
            } else if (file) {
              setViewerError('Only PDF files are supported right now.')
            }
          }}
        >
          <div className="document-import-card">
            <div className="document-import-title">Drop a PDF here</div>
            <p>Import a local PDF to enable real selection, action popup, workspace nodes, and bidirectional links.</p>
            {viewerError ? <p className="document-import-error">{viewerError}</p> : null}
            <button className="document-button" type="button" onClick={() => fileInputRef.current?.click()}>
              Choose PDF
            </button>
          </div>
        </div>
      ) : (
        <div className="document-body">
          <aside className="document-rail">
            <div className="document-rail-section">
              <div className="split-title">Excerpts</div>
              {excerptNodes.length === 0 ? (
                <div className="document-empty-copy">No excerpts yet.</div>
              ) : (
                excerptNodes.map((node) => (
                  <button
                    key={node.id}
                    className="bookmark-item"
                    type="button"
                    onClick={() => onOpenAnchor(node.sourceAnchorId)}
                    title={node.text}
                  >
                    <span className="bookmark-chip" style={{ background: node.selectionColor }} />
                    <span style={{ fontSize: 12, lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                      {node.text || node.title}
                    </span>
                  </button>
                ))
              )}
            </div>
            <div className="document-rail-section" style={{ marginTop: 16 }}>
              <div className="split-title">Bookmarks</div>
              {bookmarks.length === 0 ? (
                <div className="document-empty-copy">No bookmarks yet.</div>
              ) : (
                bookmarks
                  .sort((left, right) => left.documentOrder - right.documentOrder)
                  .map((bookmark) => (
                    <button
                      key={bookmark.id}
                      className="bookmark-item"
                      type="button"
                      onClick={() => onOpenAnchor(bookmark.sourceAnchorId)}
                    >
                      <span className="bookmark-chip" style={{ background: bookmark.selectionColor }} />
                      <span>{bookmark.bookmarkLabel}</span>
                    </button>
                  ))
              )}
            </div>
          </aside>

          <div ref={rootRef} className="document-scroll">
            {Array.from({ length: pdfDocument.numPages }, (_, index) => index + 1).map((pageNumber) => (
              <PdfPage
                key={pageNumber}
                pdfDocument={pdfDocument}
                pageNumber={pageNumber}
                pageHighlights={highlightedAnchors.filter((item) => item.pageNumber === pageNumber)}
                focusedAnchor={focusedAnchor?.pageNumber === pageNumber ? focusedAnchor : null}
                focusedColor={focusedAnchor?.pageNumber === pageNumber ? activeSourceFocus?.selectionColor ?? '#ffd400' : null}
                pageBookmarks={bookmarks.filter((bookmark) => anchorIndex.get(bookmark.sourceAnchorId)?.pageNumber === pageNumber)}
                bookmarkAnchors={anchorIndex}
                onOpenAnchor={onOpenAnchor}
                onEditAnchor={openAnchorPopup}
                registerCanvas={registerCanvas}
                registerPage={registerPage}
                onRendered={handlePageRendered}
                onRenderError={handlePageRenderError}
                viewportScale={viewportScale}
              />
            ))}

            <SelectionManager
              rootRef={rootRef}
              workspaceId={workspaceId}
              documentId={documentState.record.id}
              bookmarkedAnchorIds={bookmarkedAnchorIds}
              popupState={popupState}
              onPopupStateChange={setPopupState}
              onAutoExcerpt={onAutoExcerpt}
              onComment={onComment}
              onBookmark={onBookmark}
              onTag={onTag}
              onSelectionChange={onSelectionChange}
            />
          </div>
        </div>
      )}
    </div>
  )
}

function PdfPage({
  pdfDocument,
  pageNumber,
  pageHighlights,
  focusedAnchor,
  focusedColor,
  pageBookmarks,
  bookmarkAnchors,
  onOpenAnchor,
  onEditAnchor,
  registerCanvas,
  registerPage,
  onRendered,
  onRenderError,
  viewportScale
}: {
  pdfDocument: any
  pageNumber: number
  pageHighlights: HighlightDescriptor[]
  focusedAnchor: PageAnchor | null
  focusedColor: string | null
  pageBookmarks: Bookmark[]
  bookmarkAnchors: Map<string, PageAnchor>
  onOpenAnchor: (anchorId: string) => void
  onEditAnchor: (anchorId: string) => void
  registerCanvas: (pageNumber: number, canvas: HTMLCanvasElement | null) => void
  registerPage: (pageNumber: number, page: HTMLDivElement | null) => void
  onRendered: () => void
  onRenderError: (pageNumber: number, error: unknown) => void
  viewportScale: number
}) {
  const HIGHLIGHT_CLICK_DELAY_MS = 220
  const pageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textLayerRef = useRef<HTMLDivElement>(null)
  const renderTaskRef = useRef<any>(null)
  const textLayerTaskRef = useRef<any>(null)
  const pendingOpenRef = useRef<number | null>(null)

  useEffect(() => {
    registerPage(pageNumber, pageRef.current)
    return () => registerPage(pageNumber, null)
  }, [pageNumber, registerPage])

  const gestureRef = useRef<{
    pointerId: number | null
    startX: number
    startY: number
    candidateAnchorId: string | null
    moved: boolean
    selectionChanged: boolean
  }>({
    pointerId: null,
    startX: 0,
    startY: 0,
    candidateAnchorId: null,
    moved: false,
    selectionChanged: false
  })

  const findHighlightAtPoint = useCallback(
    (x: number, y: number) => {
      const pointInQuad = (quad: number[]) => {
        const xs = [quad[0], quad[2], quad[4], quad[6]]
        const ys = [quad[1], quad[3], quad[5], quad[7]]
        return x >= Math.min(...xs) && x <= Math.max(...xs) && y >= Math.min(...ys) && y <= Math.max(...ys)
      }

      for (let i = pageHighlights.length - 1; i >= 0; i--) {
        const highlight = pageHighlights[i]
        if (highlight.quadPoints?.length) {
          for (let index = 0; index < highlight.quadPoints.length; index += 8) {
            const quad = highlight.quadPoints.slice(index, index + 8)
            if (quad.length === 8 && pointInQuad(quad)) {
              return highlight.anchorId
            }
          }
        }

        if (
          x >= highlight.boundingBox.x &&
          x <= highlight.boundingBox.x + highlight.boundingBox.width &&
          y >= highlight.boundingBox.y &&
          y <= highlight.boundingBox.y + highlight.boundingBox.height
        ) {
          return highlight.anchorId
        }
      }

      return null
    },
    [pageHighlights]
  )

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (pendingOpenRef.current) {
      window.clearTimeout(pendingOpenRef.current)
      pendingOpenRef.current = null
    }

    const rect = pageRef.current?.getBoundingClientRect()
    if (!rect || event.button !== 0) {
      return
    }

    const x = event.clientX - rect.left
    const y = event.clientY - rect.top
    gestureRef.current = {
      pointerId: event.pointerId,
      startX: x,
      startY: y,
      candidateAnchorId: event.detail > 1 ? null : findHighlightAtPoint(x, y),
      moved: false,
      selectionChanged: false
    }
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current
    if (gesture.pointerId !== event.pointerId) {
      return
    }

    const rect = pageRef.current?.getBoundingClientRect()
    if (!rect) {
      return
    }

    const x = event.clientX - rect.left
    const y = event.clientY - rect.top
    if (Math.hypot(x - gesture.startX, y - gesture.startY) > 5) {
      gesture.moved = true
      gesture.candidateAnchorId = null
    }
  }

  const resetGesture = useCallback(() => {
    gestureRef.current = {
      pointerId: null,
      startX: 0,
      startY: 0,
      candidateAnchorId: null,
      moved: false,
      selectionChanged: false
    }
  }, [])

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current
    if (gesture.pointerId !== event.pointerId) {
      return
    }

    const selectionText = document.getSelection()?.toString().trim() ?? ''
    const shouldOpen =
      !gesture.moved &&
      !gesture.selectionChanged &&
      selectionText.length === 0 &&
      gesture.candidateAnchorId

    const anchorId = gesture.candidateAnchorId
    resetGesture()

    if (shouldOpen && anchorId) {
      pendingOpenRef.current = window.setTimeout(() => {
        pendingOpenRef.current = null
        if ((document.getSelection()?.toString().trim() ?? '').length === 0) {
          onEditAnchor(anchorId)
        }
      }, HIGHLIGHT_CLICK_DELAY_MS)
    }
  }

  useEffect(() => {
    const handleSelectionChange = () => {
      const selectionText = document.getSelection()?.toString().trim() ?? ''
      if (selectionText.length > 0 && gestureRef.current.pointerId !== null) {
        gestureRef.current.selectionChanged = true
        gestureRef.current.candidateAnchorId = null
      }
      if (selectionText.length > 0 && pendingOpenRef.current) {
        window.clearTimeout(pendingOpenRef.current)
        pendingOpenRef.current = null
      }
    }

    document.addEventListener('selectionchange', handleSelectionChange)
    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange)
      if (pendingOpenRef.current) {
        window.clearTimeout(pendingOpenRef.current)
        pendingOpenRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    const textLayer = textLayerRef.current
    if (!canvas || !textLayer || !pdfDocument) {
      return
    }

    registerCanvas(pageNumber, canvas)

    let cancelled = false

    async function renderPage() {
      try {
        const currentCanvas = canvasRef.current
        const currentTextLayer = textLayerRef.current
        if (!currentCanvas || !currentTextLayer || !pdfDocument) {
          return
        }

        const pdfjs = await loadPdfModule()
        if (cancelled || !pdfDocument) {
          return
        }

        const page = await pdfDocument.getPage(pageNumber)
        if (cancelled || !page) {
          return
        }

        const viewport = page.getViewport({ scale: viewportScale })
        const ratio = window.devicePixelRatio || 1
        const context = currentCanvas.getContext('2d')
        if (!context) {
          return
        }

        currentCanvas.width = Math.floor(viewport.width * ratio)
        currentCanvas.height = Math.floor(viewport.height * ratio)
        currentCanvas.style.width = `${viewport.width}px`
        currentCanvas.style.height = `${viewport.height}px`
        context.setTransform(ratio, 0, 0, ratio, 0, 0)

        const renderTask = page.render({ canvasContext: context, viewport })
        renderTaskRef.current = renderTask
        await renderTask.promise
        renderTaskRef.current = null
        if (cancelled || !pdfDocument) {
          return
        }

        currentTextLayer.replaceChildren()
        const textContent = await page.getTextContent()
        if (cancelled || !pdfDocument) {
          return
        }
        const textLayerTask = new pdfjs.TextLayer({
          textContentSource: textContent,
          container: currentTextLayer,
          viewport
        })
        textLayerTaskRef.current = textLayerTask
        await textLayerTask.render()
        textLayerTaskRef.current = null
        if (cancelled || !pdfDocument) {
          return
        }
        indexTextLayerSpans(currentTextLayer)
        onRendered()
      } catch (error: any) {
        if (
          cancelled ||
          error?.name === 'RenderingCancelledException' ||
          error?.name === 'AbortException' ||
          error?.name === 'UnknownErrorException'
        ) {
          return
        }

        console.error('[PDFViewer] failed to render page', pageNumber, error)
        onRenderError(pageNumber, error)
      }
    }

    void renderPage()

    return () => {
      cancelled = true
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel()
        renderTaskRef.current = null
      }
      if (textLayerTaskRef.current?.cancel) {
        textLayerTaskRef.current.cancel()
        textLayerTaskRef.current = null
      }
      registerCanvas(pageNumber, null)
    }
  }, [pageNumber, pdfDocument, registerCanvas, onRendered])

  return (
    <div
      ref={pageRef}
      className="page"
      data-page-number={pageNumber}
      data-viewport-scale={String(viewportScale)}
      style={{ '--total-scale-factor': String(viewportScale) } as CSSProperties}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={resetGesture}
    >
      <div className="page-bookmark-margin">
        {pageBookmarks.map((bookmark) => {
          const anchor = bookmarkAnchors.get(bookmark.sourceAnchorId)
          if (!anchor) {
            return null
          }

          const ratio = viewportScale / (anchor.viewportScale || viewportScale)
          return (
            <button
              key={bookmark.id}
              type="button"
              className="page-bookmark-indicator"
              style={{
                top: anchor.boundingBox.y * ratio,
                background: bookmark.selectionColor
              }}
              onClick={() => onOpenAnchor(bookmark.sourceAnchorId)}
            />
          )
        })}
      </div>
      <canvas ref={canvasRef} className="document-page-canvas" />
      <div ref={textLayerRef} className="textLayer" />
      {pageHighlights.map((highlight) => (
        <button
          key={highlight.anchorId}
          type="button"
          className="document-highlight-button"
          style={{
            left: highlight.boundingBox.x * (viewportScale / (highlight.viewportScale || viewportScale)),
            top: highlight.boundingBox.y * (viewportScale / (highlight.viewportScale || viewportScale)),
            width: highlight.boundingBox.width * (viewportScale / (highlight.viewportScale || viewportScale)),
            height: highlight.boundingBox.height * (viewportScale / (highlight.viewportScale || viewportScale)),
            background: `${highlight.selectionColor}2d`,
            borderColor: highlight.selectionColor,
            pointerEvents: 'none'
          }}
        />
      ))}
      {focusedAnchor && focusedColor ? (
        <div
          className="document-focus-overlay"
          style={{
            left: focusedAnchor.boundingBox.x * (viewportScale / (focusedAnchor.viewportScale || viewportScale)),
            top: focusedAnchor.boundingBox.y * (viewportScale / (focusedAnchor.viewportScale || viewportScale)),
            width: focusedAnchor.boundingBox.width * (viewportScale / (focusedAnchor.viewportScale || viewportScale)),
            height: focusedAnchor.boundingBox.height * (viewportScale / (focusedAnchor.viewportScale || viewportScale)),
            background: `${focusedColor}25`,
            borderColor: focusedColor,
            pointerEvents: 'none'
          }}
        />
      ) : null}
    </div>
  )
}
