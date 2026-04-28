'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react'
import type { Bookmark, PageAnchor } from '@workspace/domain'
import bookmarkIcon from '../../bookmark.png'
import type { PersistedPdfDocument } from '../../lib/workspace/workspace-state'
import {
  resolveAnchorClientRects,
  restorePdfSelectionFromAnchor,
  type SelectionArtifactInput
} from '../../lib/excerpts/pdf-selection'
import {
  getLiveAnchorElements,
  measureAnchorMetric,
  measureTextLayerSpanCenterY,
  type AnchorViewportMetric
} from './AnchorService'
import { clampPopupPosition } from './AnchorService'
import { SelectionManager, type SelectionPopupState } from './SelectionManager'

type PdfLoadingTaskLike = {
  promise: Promise<PdfDocumentLike>
  destroy?: () => Promise<void> | void
}

type PdfDocumentLike = {
  numPages: number
  getPage: (pageNumber: number) => Promise<PdfPageLike>
  destroy?: () => Promise<void> | void
}

type PdfPageLike = {
  getViewport: (params: { scale: number }) => { width: number; height: number }
  render: (params: {
    canvasContext: CanvasRenderingContext2D
    viewport: { width: number; height: number }
    intent?: string
  }) => PdfRenderTaskLike
  getTextContent: () => Promise<unknown>
  cleanup?: () => void
}

type PdfRenderTaskLike = {
  promise: Promise<void>
  cancel: () => void
}

type PdfTextLayerTaskLike = {
  render: () => Promise<void>
  cancel?: () => void
}

type PdfJsModuleLike = {
  version: string
  GlobalWorkerOptions: { workerSrc: string }
  getDocument: (params: { data: Uint8Array; disableWorker?: boolean }) => PdfLoadingTaskLike
  TextLayer: new (params: {
    textContentSource: unknown
    container: HTMLElement
    viewport: { width: number; height: number }
  }) => PdfTextLayerTaskLike
}

let pdfModulePromise: Promise<PdfJsModuleLike> | null = null
let pdfModuleConfigured = false

async function loadPdfModule() {
  if (!pdfModulePromise) {
    pdfModulePromise = import('pdfjs-dist/legacy/build/pdf.mjs') as unknown as Promise<PdfJsModuleLike>
  }

  const pdfjs = await pdfModulePromise
  if (!pdfModuleConfigured) {
    pdfModuleConfigured = true
    pdfjs.GlobalWorkerOptions.workerSrc =
      `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/legacy/build/pdf.worker.min.mjs`
  }

  return pdfjs
}

class PdfDocumentController {
  private chain: Promise<void> = Promise.resolve()
  private activeTask: PdfLoadingTaskLike | null = null
  private activeDocument: PdfDocumentLike | null = null

  private async destroyCurrent() {
    const task = this.activeTask
    const document = this.activeDocument

    this.activeTask = null
    this.activeDocument = null

    if (task) {
      try {
        if (task.destroy) {
          await task.destroy()
        }
      } catch {}
      return
    }

    if (document?.destroy) {
      try {
        await document.destroy()
      } catch {}
    }
  }

  private async openWithFallback(pdfjs: PdfJsModuleLike, bytes: Uint8Array, preferDisableWorker: boolean) {
    const baseOptions = { data: bytes }
    const firstOptions = preferDisableWorker ? { ...baseOptions, disableWorker: true } : baseOptions
    const secondOptions = preferDisableWorker ? baseOptions : { ...baseOptions, disableWorker: true }
    let task: PdfLoadingTaskLike | null = null

    try {
      task = pdfjs.getDocument(firstOptions)
      const document = await task.promise
      return { task, document }
    } catch (error: unknown) {
      if (task?.destroy) {
        try {
          await task.destroy()
        } catch {}
      }

      const message = error instanceof Error ? error.message : String(error)
      const errorName = (error as { name?: unknown } | null)?.name
      const looksLikeWorkerFailure =
        errorName === 'UnknownErrorException' ||
        /worker/i.test(message) ||
        /Setting up fake worker failed/i.test(message) ||
        /Failed to fetch dynamically imported module/i.test(message) ||
        /Object\.defineProperty called on non-object/i.test(message)

      if (!preferDisableWorker && !looksLikeWorkerFailure) {
        throw error
      }

      task = pdfjs.getDocument(secondOptions)
      const document = await task.promise
      return { task, document }
    }
  }

  load(bytes: Uint8Array, onSuccess: (doc: PdfDocumentLike) => void, onError: (message: string) => void): () => void {
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
      } catch (error: unknown) {
        await this.destroyCurrent()
        const errorName = (error as { name?: unknown } | null)?.name
        if (cancelled || errorName === 'AbortException') {
          return
        }
        if (errorName === 'PasswordException') {
          onError('This PDF is password-protected and cannot be opened.')
          return
        }
        if (errorName === 'InvalidPDFException') {
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
  startSpanIndex?: number
  startOffset?: number
  endSpanIndex?: number
  endOffset?: number
  boundingBox: PageAnchor['boundingBox']
  quadPoints?: number[]
  viewportScale?: number
  selectionColor: string
  tags?: string[]
  showHighlight?: boolean
  showMarker?: boolean
  showBookmarkIcon?: boolean
  showTagBadges?: boolean
}

type RenderedHighlightRect = { key: string; left: number; top: number; width: number; height: number }

function buildRectsFromQuadPoints(highlight: HighlightDescriptor, viewportScale: number) {
  if (!highlight.quadPoints || highlight.quadPoints.length < 8) {
    return []
  }

  const ratio = viewportScale / (highlight.viewportScale || viewportScale)
  const rects: Array<{ key: string; left: number; top: number; width: number; height: number }> = []
  for (let index = 0; index < highlight.quadPoints.length; index += 8) {
    const quad = highlight.quadPoints.slice(index, index + 8)
    if (quad.length < 8) {
      continue
    }

    const xs = [quad[0], quad[2], quad[4], quad[6]]
    const ys = [quad[1], quad[3], quad[5], quad[7]]
    const left = Math.min(...xs) * ratio
    const top = Math.min(...ys) * ratio
    const right = Math.max(...xs) * ratio
    const bottom = Math.max(...ys) * ratio

    rects.push({
      key: `${highlight.anchorId}-quad-${index / 8}`,
      left,
      top,
      width: right - left,
      height: bottom - top
    })
  }

  return rects
}

function getTopmostRect(rects: RenderedHighlightRect[]) {
  return [...rects].sort((left, right) => left.top - right.top || left.left - right.left)[0] ?? null
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
  linkedNodes: {
    id: string
    sourceAnchorId: string
    title: string
    text: string
    selectionColor: string
    tags?: string[]
  }[]
  activeTag: string | null
  pageZoom: number
  availableTags: string[]
  onPageZoomChange: (zoom: number) => void
  onToggleTag: (tag: string) => void
  onClearTagFilter: () => void
  activeSourceFocus: {
    anchorId: string
    selectionColor: string
    jumpKey: number
  } | null
  onDocumentImported: (document: PersistedPdfDocument) => void
  onAutoExcerpt: (payload: { selection: SelectionArtifactInput; viewportRatio: number }) => void
  onComment: (payload: { selection: SelectionArtifactInput; viewportRatio: number }) => void
  onBookmark: (selection: SelectionArtifactInput) => void
  onRemoveExcerpt?: (anchorId: string) => void
  onRemoveHighlight?: (payload: { anchorId: string; selection: SelectionArtifactInput }) => void
  onTag: (selection: SelectionArtifactInput, tags: string[]) => void
  onSelectionChange: (selection: SelectionArtifactInput) => void
  onOpenAnchor: (anchorId: string) => void
  onAnchorMetricsChange: (metrics: Record<string, AnchorViewportMetric>) => void
  onClearFocus?: () => void
}

function hueFromString(input: string) {
  let hash = 0
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0
  }
  return Math.abs(hash) % 360
}

export function PDFViewer({
  shellRef,
  workspaceId,
  documentState,
  anchors,
  highlightedAnchors,
  bookmarks,
  linkedNodes,
  activeTag,
  pageZoom,
  availableTags,
  onPageZoomChange,
  onToggleTag,
  onClearTagFilter,
  activeSourceFocus,
  onDocumentImported,
  onAutoExcerpt,
  onComment,
  onBookmark,
  onRemoveExcerpt,
  onRemoveHighlight,
  onTag,
  onSelectionChange,
  onOpenAnchor,
  onAnchorMetricsChange,
  onClearFocus
}: PdfViewerProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pageCanvasMapRef = useRef(new Map<number, HTMLCanvasElement>())
  const pageElementMapRef = useRef(new Map<number, HTMLElement>())
  const measureFrameRef = useRef<number | null>(null)
  const [pdfDocument, setPdfDocument] = useState<PdfDocumentLike | null>(null)
  const [viewerError, setViewerError] = useState<string | null>(null)
  const [popupState, setPopupState] = useState<SelectionPopupState | null>(null)
  const [pageRenderTick, setPageRenderTick] = useState(0)
  const baseViewportScale = 1.35
  const viewportScale = useMemo(() => Number((baseViewportScale * pageZoom).toFixed(3)), [pageZoom])
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
  const linkedAnchorIds = useMemo(() => linkedNodes.map((node) => node.sourceAnchorId), [linkedNodes])
  const focusedAnchor = activeSourceFocus ? anchorIndex.get(activeSourceFocus.anchorId) ?? null : null
  const activeTagMatches = useMemo(
    () =>
      activeTag
        ? highlightedAnchors
            .map((highlight) => anchorIndex.get(highlight.anchorId))
            .filter((anchor): anchor is PageAnchor => Boolean(anchor))
        : [],
    [activeTag, anchorIndex, highlightedAnchors]
  )
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
  }, [focusJumpKey, focusedAnchor])

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
        selectionRects: anchorRects.length > 0 ? anchorRects : [primaryRect],
        popupWidth: 560,
        popupHeight: 124
      })

      const selectionBounds = {
        left: primaryRect.left - rootRect.left + root.scrollLeft,
        top: primaryRect.top - rootRect.top + root.scrollTop,
        width: primaryRect.width,
        height: primaryRect.height
      }
      const selectionClientRects = (anchorRects.length > 0 ? anchorRects : [primaryRect]).map((rect) => ({
        left: rect.left - rootRect.left + root.scrollLeft,
        top: rect.top - rootRect.top + root.scrollTop,
        width: rect.width,
        height: rect.height
      }))

      setPopupState({
        anchorId,
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
          selectionColor: anchor.selectionColor ?? highlightedAnchors.find((item) => item.anchorId === anchorId)?.selectionColor ?? '#5d5df6',
          tags: anchor.tags ?? []
        },
        left: popupPosition.left + root.scrollLeft,
        top: popupPosition.top + root.scrollTop,
        viewportRatio:
          root.clientHeight > 0 ? (primaryRect.top - rootRect.top + root.scrollTop) / root.clientHeight : 0.25,
        tags: anchor.tags ?? [],
        selectionBounds,
        selectionClientRects
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
      const shellScale = shell.offsetWidth > 0 ? shellRect.width / shell.offsetWidth : 1
      const metrics: Record<string, AnchorViewportMetric> = {}
      anchors.forEach((anchor) => {
        const pageElement = pageElementMapRef.current.get(anchor.pageNumber) ?? null
        const metric = measureAnchorMetric(anchor, pageElement, shellRect, shellScale)
        if (metric) {
          metrics[anchor.id] = metric
        }
      })
      onAnchorMetricsChange(metrics)
    }

    const scheduleMeasure = () => {
      if (measureFrameRef.current != null) {
        return
      }

      measureFrameRef.current = requestAnimationFrame(() => {
        measureFrameRef.current = null
        measure()
      })
    }

    scheduleMeasure()
    root.addEventListener('scroll', scheduleMeasure)
    window.addEventListener('resize', scheduleMeasure)

    return () => {
      if (measureFrameRef.current != null) {
        cancelAnimationFrame(measureFrameRef.current)
        measureFrameRef.current = null
      }
      root.removeEventListener('scroll', scheduleMeasure)
      window.removeEventListener('resize', scheduleMeasure)
    }
  }, [anchors, documentState, onAnchorMetricsChange, pageRenderTick, shellRef, viewportScale])

  const isPdfFile = useCallback((file: File | null | undefined) => {
    if (!file) return false
    const name = file.name?.toLowerCase?.() ?? ''
    const type = file.type?.toLowerCase?.() ?? ''
    return type === 'application/pdf' || name.endsWith('.pdf')
  }, [])

  const clampZoom = useCallback((next: number) => Math.max(0.3, Math.min(3, Number(next.toFixed(2)))), [])
  const zoomIn = useCallback(() => onPageZoomChange(clampZoom(pageZoom + 0.1)), [clampZoom, onPageZoomChange, pageZoom])
  const zoomOut = useCallback(() => onPageZoomChange(clampZoom(pageZoom - 0.1)), [clampZoom, onPageZoomChange, pageZoom])
  const zoomReset = useCallback(() => onPageZoomChange(1), [onPageZoomChange])

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
        onPageZoomChange(clampZoom(pageZoom + 0.1))
      } else if (event.deltaY > 0) {
        onPageZoomChange(clampZoom(pageZoom - 0.1))
      }
    }

    const wheelListener: EventListener = (event) => {
      onWheel(event as WheelEvent)
    }

    root.addEventListener('wheel', wheelListener, { passive: false })
    return () => root.removeEventListener('wheel', wheelListener)
  }, [clampZoom, onPageZoomChange, pageZoom])

  async function importPdfFile(file: File) {
    let loadingTask: PdfLoadingTaskLike | null = null

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
      let pdf: PdfDocumentLike | null = null
      try {
        pdf = await loadingTask.promise
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        const errorName = (error as { name?: unknown } | null)?.name
        const looksLikeWorkerFailure =
          errorName === 'UnknownErrorException' ||
          /worker/i.test(message) ||
          /Setting up fake worker failed/i.test(message) ||
          /Failed to fetch dynamically imported module/i.test(message) ||
          /Object\.defineProperty called on non-object/i.test(message)

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

      if (loadingTask?.destroy) {
        await loadingTask.destroy()
      }
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

      const err = error as { name?: unknown } | null
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
            <div className="document-page-zoom-controls" aria-label="Page zoom controls">
              <button className="document-button" type="button" onClick={zoomOut} title="Zoom out page" aria-label="Zoom out page">
                -
              </button>
              <button className="document-button document-page-zoom-reset" type="button" onClick={zoomReset} title="Reset page zoom" aria-label="Reset page zoom">
                Page {Math.round(pageZoom * 100)}%
              </button>
              <button className="document-button" type="button" onClick={zoomIn} title="Zoom in page" aria-label="Zoom in page">
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
              {linkedNodes.length === 0 ? (
                <div className="document-empty-copy">No excerpts yet.</div>
              ) : (
                linkedNodes.map((node) => (
                  <button
                    key={node.id}
                    className="bookmark-item"
                    type="button"
                    onClick={() => onOpenAnchor(node.sourceAnchorId)}
                    title={node.text}
                  >
                    <span className="bookmark-chip" style={{ background: node.selectionColor }} />
                    <span className="bookmark-item-body">
                      <span className="bookmark-item-title">{node.text || node.title}</span>
                      {node.tags?.length ? (
                        <span className="bookmark-item-tags">
                          {node.tags.slice(0, 3).map((tag) => (
                            <span key={tag} className="bookmark-item-tag">
                              {tag}
                            </span>
                          ))}
                          {node.tags.length > 3 ? <span className="bookmark-item-tag">+{node.tags.length - 3}</span> : null}
                        </span>
                      ) : null}
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
                      <span className="bookmark-chip bookmark-chip-image">
                        <img src={bookmarkIcon.src} alt="" />
                      </span>
                      <span className="bookmark-item-body">
                        <span className="bookmark-item-title">{bookmark.bookmarkLabel}</span>
                        {bookmark.tags?.length ? (
                          <span className="bookmark-item-tags">
                            {bookmark.tags.slice(0, 3).map((tag) => (
                              <span key={tag} className="bookmark-item-tag">
                                {tag}
                              </span>
                            ))}
                            {bookmark.tags.length > 3 ? <span className="bookmark-item-tag">+{bookmark.tags.length - 3}</span> : null}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  ))
              )}
            </div>
            <div className="document-rail-section" style={{ marginTop: 16 }}>
              <div className="split-title">Tags</div>
              {availableTags.length === 0 ? (
                <div className="document-empty-copy">No tags yet.</div>
              ) : (
                <div className="document-tag-filter-list">
                  {availableTags.map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      className={`document-tag-filter-chip${activeTag === tag ? ' is-active' : ''}`}
                      onClick={() => onToggleTag(tag)}
                    >
                      #{tag}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="document-tag-filter-clear"
                    onClick={onClearTagFilter}
                    disabled={!activeTag}
                  >
                    Clear Filter
                  </button>
                </div>
              )}
              {activeTag ? (
                <div className="document-tag-match-list" aria-live="polite">
                  <div className="document-tag-match-heading">Tagged text</div>
                  {activeTagMatches.length === 0 ? (
                    <div className="document-empty-copy">No source sentence tagged with #{activeTag}.</div>
                  ) : (
                    activeTagMatches.map((anchor) => (
                      <button
                        key={anchor.id}
                        type="button"
                        className="document-tag-match-item"
                        onClick={() => onOpenAnchor(anchor.id)}
                      >
                        <span className="document-tag-match-page">Page {anchor.pageNumber}</span>
                        <span>{anchor.textQuote}</span>
                      </button>
                    ))
                  )}
                </div>
              ) : null}
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
                onEditAnchor={openAnchorPopup}
                registerCanvas={registerCanvas}
                registerPage={registerPage}
                onRendered={handlePageRendered}
                onRenderError={handlePageRenderError}
                viewportScale={viewportScale}
                activeTag={activeTag}
                onToggleTag={onToggleTag}
              />
            ))}

            <SelectionManager
              rootRef={rootRef}
              workspaceId={workspaceId}
              documentId={documentState.record.id}
              bookmarkedAnchorIds={bookmarkedAnchorIds}
              linkedAnchorIds={linkedAnchorIds}
              popupState={popupState}
              onPopupStateChange={setPopupState}
              onAutoExcerpt={onAutoExcerpt}
              onComment={onComment}
              onBookmark={onBookmark}
              onRemoveExcerpt={onRemoveExcerpt}
              onRemoveHighlight={onRemoveHighlight}
              onTag={onTag}
              onSelectionChange={onSelectionChange}
              onClearFocus={onClearFocus}
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
  onEditAnchor,
  registerCanvas,
  registerPage,
  onRendered,
  onRenderError,
  viewportScale,
  activeTag,
  onToggleTag
}: {
  pdfDocument: PdfDocumentLike
  pageNumber: number
  pageHighlights: HighlightDescriptor[]
  focusedAnchor: PageAnchor | null
  focusedColor: string | null
  onEditAnchor: (anchorId: string) => void
  registerCanvas: (pageNumber: number, canvas: HTMLCanvasElement | null) => void
  registerPage: (pageNumber: number, page: HTMLDivElement | null) => void
  onRendered: () => void
  onRenderError: (pageNumber: number, error: unknown) => void
  viewportScale: number
  activeTag: string | null
  onToggleTag: (tag: string) => void
}) {
  const HIGHLIGHT_CLICK_DELAY_MS = 220
  const pageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textLayerRef = useRef<HTMLDivElement>(null)
  const renderTaskRef = useRef<PdfRenderTaskLike | null>(null)
  const textLayerTaskRef = useRef<PdfTextLayerTaskLike | null>(null)
  const pendingOpenRef = useRef<number | null>(null)
  const [highlightRenderTick, setHighlightRenderTick] = useState(0)

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

  const marginAnchors = useMemo(() => {
    void highlightRenderTick
    const pageElement = pageRef.current
    if (!pageElement) {
      return []
    }

    const pageRect = pageElement.getBoundingClientRect()
    return pageHighlights
      .filter((highlight) => highlight.showMarker !== false)
      .map((highlight) => {
        const liveAnchor = getLiveAnchorElements(pageElement, highlight)
        const startSpanCenterY = measureTextLayerSpanCenterY(pageElement, liveAnchor.startSpan)
        const fallbackRect =
          startSpanCenterY != null
            ? null
            : resolveAnchorClientRects(pageElement, {
                ...highlight,
                viewportScale: highlight.viewportScale ?? viewportScale
              })[0] ?? null
        if (startSpanCenterY == null && !fallbackRect) {
          return null
        }

        return {
          anchorId: highlight.anchorId,
          top:
            startSpanCenterY ??
            (fallbackRect ? fallbackRect.top - pageRect.top + fallbackRect.height / 2 : 0),
          color: highlight.selectionColor
        }
      })
      .filter((item): item is { anchorId: string; top: number; color: string } => Boolean(item))
  }, [highlightRenderTick, pageHighlights, viewportScale])

  const renderedHighlights = useMemo(() => {
    void highlightRenderTick
    const pageElement = pageRef.current
    if (!pageElement) {
      return []
    }

    const pageRect = pageElement.getBoundingClientRect()
    return pageHighlights.map((highlight) => {
      const quadRects = buildRectsFromQuadPoints(highlight, viewportScale)
      const liveRects =
        quadRects.length === 0
          ? resolveAnchorClientRects(pageElement, {
              ...highlight,
              viewportScale: highlight.viewportScale ?? viewportScale
            })
          : []

      const rects = quadRects.length
        ? quadRects
        : liveRects.length > 0
          ? liveRects.map((rect, index) => ({
              key: `${highlight.anchorId}-${index}`,
              left: rect.left - pageRect.left,
              top: rect.top - pageRect.top,
              width: rect.width,
              height: rect.height
            }))
          : [
              {
                key: `${highlight.anchorId}-fallback`,
                left: highlight.boundingBox.x * (viewportScale / (highlight.viewportScale || viewportScale)),
                top: highlight.boundingBox.y * (viewportScale / (highlight.viewportScale || viewportScale)),
                width: highlight.boundingBox.width * (viewportScale / (highlight.viewportScale || viewportScale)),
                height: highlight.boundingBox.height * (viewportScale / (highlight.viewportScale || viewportScale))
              }
            ]

      return {
        ...highlight,
        rects
      }
    })
  }, [highlightRenderTick, pageHighlights, viewportScale])

  const findHighlightByTextIndex = useCallback(
    (textIndex: number) => {
      for (let i = pageHighlights.length - 1; i >= 0; i--) {
        const highlight = pageHighlights[i]
        if (highlight.startSpanIndex == null || highlight.endSpanIndex == null) {
          continue
        }

        const start = Math.min(highlight.startSpanIndex, highlight.endSpanIndex)
        const end = Math.max(highlight.startSpanIndex, highlight.endSpanIndex)
        if (textIndex >= start && textIndex <= end) {
          return highlight.anchorId
        }
      }

      return null
    },
    [pageHighlights]
  )

  const findHighlightFromTarget = useCallback(
    (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) {
        return null
      }

      const textSpan = target.closest<HTMLElement>('.textLayer span[data-text-index]')
      if (!textSpan) {
        return null
      }

      const textIndex = Number(textSpan.dataset.textIndex)
      if (!Number.isFinite(textIndex)) {
        return null
      }

      return findHighlightByTextIndex(textIndex)
    },
    [findHighlightByTextIndex]
  )

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
    const targetAnchorId = findHighlightFromTarget(event.target)
    gestureRef.current = {
      pointerId: event.pointerId,
      startX: x,
      startY: y,
      candidateAnchorId: event.detail > 1 ? null : targetAnchorId ?? findHighlightAtPoint(x, y),
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
        setHighlightRenderTick((current) => current + 1)
        onRendered()
      } catch (error: unknown) {
        if (
          cancelled ||
          (error instanceof Error &&
            (error.name === 'RenderingCancelledException' ||
              error.name === 'AbortException' ||
              error.name === 'UnknownErrorException'))
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
  }, [pageNumber, pdfDocument, registerCanvas, onRendered, onRenderError, viewportScale])

  useEffect(() => {
    setHighlightRenderTick((current) => current + 1)
  }, [pageHighlights, viewportScale])

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
      <div className="page-anchor-margin page-anchor-margin-left">
        {marginAnchors.map((anchor) => (
          <button
            key={`anchor-left-${anchor.anchorId}`}
            type="button"
            className="page-anchor-indicator"
            data-anchor-id={anchor.anchorId}
            style={{
              top: anchor.top,
              background: anchor.color
            }}
            onClick={() => onEditAnchor(anchor.anchorId)}
          />
        ))}
      </div>
      <div className="page-anchor-margin page-anchor-margin-right">
        {marginAnchors.map((anchor) => (
          <button
            key={`anchor-right-${anchor.anchorId}`}
            type="button"
            className="page-anchor-indicator page-anchor-indicator-right"
            data-anchor-id={anchor.anchorId}
            style={{
              top: anchor.top,
              background: anchor.color
            }}
            onClick={() => onEditAnchor(anchor.anchorId)}
          />
        ))}
      </div>
      <canvas ref={canvasRef} className="document-page-canvas" />
      <div ref={textLayerRef} className="textLayer" />
      {renderedHighlights.map((highlight) => (
        <div key={highlight.anchorId}>
          {highlight.showHighlight !== false
            ? highlight.rects.map((rect) => (
            <button
              key={rect.key}
              type="button"
              className={`document-highlight-button${activeTag ? ' is-tag-filtered' : ''}`}
              style={{
                left: rect.left,
                top: rect.top,
                width: rect.width,
                height: rect.height,
                background: `${highlight.selectionColor}2d`,
                borderColor: highlight.selectionColor
              }}
              title="Open selection actions"
              onClick={() => onEditAnchor(highlight.anchorId)}
            />
              ))
            : null}
          {highlight.showBookmarkIcon ? (
            (() => {
              const bookmarkRect = getTopmostRect(highlight.rects)
              if (!bookmarkRect) {
                return null
              }
              return (
                <button
                  type="button"
                  className="document-bookmark-symbol"
                  style={{
                    left: Math.max(0, bookmarkRect.left - 22),
                    top: Math.max(0, bookmarkRect.top - 18)
                  }}
                  title="Open bookmark"
                  onClick={() => onEditAnchor(highlight.anchorId)}
                >
                  <img src={bookmarkIcon.src} alt="" />
                </button>
              )
            })()
          ) : null}
          {highlight.showTagBadges !== false && highlight.tags?.length ? (
            <div
              className="document-tag-badges"
              style={{
                left: highlight.boundingBox.x * (viewportScale / (highlight.viewportScale || viewportScale)),
                top:
                  highlight.boundingBox.y * (viewportScale / (highlight.viewportScale || viewportScale)) -
                  18
              }}
            >
              {highlight.tags.slice(0, 3).map((tag) => {
                const hue = hueFromString(tag)
                return (
                  <button
                    key={tag}
                    type="button"
                    className={`document-tag-badge${activeTag === tag ? ' is-active' : ''}`}
                    style={{
                      background: `hsl(${hue} 78% 55%)`
                    }}
                    title={tag}
                    onClick={(event) => {
                      event.stopPropagation()
                      onToggleTag(tag)
                    }}
                  >
                    {tag.slice(0, 1).toUpperCase()}
                  </button>
                )
              })}
              {highlight.tags.length > 3 ? <span className="document-tag-badge document-tag-badge-more">+</span> : null}
            </div>
          ) : null}
        </div>
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
