'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { type PointerEvent as ReactPointerEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import type { CanvasNode, PageAnchor } from '@workspace/domain'
import bookmarkIcon from './bookmark.png'
import { PdfCanvasPage } from './pdf/PdfCanvasPage'
import { SelectionManager, type SelectionPopupState as PdfSelectionPopupState } from './pdf/SelectionManager'
import { MobileWorkspaceCanvas } from './MobileWorkspaceCanvas'
import {
  dispatchInteractionAction,
  normalizePointer,
  simplifyPath
} from '../lib/interaction-engine'
import {
  getDocumentSourceKind,
  getDocumentViewerState,
  listMobileDocuments,
  loadMobileDocument,
  loadMobileWorkspace,
  markMobileDocumentOpened,
  saveMobileWorkspace,
  type FreeformHighlight,
  type InkStroke,
  type MobileDocumentRecord,
  type MobileToolSettings,
  type MobileWebSection,
  type MobileWorkspaceState,
  type NormalizedPoint,
  type SourceTextbox,
  type ToolMode
} from '../lib/mobile-store'
import { destroyPdfTask, openPdfDocument, type PdfLoadingTaskLike } from '../lib/pdf-loader'
import { convertClientRectsToPageAnchorGeometry } from '../lib/excerpts/pdf-selection'
import {
  anchorMarkerPosition,
  anchorToHighlightRects,
  applyBookmarkSelection,
  applyClearSelectionColor,
  applyCommentSelection,
  applyExcerptSelection,
  applyRecolorSelection,
  applyTagSelection,
  buildFreeNode,
  buildPageAnchor,
  buildPrintableRows,
  buildProjectBundle,
  buildProjectBundleFileName,
  buildSemanticSearchIndex,
  clampSplitRatio,
  clampViewerZoom,
  commitViewerStatePatch,
  decideNavigation,
  escapeHtml,
  fallbackSections,
  findSemanticSearchHit,
  pointsToPolyline,
  resetSplitRatio,
  sourceKindLabel,
  upsertById,
  viewerGridTemplateColumns,
  type ViewerLayoutMode,
  visibleAnchorColor,
  type SelectionArtifactInput
} from './pdf/document-viewer-model'

type LoadState = 'idle' | 'loading' | 'loaded' | 'error'
type PaneMode = 'source' | 'workspace'
type PanelMode = 'source-tools' | 'navigate' | 'share' | 'more' | 'highlight-view' | 'page-edit' | 'documents' | 'bookmarks' | null
type LeftPopupMode = 'highlight-view' | 'documents' | 'bookmarks' | 'share' | null

type SelectionRect = {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

type SelectionPopupState = {
  selection: SelectionArtifactInput
  left: number
  top: number
  selectionRect?: SelectionRect
  color?: string
  tags: string[]
}

type CapturedSourceSelection = {
  text: string
  pageNumber: number
  anchor: Partial<Pick<PageAnchor, 'startSpanIndex' | 'startOffset' | 'endSpanIndex' | 'endOffset'>> &
    Pick<PageAnchor, 'pageNumber' | 'boundingBox' | 'viewportScale' | 'textQuote'> & { quadPoints?: number[] }
}

const DEBUG_PDF_SELECTION = process.env.NEXT_PUBLIC_DEBUG_PDF_SELECTION === '1'

type PdfState = {
  document: PDFDocumentProxy
  pages: PDFPageProxy[]
  task: PdfLoadingTaskLike
}

type DraftPath = {
  kind: 'freeform-highlight' | 'pen' | 'pencil'
  pageNumber: number
  points: NormalizedPoint[]
}

const ZOOM_STEP = 0.1
const clampAppZoom = (value: number) => Math.max(0.4, Math.min(1.5, Number(value.toFixed(2))))
const SOURCE_PANE_HORIZONTAL_PADDING = 32
const SOURCE_TOOLS: Array<{ mode: ToolMode; label: string; icon: IconName }> = [
  { mode: 'select', label: 'Select', icon: 'select' },
  { mode: 'pen', label: 'Pen', icon: 'pen' },
  { mode: 'pencil', label: 'Pencil', icon: 'pen' },
  { mode: 'freeform-highlight', label: 'Highlighter', icon: 'highlighter' },
  { mode: 'eraser', label: 'Eraser', icon: 'eraser' },
  { mode: 'textbox', label: 'Text Box', icon: 'select' }
]

export function DocumentViewer({ docId }: { docId: string }) {
  const router = useRouter()
  const activeDocIdRef = useRef(docId)
  const sourcePaneRef = useRef<HTMLDivElement | null>(null)
  const activeToolPageRef = useRef<HTMLElement | null>(null)
  const splitFrameRef = useRef<number | null>(null)
  const pendingSplitRef = useRef<number | null>(null)
  const [loadState, setLoadState] = useState<LoadState>('idle')
  const [status, setStatus] = useState('Loading document...')
  const [record, setRecord] = useState<MobileDocumentRecord | null>(null)
  const [documents, setDocuments] = useState<MobileDocumentRecord[]>([])
  const [workspace, setWorkspace] = useState<MobileWorkspaceState | null>(null)
  const [pdfState, setPdfState] = useState<PdfState | null>(null)
  const [paneMode, setPaneMode] = useState<PaneMode>('source')
  const [panelMode, setPanelMode] = useState<PanelMode>(null)
  const [leftPopup, setLeftPopup] = useState<LeftPopupMode>(null)
  const [draftPath, setDraftPath] = useState<DraftPath | null>(null)
  const [selectionPopup, setSelectionPopup] = useState<SelectionPopupState | null>(null)
  const [pdfSelectionPopup, setPdfSelectionPopup] = useState<PdfSelectionPopupState | null>(null)
  const [query, setQuery] = useState('')
  const [pageInput, setPageInput] = useState('')
  const [tagInput, setTagInput] = useState('')
  const [navigateScope, setNavigateScope] = useState<'current-doc' | 'all-docs'>('current-doc')
  const [viewportSize, setViewportSize] = useState({ width: 1280, height: 800 })
  const [sourcePaneWidth, setSourcePaneWidth] = useState(0)
  const [sourceScrollVersion, setSourceScrollVersion] = useState(0)

  const sourceKind = record ? getDocumentSourceKind(record) : 'pdf'
  const viewerState = workspace && record ? getDocumentViewerState(workspace, record.document.id) : { viewerZoom: 1, sourceZoom: 1, workspaceZoom: 1, scrollPosition: 0, activePage: 1 }
  const toolMode = workspace?.toolMode ?? 'select'
  const toolSettings = workspace?.toolSettings
  const semanticSearchIndex = useMemo(() => buildSemanticSearchIndex(record), [record])
  const sourceSelectionHighlights = useMemo(() => {
    if (!workspace || !record) return []
    const excerptAnchorIds = new Set(workspace.nodes.filter((node) => node.documentId === record.document.id && (node.kind === 'excerpt' || node.kind === 'comment')).map((node) => node.sourceAnchorId))
    const bookmarkAnchorIds = new Set(workspace.bookmarks.filter((bookmark) => bookmark.documentId === record.document.id).map((bookmark) => bookmark.sourceAnchorId))
    return workspace.anchors.filter((anchor) => {
      if (anchor.documentId !== record.document.id) return false
      if (workspace.activeTag && !(anchor.tags ?? []).includes(workspace.activeTag)) return false
      return Boolean(
        anchor.selectionColor ||
        anchor.tags?.length ||
        workspace.activeAnchorId === anchor.id ||
        excerptAnchorIds.has(anchor.id) ||
        bookmarkAnchorIds.has(anchor.id)
      )
    })
  }, [record, workspace])
  const linkedSourceAnchors = useMemo(() => {
    if (!workspace || !record) return []
    const linkedAnchorIds = new Set(
      workspace.nodes
        .filter((node) => node.documentId === record.document.id && (node.kind === 'excerpt' || node.kind === 'comment') && node.sourceAnchorId)
        .map((node) => node.sourceAnchorId as string)
    )
    return workspace.anchors.filter((anchor) => anchor.documentId === record.document.id && linkedAnchorIds.has(anchor.id))
  }, [record, workspace])
  const layoutMode = useMemo<ViewerLayoutMode>(() => {
    if (viewportSize.width < 600) return 'mobile'
    if (viewportSize.width < 1024 || viewportSize.height < 600) return 'compact'
    return 'desktop'
  }, [viewportSize.height, viewportSize.width])
  const basePdfPageWidth = useMemo(() => {
    const firstPage = pdfState?.pages[0]
    return firstPage ? firstPage.getViewport({ scale: 1.25 }).width : 0
  }, [pdfState])
  const sourceFitScale = useMemo(() => {
    if (!basePdfPageWidth || !sourcePaneWidth) return 1
    const availableWidth = Math.max(120, sourcePaneWidth - SOURCE_PANE_HORIZONTAL_PADDING)
    return Math.min(1, availableWidth / basePdfPageWidth)
  }, [basePdfPageWidth, sourcePaneWidth])
  const effectiveSourceZoom = viewerState.sourceZoom * sourceFitScale

  const persistWorkspace = useCallback((nextWorkspace: MobileWorkspaceState) => {
    setWorkspace(nextWorkspace)
    void saveMobileWorkspace(nextWorkspace)
  }, [])

  const updateWorkspace = useCallback(
    (updater: (current: MobileWorkspaceState) => MobileWorkspaceState) => {
      setWorkspace((current) => {
        if (!current) return current
        const next = updater(current)
        void saveMobileWorkspace(next)
        return next
      })
    },
    []
  )

  const commitSourceWorkspace = useCallback(
    (updater: (current: MobileWorkspaceState) => MobileWorkspaceState) => {
      updateWorkspace((current) => {
        const after = updater(current)
        return dispatchInteractionAction(current, { type: 'COMMIT_SOURCE_SNAPSHOT', before: current, after })
      })
    },
    [updateWorkspace]
  )

  useEffect(() => {
    function measureViewport() {
      setViewportSize({ width: window.innerWidth, height: window.innerHeight })
    }
    measureViewport()
    window.addEventListener('resize', measureViewport)
    return () => window.removeEventListener('resize', measureViewport)
  }, [])

  useLayoutEffect(() => {
    const sourcePane = sourcePaneRef.current
    if (!sourcePane) return
    const measureSourcePane = () => setSourcePaneWidth(sourcePane.clientWidth)
    measureSourcePane()
    const observer = new ResizeObserver(measureSourcePane)
    observer.observe(sourcePane)
    return () => observer.disconnect()
  }, [layoutMode, loadState])

  useEffect(() => {
    activeDocIdRef.current = docId
    let cancelled = false
    let nextPdfState: PdfState | null = null
    setLoadState('loading')
    setStatus('Loading document...')
    setRecord(null)
    setPdfState((current) => {
      void destroyPdfTask(current?.task)
      return null
    })

    async function load() {
      try {
        const [loadedRecord, loadedWorkspace, loadedDocuments] = await Promise.all([
          loadMobileDocument(docId),
          loadMobileWorkspace(),
          listMobileDocuments()
        ])
        if (cancelled || activeDocIdRef.current !== docId) return
        if (!loadedRecord) {
          setLoadState('error')
          setStatus('Document not found.')
          return
        }

        const kind = getDocumentSourceKind(loadedRecord)
        if ((kind === 'pdf' || kind === 'web-visual') && loadedRecord.bytes) {
          const opened = await openPdfDocument(loadedRecord.bytes)
          const pages = await Promise.all(
            Array.from({ length: opened.document.numPages }, (_, index) => opened.document.getPage(index + 1))
          )
          nextPdfState = { document: opened.document, pages, task: opened.task }
          if (cancelled || activeDocIdRef.current !== docId) {
            await destroyPdfTask(opened.task)
            return
          }
        }

        const normalizedWorkspace = {
          ...loadedWorkspace,
          activeDocumentId: loadedRecord.document.id
        }
        setWorkspace(normalizedWorkspace)
        setDocuments(loadedDocuments)
        setRecord(loadedRecord)
        setPdfState(nextPdfState)
        setLoadState('loaded')
        setStatus(`${loadedRecord.document.title} loaded.`)
        void saveMobileWorkspace(normalizedWorkspace)
        void markMobileDocumentOpened(loadedRecord.document.id)
      } catch (error) {
        if (cancelled || activeDocIdRef.current !== docId) return
        setLoadState('error')
        setStatus(error instanceof Error ? error.message : 'Could not load document.')
      }
    }

    void load()
    return () => {
      cancelled = true
      void destroyPdfTask(nextPdfState?.task)
    }
  }, [docId])

  useEffect(() => {
    if (loadState !== 'loaded' || !record || !workspace) return
    const sourcePane = sourcePaneRef.current
    if (!sourcePane) return
    const saved = getDocumentViewerState(workspace, record.document.id)
    requestAnimationFrame(() => {
      sourcePane.scrollTop = saved.scrollPosition
      scrollToPage(saved.activePage, false)
    })
  }, [loadState, record?.document.id])

  function commitViewerState(patch: Partial<typeof viewerState>) {
    if (!record) return
    updateWorkspace((current) => commitViewerStatePatch(current, record.document.id, patch))
  }

  function setSourceZoom(nextZoom: number) {
    const sourcePane = sourcePaneRef.current
    const previousScrollRatio = sourcePane
      ? sourcePane.scrollTop / Math.max(1, sourcePane.scrollHeight - sourcePane.clientHeight)
      : 0
    const sourceZoom = clampViewerZoom(nextZoom)
    commitViewerState({ sourceZoom })
    if (sourcePane) {
      requestAnimationFrame(() => {
        sourcePane.scrollTop = previousScrollRatio * Math.max(1, sourcePane.scrollHeight - sourcePane.clientHeight)
      })
    }
  }

  function setViewerZoom(nextZoom: number) {
    commitViewerState({ viewerZoom: clampAppZoom(nextZoom) })
  }

  function handleSourceScroll() {
    const sourcePane = sourcePaneRef.current
    if (!sourcePane || !record) return
    setSourceScrollVersion((version) => version + 1)
    const pages = Array.from(sourcePane.querySelectorAll<HTMLElement>('[data-page-number]'))
    const activePage =
      pages.reduce(
        (best, page) => {
          const distance = Math.abs(page.offsetTop - sourcePane.scrollTop - 20)
          return distance < best.distance ? { page: Number(page.dataset.pageNumber ?? 1), distance } : best
        },
        { page: 1, distance: Number.POSITIVE_INFINITY }
      ).page || 1
    commitViewerState({ scrollPosition: sourcePane.scrollTop, activePage })
  }

  function scrollToPage(pageNumber: number, save = true) {
    const sourcePane = sourcePaneRef.current
    const target = sourcePane?.querySelector<HTMLElement>(`[data-page-number="${pageNumber}"]`)
    if (!sourcePane || !target) return false
    sourcePane.scrollTo({ top: target.offsetTop - 12, behavior: save ? 'smooth' : 'auto' })
    if (save) commitViewerState({ activePage: pageNumber, scrollPosition: target.offsetTop - 12 })
    return true
  }

  function runNavigate() {
    const decision = decideNavigation({ pageInput, query, tagInput, navigateScope, record, workspace, documents })
    if (decision.type === 'page' && scrollToPage(decision.pageNumber)) {
      setPanelMode(null)
      return
    }
    if (decision.type === 'anchor') {
      if (decision.activeTag) {
        updateWorkspace((current) => ({ ...current, activeTag: decision.activeTag, activeAnchorId: decision.anchorId, updatedAt: new Date().toISOString() }))
        scrollToPage(decision.pageNumber)
      } else {
        focusAnchor(decision.anchorId)
      }
      setPanelMode(null)
      return
    }
    if (decision.type === 'text' && scrollToText(decision.query)) setPanelMode(null)
    if (decision.type === 'document') router.push(`/viewer/${decision.documentId}`)
  }

  function scrollToText(trimmedQuery: string) {
    const sourcePane = sourcePaneRef.current
    if (!sourcePane) return false
    const textBlocks = Array.from(sourcePane.querySelectorAll<HTMLElement>('[data-search-text]'))
    const match = textBlocks.find((block) => block.dataset.searchText?.toLowerCase().includes(trimmedQuery))
    if (!match) {
      const hit = findSemanticSearchHit(semanticSearchIndex, trimmedQuery)
      if (hit) {
        setStatus(`Found "${trimmedQuery}" in extracted text.`)
        return scrollToPage(hit.pageNumber)
      }
      return false
    }
    sourcePane.scrollTo({ top: match.offsetTop - 20, behavior: 'smooth' })
    commitViewerState({ scrollPosition: match.offsetTop - 20 })
    return true
  }

  function captureSourceSelection() {
    if (!record || !workspace || !sourcePaneRef.current || toolMode !== 'select') return
    const pdfSelection = capturePdfSelection(sourcePaneRef.current)
    const sourceSelection: CapturedSourceSelection | null = pdfSelection
      ? {
          text: pdfSelection.text,
          pageNumber: pdfSelection.pageNumber,
          anchor: pdfSelection.anchor
        }
      : captureReadableSelection(sourcePaneRef.current)
    if (!sourceSelection || !sourceSelection.text) return

    const selection: SelectionArtifactInput = {
      workspaceId: workspace.workspaceId,
      documentId: record.document.id,
      pageNumber: sourceSelection.pageNumber,
      text: sourceSelection.text,
      startSpanIndex: sourceSelection.anchor.startSpanIndex,
      startOffset: sourceSelection.anchor.startOffset,
      endSpanIndex: sourceSelection.anchor.endSpanIndex,
      endOffset: sourceSelection.anchor.endOffset,
      boundingBox: sourceSelection.anchor.boundingBox,
      quadPoints: sourceSelection.anchor.quadPoints,
      viewportScale: sourceSelection.anchor.viewportScale,
      selectionColor: workspace.toolSettings.highlight.color,
      tags: []
    }
    const rect = window.getSelection()?.rangeCount ? window.getSelection()?.getRangeAt(0).getBoundingClientRect() : null
    setSelectionPopup({
      selection,
      left: Math.max(12, Math.min(window.innerWidth - 320, rect ? rect.left : 80)),
      top: rect ? rect.bottom + 12 : 120,
      selectionRect: rect
        ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height }
        : undefined,
      color: workspace.toolSettings.highlight.color,
      tags: []
    })
  }

  function upsertAnchor(anchor: PageAnchor) {
    updateWorkspace((current) => ({
      ...current,
      anchors: upsertById(current.anchors, anchor),
      activeAnchorId: anchor.id,
      updatedAt: new Date().toISOString()
    }))
  }

  function createExcerptFromSelection(popup: SelectionPopupState) {
    if (!record || !workspace) return
    const selection = { ...popup.selection, selectionColor: popup.color ?? '#5d5df6', tags: popup.tags }

    const viewportRatio = popup.top / Math.max(1, window.innerHeight)
    commitSourceWorkspace((current) => applyExcerptSelection(current, selection, viewportRatio))
    setSelectionPopup(null)
    try { document.getSelection()?.removeAllRanges() } catch {}
  }

  function createPdfExcerptFromSelection(selection: SelectionArtifactInput, viewportRatio: number) {
    if (!record || !workspace) return
    commitSourceWorkspace((current) => applyExcerptSelection(current, selection, viewportRatio))
    setPdfSelectionPopup(null)
    try { document.getSelection()?.removeAllRanges() } catch {}
  }

  function createCommentFromSelection(popup: SelectionPopupState) {
    if (!record || !workspace) return
    const selection = { ...popup.selection, selectionColor: popup.color ?? '#5d5df6', tags: popup.tags }
    const viewportRatio = popup.top / Math.max(1, window.innerHeight)

    commitSourceWorkspace((current) => applyCommentSelection(current, selection, viewportRatio))
    setSelectionPopup(null)
    try { document.getSelection()?.removeAllRanges() } catch {}
  }

  function createPdfCommentFromSelection(selection: SelectionArtifactInput, viewportRatio: number) {
    if (!record || !workspace) return
    commitSourceWorkspace((current) => applyCommentSelection(current, selection, viewportRatio))
    setPdfSelectionPopup(null)
    try { document.getSelection()?.removeAllRanges() } catch {}
  }

  function bookmarkSelection(popup: SelectionPopupState) {
    if (!workspace) return
    const selection = { ...popup.selection, selectionColor: popup.color ?? '#5d5df6', tags: popup.tags }
    commitSourceWorkspace((current) => applyBookmarkSelection(current, selection))
    setSelectionPopup(null)
  }

  function bookmarkPdfSelection(selection: SelectionArtifactInput) {
    if (!workspace) return
    commitSourceWorkspace((current) => applyBookmarkSelection(current, selection))
    setPdfSelectionPopup(null)
  }

  function tagSelection(popup: SelectionPopupState, tags: string[]) {
    const selection = { ...popup.selection, selectionColor: popup.color ?? '#5d5df6', tags }
    commitSourceWorkspace((current) => applyTagSelection(current, selection, tags))
    setSelectionPopup({ ...popup, tags })
  }

  function tagPdfSelection(selection: SelectionArtifactInput, tags: string[]) {
    commitSourceWorkspace((current) => applyTagSelection(current, selection, tags))
  }

  function recolorSelection(popup: SelectionPopupState, color: string) {
    const selection = { ...popup.selection, selectionColor: color, tags: popup.tags }
    commitSourceWorkspace((current) => applyRecolorSelection(current, selection, color))
    setSelectionPopup({ ...popup, color })
  }

  function recolorPdfSelection(selection: SelectionArtifactInput) {
    const color = selection.selectionColor
    if (!color) return
    commitSourceWorkspace((current) => applyRecolorSelection(current, selection, color))
  }

  function clearSourceSelection(selection: SelectionArtifactInput) {
    commitSourceWorkspace((current) => applyClearSelectionColor(current, selection))
  }

  function openAnchorPopup(anchor: PageAnchor) {
    if (!workspace) return
    const rect = sourcePaneRef.current
      ?.querySelector<HTMLElement>(`[data-anchor-id="${CSS.escape(anchor.id)}"]`)
      ?.getBoundingClientRect()
    setSelectionPopup({
      selection: {
        workspaceId: workspace.workspaceId,
        documentId: anchor.documentId,
        pageNumber: anchor.pageNumber,
        text: anchor.textQuote,
        startSpanIndex: anchor.startSpanIndex,
        startOffset: anchor.startOffset,
        endSpanIndex: anchor.endSpanIndex,
        endOffset: anchor.endOffset,
        boundingBox: anchor.boundingBox,
        quadPoints: anchor.quadPoints,
        viewportScale: anchor.viewportScale,
        selectionColor: anchor.selectionColor ?? '#5d5df6',
        tags: anchor.tags ?? []
      },
      left: Math.max(12, Math.min(window.innerWidth - 320, rect ? rect.left : 80)),
      top: rect ? rect.bottom + 12 : 120,
      selectionRect: rect
        ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height }
        : undefined,
      color: anchor.selectionColor,
      tags: anchor.tags ?? []
    })
    focusAnchor(anchor.id)
  }

  function focusAnchor(anchorId: string, preferredNodeId?: string) {
    const anchor = workspace?.anchors.find((entry) => entry.id === anchorId)
    if (!anchor) return
    scrollToPage(anchor.pageNumber)
    updateWorkspace((current) => ({
      ...current,
      activeAnchorId: anchorId,
      activeNodeId: preferredNodeId ?? current.nodes.find((node) => node.sourceAnchorId === anchorId)?.id ?? current.activeNodeId,
      updatedAt: new Date().toISOString()
    }))
  }

  function createFreeNode(kind: 'text' | 'comment') {
    if (!record || !workspace) return
    const node = buildFreeNode({ kind, workspace, documentId: record.document.id })
    updateWorkspace((current) => ({
      ...current,
      nodes: [...current.nodes, node],
      activeNodeId: node.id,
      updatedAt: node.updatedAt
    }))
  }

  function setToolMode(mode: ToolMode) {
    updateWorkspace((current) => dispatchInteractionAction(current, { type: 'SET_TOOL_MODE', mode }))
  }

  function updateToolSettings(nextSettings: MobileToolSettings) {
    updateWorkspace((current) => ({
      ...current,
      toolSettings: nextSettings,
      updatedAt: new Date().toISOString()
    }))
  }

  function handlePointerDown(event: React.PointerEvent<HTMLElement>) {
    if (!workspace || !record || !toolSettings) return
    if (event.target instanceof Element && event.target.closest('.mobile-source-textbox-shell')) {
      return
    }
    if (toolMode === 'select') {
      setSelectionPopup(null)
      return
    }
    if (!['freeform-highlight', 'pen', 'pencil', 'eraser', 'textbox'].includes(toolMode)) return
    const pageElement = findAnnotatedPageFromPointer(event)
    if (!pageElement) return
    event.preventDefault()
    activeToolPageRef.current = pageElement
    const point = normalizePointer(event.clientX, event.clientY, pageElement)
    const pageNumber = Number(pageElement.dataset.pageNumber ?? 1)

    if (toolMode === 'textbox') {
      const now = new Date().toISOString()
      const textbox: SourceTextbox = {
        id: crypto.randomUUID(),
        documentId: record.document.id,
        pageNumber,
        xNorm: point.x,
        yNorm: point.y,
        widthNorm: 0.3,
        heightNorm: 0.16,
        content: ''
      }
      updateWorkspace((current) => dispatchInteractionAction(current, { type: 'ADD_SOURCE_TEXTBOX', payload: textbox }))
      activeToolPageRef.current = null
      void now
      return
    }

    if (toolMode === 'eraser') {
      const anchorId = findSourceAnchorIdFromPointer(event.clientX, event.clientY)
      updateWorkspace((current) =>
        dispatchInteractionAction(current, {
          type: 'ERASE_AT_POINT',
          payload: { documentId: record.document.id, pageNumber, point, size: toolSettings.eraser.size, anchorId }
        })
      )
      activeToolPageRef.current = null
      return
    }

    if (toolMode === 'freeform-highlight' || toolMode === 'pen' || toolMode === 'pencil') {
      event.currentTarget.setPointerCapture(event.pointerId)
      setDraftPath({ kind: toolMode, pageNumber, points: [point] })
    }
  }

  function handlePointerMove(event: React.PointerEvent<HTMLElement>) {
    if (!draftPath) return
    const pageElement = activeToolPageRef.current ?? findAnnotatedPageFromPointer(event)
    if (!pageElement || Number(pageElement.dataset.pageNumber ?? 1) !== draftPath.pageNumber) return
    event.preventDefault()
    const point = normalizePointer(event.clientX, event.clientY, pageElement)
    setDraftPath((current) => (current ? { ...current, points: [...current.points, point] } : current))
  }

  function handlePointerUp() {
    if (!draftPath) {
      if (sourceKind === 'web-clean') window.setTimeout(captureSourceSelection, 0)
      return
    }
    if (!draftPath || !record || !toolSettings) {
      setDraftPath(null)
      return
    }
    const points = draftPath.kind === 'freeform-highlight' && toolSettings.highlight.smoothed ? simplifyPath(draftPath.points) : draftPath.points
    if (points.length < 2) {
      setDraftPath(null)
      activeToolPageRef.current = null
      return
    }
    if (draftPath.kind === 'freeform-highlight') {
      const payload: FreeformHighlight = {
        id: crypto.randomUUID(),
        documentId: record.document.id,
        pageNumber: draftPath.pageNumber,
        points,
        color: toolSettings.highlight.color,
        size: toolSettings.highlight.size,
        opacity: toolSettings.highlight.opacity,
        smoothed: toolSettings.highlight.smoothed
      }
      updateWorkspace((current) => dispatchInteractionAction(current, { type: 'ADD_FREEFORM_HIGHLIGHT', payload }))
    } else {
      const isPencil = draftPath.kind === 'pencil'
      const payload: InkStroke = {
        id: crypto.randomUUID(),
        documentId: record.document.id,
        pageNumber: draftPath.pageNumber,
        tool: isPencil ? 'pencil' : 'pen',
        points,
        color: isPencil ? toolSettings.pencil.color : toolSettings.pen.color,
        size: isPencil ? toolSettings.pencil.size : toolSettings.pen.size,
        opacity: isPencil ? toolSettings.pencil.opacity : undefined
      }
      updateWorkspace((current) => dispatchInteractionAction(current, { type: 'ADD_INK_STROKE', payload }))
    }
    setDraftPath(null)
    activeToolPageRef.current = null
  }

  function updateTextbox(textbox: SourceTextbox) {
    updateWorkspace((current) => dispatchInteractionAction(current, { type: 'UPDATE_SOURCE_TEXTBOX', payload: textbox }))
  }

  function deleteTextbox(textboxId: string) {
    updateWorkspace((current) => dispatchInteractionAction(current, { type: 'DELETE_SOURCE_TEXTBOX', textboxId }))
  }

  function changeSplit(clientX: number) {
    const body = document.querySelector<HTMLElement>('.mobile-viewer-body')
    if (!body || !workspace) return
    const rect = body.getBoundingClientRect()
    pendingSplitRef.current = clampSplitRatio((clientX - rect.left) / Math.max(1, rect.width))
    if (splitFrameRef.current != null) return
    splitFrameRef.current = requestAnimationFrame(() => {
      splitFrameRef.current = null
      const ratio = pendingSplitRef.current
      if (ratio == null) return
      updateWorkspace((current) => ({
        ...current,
        viewerLayout: { ...current.viewerLayout, splitRatio: ratio },
        updatedAt: new Date().toISOString()
      }))
    })
  }

  function exportProjectBundle() {
    if (!record || !workspace) return
    const bundle = buildProjectBundle(record, documents, workspace)
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = buildProjectBundleFileName(record.document.title)
    link.click()
    URL.revokeObjectURL(url)
  }

  function exportPrintablePdf() {
    if (!record || !workspace) return
    const rows = buildPrintableRows(record, workspace)
    const printWindow = window.open('', '_blank', 'noopener,noreferrer')
    if (!printWindow) return
    printWindow.document.write(`<!doctype html><title>${escapeHtml(record.document.title)}</title><style>body{font-family:Segoe UI,Arial,sans-serif;margin:32px;color:#18212b}section{break-inside:avoid;border:1px solid #cfdae3;border-radius:8px;padding:12px;margin:10px 0}small{color:#647282}</style>${rows}`)
    printWindow.document.close()
    printWindow.focus()
    printWindow.print()
  }

  const splitRatio = workspace?.viewerLayout.splitRatio ?? 0.54
  const gridTemplateColumns = viewerGridTemplateColumns(splitRatio, layoutMode)
  const linkLayoutKey = [
    layoutMode,
    paneMode,
    sourceScrollVersion,
    sourcePaneWidth,
    viewerState.viewerZoom,
    effectiveSourceZoom,
    viewerState.workspaceZoom,
    workspace?.activeAnchorId ?? '',
    workspace?.activeNodeId ?? ''
  ].join(':')

  if (loadState === 'loading' || loadState === 'idle') {
    return (
      <main className="mobile-viewer">
        <ViewerHeader title="Loading document" subtitle="Viewer" status={status} />
        <div className="mobile-loading-panel">Loading document...</div>
      </main>
    )
  }

  if (loadState === 'error' || !record || !workspace) {
    return (
      <main className="mobile-viewer">
        <ViewerHeader title="Document unavailable" subtitle="Viewer" status={status} />
        <div className="mobile-loading-panel">
          <strong>{status}</strong>
          <Link className="mobile-back-link" href="/">Back to documents</Link>
        </div>
      </main>
    )
  }

  return (
    <div className="mobile-viewer-zoom-frame" style={{ overflow: viewerState.viewerZoom > 1 ? 'auto' : 'hidden' }}>
    <main
      className={`mobile-viewer mobile-viewer-${layoutMode}`}
      data-layout-mode={layoutMode}
      style={{
        width: `calc(100dvw / ${viewerState.viewerZoom})`,
        height: `calc(100dvh / ${viewerState.viewerZoom})`,
        transform: `scale(${viewerState.viewerZoom})`
      }}
    >
      <ViewerHeader title={record.document.title} subtitle={sourceKindLabel(sourceKind)} status={status} />

      <nav className="mobile-viewer-commandbar" aria-label="Viewer commands">
        <div className="mobile-viewer-command-group">
          <Link className="mobile-back-link" href="/">
            <Icon name="home" /> Home
          </Link>
          <button
            className="mobile-tool-button"
            type="button"
            disabled={(workspace.historyPast ?? []).length === 0}
            onClick={() => updateWorkspace((current) => dispatchInteractionAction(current, { type: 'UNDO' }))}
          >
            <Icon name="back" /> Undo
          </button>
          <button
            className="mobile-tool-button"
            type="button"
            disabled={(workspace.historyFuture ?? []).length === 0}
            onClick={() => updateWorkspace((current) => dispatchInteractionAction(current, { type: 'REDO' }))}
          >
            <Icon name="forward" /> Redo
          </button>
        </div>
        <div className="mobile-viewer-command-group mobile-viewer-command-center">
          <button className={panelMode === 'source-tools' ? 'mobile-tool-button is-active' : 'mobile-tool-button'} type="button" onClick={() => setPanelMode(panelMode === 'source-tools' ? null : 'source-tools')}>
            <Icon name={toolIcon(toolMode)} /> Tools
          </button>
          <button className="mobile-tool-button" type="button" aria-label="Zoom out whole page" title="Zoom out whole page" onClick={() => setViewerZoom(viewerState.viewerZoom - ZOOM_STEP)}>-</button>
          <button className="mobile-tool-button mobile-zoom-readout" type="button" aria-label="Reset whole page zoom" title="Reset whole page zoom" onClick={() => setViewerZoom(1)}>{Math.round(viewerState.viewerZoom * 100)}%</button>
          <button className="mobile-tool-button" type="button" aria-label="Zoom in whole page" title="Zoom in whole page" onClick={() => setViewerZoom(viewerState.viewerZoom + ZOOM_STEP)}>+</button>
          <button className="mobile-tool-button" type="button" onClick={() => { setLeftPopup(null); setPanelMode('navigate') }}>Navigate</button>
        </div>
        <div className="mobile-viewer-command-group">
          <button className={leftPopup === 'share' ? 'mobile-primary-button mobile-share-button is-active' : 'mobile-primary-button mobile-share-button'} type="button" onClick={() => { setPanelMode(null); setLeftPopup((current) => (current === 'share' ? null : 'share')) }}>Share</button>
          <button className="mobile-tool-button" type="button" onClick={() => { setLeftPopup(null); setPanelMode('more') }}>
            <Icon name="more" /> More
          </button>
        </div>
      </nav>

      <div className="mobile-pane-tabs" role="tablist" aria-label="Viewer panes">
        <button className={paneMode === 'source' ? 'is-active' : ''} type="button" onClick={() => { setPaneMode('source'); updateWorkspace((current) => ({ ...current, activeNodeId: null, updatedAt: new Date().toISOString() })); }}>Source</button>
        <button className={paneMode === 'workspace' ? 'is-active' : ''} type="button" onClick={() => setPaneMode('workspace')}>Workspace</button>
      </div>

      <section className="mobile-viewer-body" style={{ gridTemplateColumns }}>
        {layoutMode !== 'mobile' ? (
          <SourceSidePanel
            activePanel={leftPopup}
            pageEditActive={panelMode === 'page-edit'}
            textboxActive={toolMode === 'textbox'}
            popupTitle={leftPopup ? leftPopupTitle(leftPopup) : ''}
            onPopupClose={() => setLeftPopup(null)}
            onHighlightView={() => { setPanelMode(null); setLeftPopup((current) => (current === 'highlight-view' ? null : 'highlight-view')) }}
            onTextbox={() => {
              setToolMode('textbox')
              setPanelMode(null)
              setLeftPopup(null)
            }}
            onPageEdit={() => { setLeftPopup(null); setPanelMode('page-edit') }}
            onDocuments={() => { setPanelMode(null); setLeftPopup((current) => (current === 'documents' ? null : 'documents')) }}
            onBookmarks={() => { setPanelMode(null); setLeftPopup((current) => (current === 'bookmarks' ? null : 'bookmarks')) }}
            onPopupToggle={() => { setPanelMode(null); setLeftPopup((current) => (current ? null : 'documents')) }}
          >
              {leftPopup === 'highlight-view' ? (
                <section className="mobile-settings-section">
                  <h2>All source marks</h2>
                  {sourceSelectionHighlights.length || (workspace.freeformHighlights ?? []).length || workspace.nodes.some((node) => node.documentId === record.document.id && (node.kind === 'excerpt' || node.kind === 'comment'))
                    ? (
                      <div className="mobile-source-list">
                        {sourceSelectionHighlights.map((anchor) => (
                          <button key={anchor.id} type="button" onClick={() => { focusAnchor(anchor.id); setLeftPopup(null) }}>
                            <strong>Page {anchor.pageNumber}</strong>
                            <span>{anchor.textQuote}</span>
                          </button>
                        ))}
                        {(workspace.freeformHighlights ?? []).filter((entry) => entry.documentId === record.document.id).map((highlight) => (
                          <button key={highlight.id} type="button" onClick={() => { scrollToPage(highlight.pageNumber ?? 1); setLeftPopup(null) }}>
                            <strong>Page {highlight.pageNumber ?? 1}</strong>
                            <span>Freeform highlight</span>
                          </button>
                        ))}
                        {workspace.nodes.filter((node) => node.documentId === record.document.id && (node.kind === 'excerpt' || node.kind === 'comment')).map((node) => (
                          <button key={node.id} type="button" onClick={() => { if (node.sourceAnchorId) focusAnchor(node.sourceAnchorId, node.id); setLeftPopup(null) }}>
                            <strong>{node.kind === 'comment' ? 'Comment' : 'Excerpt'}</strong>
                            <span>{node.text || node.title || 'Linked source note'}</span>
                          </button>
                        ))}
                      </div>
                    )
                    : <p>No highlights yet.</p>}
                </section>
              ) : null}
              {leftPopup === 'documents' ? (
                <section className="mobile-settings-section">
                  <h2>Project documents</h2>
                  <div className="mobile-source-list">
                    {documents.map((documentRecord) => (
                      <button key={documentRecord.document.id} type="button" onClick={() => router.push(`/viewer/${documentRecord.document.id}`)}>
                        <strong>{documentRecord.document.title}</strong>
                        <span>{sourceKindLabel(getDocumentSourceKind(documentRecord))}</span>
                      </button>
                    ))}
                  </div>
                  <button className="mobile-primary-button" type="button" onClick={() => router.push('/')}>Add or import document</button>
                </section>
              ) : null}
              {leftPopup === 'bookmarks' ? (
                <section className="mobile-settings-section">
                  <h2>Bookmarked sentences</h2>
                  {workspace.bookmarks.filter((bookmark) => bookmark.documentId === record.document.id).length ? (
                    <div className="mobile-source-list">
                      {workspace.bookmarks.filter((bookmark) => bookmark.documentId === record.document.id).map((bookmark) => {
                        const anchor = workspace.anchors.find((entry) => entry.id === bookmark.sourceAnchorId)
                        return (
                          <button key={bookmark.id} type="button" onClick={() => { if (anchor) focusAnchor(anchor.id); setLeftPopup(null) }}>
                            <strong>{anchor ? `Page ${anchor.pageNumber}` : 'Bookmark'}</strong>
                            <span>{anchor?.textQuote ?? bookmark.bookmarkLabel}</span>
                          </button>
                        )
                      })}
                    </div>
                  ) : <p>No bookmarks yet. Select source text, then use Bookmark.</p>}
                </section>
              ) : null}
              {leftPopup === 'share' ? (
                <div className="mobile-left-popup-actions">
                  <button className="mobile-primary-button" type="button" onClick={exportProjectBundle}>Export .ltproj</button>
                  <button className="mobile-secondary-button" type="button" onClick={exportPrintablePdf}>Export PDF</button>
                  <button className="mobile-secondary-button" type="button" disabled>DOCX Coming soon</button>
                  <button className="mobile-secondary-button" type="button" disabled>Cloud share Coming soon</button>
                  <button className="mobile-secondary-button" type="button" disabled>Auto-send Coming soon</button>
                </div>
              ) : null}
          </SourceSidePanel>
        ) : null}
        <section
          ref={sourcePaneRef}
          className={paneMode === 'source' ? 'mobile-pdf-pane is-active' : 'mobile-pdf-pane'}
          onScroll={handleSourceScroll}
          aria-label="Source document"
        >
          <div className="mobile-source-zoom-controls" aria-label="Source zoom">
            <button className="mobile-tool-button" type="button" onClick={() => setSourceZoom(viewerState.sourceZoom - ZOOM_STEP)}>-</button>
            <span>{Math.round(viewerState.sourceZoom * 100)}%</span>
            <button className="mobile-tool-button" type="button" onClick={() => setSourceZoom(viewerState.sourceZoom + ZOOM_STEP)}>+</button>
          </div>
          <div
            className={`mobile-source-interaction-surface tool-${toolMode}`}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={() => {
              activeToolPageRef.current = null
              setDraftPath(null)
            }}
          >
            <div className="mobile-source-document-content">
              {sourceKind === 'web-clean' ? (
                <ReadableWebDocument record={record} zoom={viewerState.sourceZoom}>
                  <AnnotationLayer documentId={record.document.id} pageNumber={1} sourceZoom={effectiveSourceZoom} workspace={workspace} selectionHighlights={sourceSelectionHighlights} linkedAnchors={linkedSourceAnchors} draftPath={draftPath} onTextboxChange={updateTextbox} onTextboxDelete={deleteTextbox} onAnchorPopup={openAnchorPopup} />
                  <SourceToolHitLayer pageNumber={1} />
                </ReadableWebDocument>
              ) : pdfState ? (
                pdfState.pages.map((page, index) => (
                  <div key={index + 1} className="mobile-annotated-page" data-page-number={index + 1}>
                    <PdfCanvasPage page={page} pageNumber={index + 1} zoom={effectiveSourceZoom} />
                    <AnnotationLayer documentId={record.document.id} pageNumber={index + 1} sourceZoom={effectiveSourceZoom} workspace={workspace} selectionHighlights={sourceSelectionHighlights} linkedAnchors={linkedSourceAnchors} draftPath={draftPath} onTextboxChange={updateTextbox} onTextboxDelete={deleteTextbox} onAnchorPopup={openAnchorPopup} />
                    <SourceToolHitLayer pageNumber={index + 1} />
                  </div>
                ))
              ) : (
                <div className="mobile-loading-panel">No visual PDF bytes found for this document.</div>
              )}
            </div>
            {sourceKind !== 'web-clean' && record && workspace ? (
              <SelectionManager
                rootRef={sourcePaneRef}
                workspaceId={workspace.workspaceId}
                documentId={record.document.id}
                bookmarkedAnchorIds={workspace.bookmarks.map((bookmark) => bookmark.sourceAnchorId)}
                linkedAnchorIds={workspace.nodes.flatMap((node) => (node.sourceAnchorId ? [node.sourceAnchorId] : []))}
                popupState={pdfSelectionPopup}
                onPopupStateChange={setPdfSelectionPopup}
                onAutoExcerpt={({ selection, viewportRatio }: { selection: SelectionArtifactInput; viewportRatio: number }) => createPdfExcerptFromSelection(selection, viewportRatio)}
                onComment={({ selection, viewportRatio }: { selection: SelectionArtifactInput; viewportRatio: number }) => createPdfCommentFromSelection(selection, viewportRatio)}
                onBookmark={bookmarkPdfSelection}
                onTag={tagPdfSelection}
                onSelectionChange={recolorPdfSelection}
                onClearSourceSelection={clearSourceSelection}
                onClearFocus={() =>
                  updateWorkspace((current) => ({
                    ...current,
                    activeAnchorId: null,
                    updatedAt: new Date().toISOString()
                  }))
                }
              />
            ) : null}
          </div>

          {panelMode === 'source-tools' && toolSettings ? (
            <ToolPanel
              toolMode={toolMode}
              settings={toolSettings}
              onToolMode={(mode) => {
                setToolMode(mode)
                if (mode === 'select') setPanelMode(null)
              }}
              onSettingsChange={updateToolSettings}
              onClose={() => setPanelMode(null)}
            />
          ) : null}
        </section>

        <div
          className="mobile-pane-divider"
          role="separator"
          aria-orientation="vertical"
          tabIndex={0}
          onDoubleClick={() =>
            updateWorkspace((current) => ({
              ...current,
              viewerLayout: { ...current.viewerLayout, splitRatio: resetSplitRatio() },
              updatedAt: new Date().toISOString()
            }))
          }
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId)
            changeSplit(event.clientX)
          }}
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) changeSplit(event.clientX)
          }}
        />

        <section className={paneMode === 'workspace' ? 'mobile-workspace-pane is-active' : 'mobile-workspace-pane'} aria-label="Workspace">
          <MobileWorkspaceCanvas
            documentId={record.document.id}
            nodes={workspace.nodes}
            canvasEdges={workspace.canvasEdges}
            links={workspace.workspaceLinks}
            viewport={{ ...workspace.workspaceViewport, workspaceZoom: viewerState.workspaceZoom }}
            appZoom={viewerState.viewerZoom}
            activeAnchorId={workspace.activeAnchorId}
            activeNodeId={workspace.activeNodeId}
            linkLayoutKey={linkLayoutKey}
            locked={workspace.viewerLayout.workspaceLocked}
            onNodesChange={(nodes: CanvasNode[]) =>
              updateWorkspace((current) => ({
                ...current,
                nodes,
                updatedAt: new Date().toISOString()
              }))
            }
            onWorkspaceGraphChange={(nodes: CanvasNode[], canvasEdges) =>
              updateWorkspace((current) => ({
                ...current,
                nodes,
                canvasEdges,
                updatedAt: new Date().toISOString()
              }))
            }
            onLinksChange={(workspaceLinks) => updateWorkspace((current) => ({ ...current, workspaceLinks, updatedAt: new Date().toISOString() }))}
            onDeleteNode={(nodeId) =>
              updateWorkspace((current) => ({
                ...current,
                nodes: current.nodes.filter((node) => node.id !== nodeId),
                workspaceLinks: current.workspaceLinks.filter((link) => link.fromNodeId !== nodeId && link.toNodeId !== nodeId),
                canvasEdges: current.canvasEdges.filter((edge) => edge.targetNodeId !== nodeId),
                activeNodeId: current.activeNodeId === nodeId ? null : current.activeNodeId,
                updatedAt: new Date().toISOString()
              }))
            }
            onViewportChange={(workspaceViewport) =>
              updateWorkspace((current) => ({
                ...current,
                workspaceViewport: {
                  panX: workspaceViewport.panX,
                  panY: workspaceViewport.panY
                },
                viewerStateByDocument: {
                  ...workspace.viewerStateByDocument,
                  [record.document.id]: {
                    ...getDocumentViewerState(workspace, record.document.id),
                    workspaceZoom: workspaceViewport.workspaceZoom
                  }
                },
                updatedAt: new Date().toISOString()
              }))
            }
            onActiveNodeChange={(activeNodeId) => updateWorkspace((current) => ({ ...current, activeNodeId, updatedAt: new Date().toISOString() }))}
            onOpenAnchor={focusAnchor}
            onCreateNode={createFreeNode}
          />
        </section>
      </section>

      <footer className="mobile-viewer-footer">
        Page {viewerState.activePage} of {Math.max(record.document.pageCount, pdfState?.pages.length ?? 1)} · {sourceKindLabel(sourceKind)}
      </footer>

      {selectionPopup ? (
        <SelectionActionPopup
          key={`${selectionPopup.selection.text}:${selectionPopup.left}:${selectionPopup.top}`}
          popup={selectionPopup}
          bookmarked={workspace.bookmarks.some((bookmark) => bookmark.sourceAnchorId === buildPageAnchor({ ...selectionPopup.selection, selectionColor: selectionPopup.color ?? '#5d5df6', tags: selectionPopup.tags }).id)}
          onExcerpt={() => createExcerptFromSelection(selectionPopup)}
          onComment={() => createCommentFromSelection(selectionPopup)}
          onBookmark={() => bookmarkSelection(selectionPopup)}
          onTags={(tags) => tagSelection(selectionPopup, tags)}
          onClearTags={() => tagSelection(selectionPopup, [])}
          onColor={(color) => recolorSelection(selectionPopup, color)}
          onCopy={() => { void navigator.clipboard?.writeText(selectionPopup.selection.text).catch(() => {}) }}
          onClear={() => {
            clearSourceSelection(selectionPopup.selection)
            setSelectionPopup(null)
            try { document.getSelection()?.removeAllRanges() } catch {}
          }}
        />
      ) : null}

      {panelMode === 'page-edit' ? (
        <Modal title="Edit Pages" onClose={() => setPanelMode(null)}>
          <section className="mobile-settings-section">
            <h2>Pages</h2>
            <div className="mobile-source-list">
              {Array.from({ length: Math.max(record.document.pageCount, pdfState?.pages.length ?? 1) }, (_, index) => (
                <button key={index + 1} type="button" onClick={() => { scrollToPage(index + 1); setPanelMode(null) }}>
                  <strong>Page {index + 1}</strong>
                  <span>Open page</span>
                </button>
              ))}
            </div>
            <p>Insert, delete, rotate, and reorder are disabled in mobile V1.</p>
          </section>
        </Modal>
      ) : null}

      {panelMode === 'navigate' ? (
        <Modal title="Navigate" onClose={() => setPanelMode(null)}>
          <div className="mobile-form-grid">
            <label>Query<input value={query} onChange={(event) => setQuery(event.target.value)} /></label>
            <label>Page<input value={pageInput} inputMode="numeric" onChange={(event) => setPageInput(event.target.value)} /></label>
            <label>Document<input value={record.document.title} readOnly /></label>
            <label>Tag<input value={tagInput} onChange={(event) => setTagInput(event.target.value)} placeholder="important" /></label>
          </div>
          <div className="mobile-segmented-control">
            <button className={navigateScope === 'current-doc' ? 'is-active' : ''} type="button" onClick={() => setNavigateScope('current-doc')}>Current doc</button>
            <button className={navigateScope === 'all-docs' ? 'is-active' : ''} type="button" onClick={() => setNavigateScope('all-docs')}>All docs</button>
          </div>
          <button className="mobile-primary-button" type="button" onClick={runNavigate}>Go</button>
        </Modal>
      ) : null}

      {panelMode === 'more' ? (
        <Modal title="More" onClose={() => setPanelMode(null)}>
          <section className="mobile-settings-section">
            <h2>Project</h2>
            <p>{record.document.title}</p>
          </section>
          <section className="mobile-settings-section">
            <h2>Syncing</h2>
            <label className="mobile-toggle-row">
              <input
                type="checkbox"
                checked={workspace.settings.syncEnabled}
                disabled
                onChange={() => undefined}
              />
              Sync backend unavailable
            </label>
          </section>
          <section className="mobile-settings-section">
            <h2>Display</h2>
            <label>Density
              <select
                value={workspace.settings.displayDensity}
                onChange={(event) =>
                  updateWorkspace((current) => ({
                    ...current,
                    settings: { ...current.settings, displayDensity: event.target.value as 'comfortable' | 'compact' },
                    updatedAt: new Date().toISOString()
                  }))
                }
              >
                <option value="comfortable">Comfortable</option>
                <option value="compact">Compact</option>
              </select>
            </label>
            <label className="mobile-toggle-row">
              <input
                type="checkbox"
                checked={workspace.viewerLayout.sourceToolsOpen}
                onChange={(event) =>
                  updateWorkspace((current) => ({
                    ...current,
                    viewerLayout: { ...current.viewerLayout, sourceToolsOpen: event.target.checked },
                    updatedAt: new Date().toISOString()
                  }))
                }
              />
              Keep source tools open
            </label>
            <label className="mobile-toggle-row">
              <input
                type="checkbox"
                checked={workspace.viewerLayout.workspaceLocked}
                onChange={(event) =>
                  updateWorkspace((current) => ({
                    ...current,
                    viewerLayout: { ...current.viewerLayout, workspaceLocked: event.target.checked },
                    updatedAt: new Date().toISOString()
                  }))
                }
              />
              Lock workspace
            </label>
            <label className="mobile-toggle-row">
              <input
                type="checkbox"
                checked={workspace.viewerLayout.autoPositionComments}
                onChange={(event) =>
                  updateWorkspace((current) => ({
                    ...current,
                    viewerLayout: { ...current.viewerLayout, autoPositionComments: event.target.checked },
                    updatedAt: new Date().toISOString()
                  }))
                }
              />
              Auto-position comments
            </label>
          </section>
        </Modal>
      ) : null}
    </main>
    </div>
  )
}

function ViewerHeader({ title, subtitle, status }: { title: string; subtitle: string; status: string }) {
  return (
    <header className="mobile-viewer-titlebar">
      <div>
        <p>{subtitle}</p>
        <h1>{title}</h1>
      </div>
      <span>{status}</span>
    </header>
  )
}

function ReadableWebDocument({ record, zoom, children }: { record: MobileDocumentRecord; zoom: number; children: React.ReactNode }) {
  const sections = record.webContent?.sections ?? fallbackSections(record)
  const sourceLink = record.finalUrl ?? record.sourceUrl ?? ''
  return (
    <div className="mobile-annotated-page mobile-readable-page" data-page-number="1">
      <article className="mobile-readable-web-document" style={{ transform: `scale(${zoom})`, transformOrigin: 'top center' }}>
        <header>
          <p>{sourceLink}</p>
          <h2>{record.webContent?.title ?? record.document.title}</h2>
        </header>
        {record.sanitizedHtml ? <div className="mobile-readable-html" dangerouslySetInnerHTML={{ __html: record.sanitizedHtml }} /> : null}
        {!record.sanitizedHtml && record.markdown ? <pre className="mobile-readable-markdown">{record.markdown}</pre> : null}
        {!record.sanitizedHtml && !record.markdown
          ? sections.map((section: MobileWebSection, index: number) => <ReadableSection key={`${section.kind}-${index}`} section={section} />)
          : null}
      </article>
      {children}
    </div>
  )
}

function ReadableSection({ section }: { section: MobileWebSection }) {
  const props = { 'data-search-text': section.text }
  if (section.kind === 'heading') {
    if ((section.level ?? 2) <= 2) return <h2 {...props}>{section.text}</h2>
    if (section.level === 3) return <h3 {...props}>{section.text}</h3>
    return <h4 {...props}>{section.text}</h4>
  }
  return <p {...props} className={section.kind === 'list-item' ? 'mobile-readable-list-item' : undefined}>{section.text}</p>
}

function SourceSidePanel({
  activePanel,
  pageEditActive,
  textboxActive,
  popupTitle,
  onPopupClose,
  onHighlightView,
  onTextbox,
  onPageEdit,
  onDocuments,
  onBookmarks,
  onPopupToggle,
  children
}: {
  activePanel: LeftPopupMode
  pageEditActive: boolean
  textboxActive: boolean
  popupTitle: string
  onPopupClose: () => void
  onHighlightView: () => void
  onTextbox: () => void
  onPageEdit: () => void
  onDocuments: () => void
  onBookmarks: () => void
  onPopupToggle: () => void
  children: React.ReactNode
}) {
  return (
    <aside className="mobile-viewer-side-panel" aria-label="Source actions">
      <button className={activePanel === 'highlight-view' ? 'is-active' : ''} type="button" title="Highlight View - see all highlights together" aria-label="Highlight View" onClick={onHighlightView}>
        <Icon name="highlightView" />
        <span>Highlight View</span>
      </button>
      <button className={textboxActive ? 'is-active' : ''} type="button" title="Insert textbox in document" aria-label="Insert Textbox" onClick={onTextbox}>
        <Icon name="textbox" />
        <span>Insert Textbox</span>
      </button>
      <button className={pageEditActive ? 'is-active' : ''} type="button" title="Edit pages in this document" aria-label="Edit Pages" onClick={onPageEdit}>
        <Icon name="editPages" />
        <span>Edit Pages</span>
      </button>
      <button className={activePanel === 'documents' ? 'is-active' : ''} type="button" title="See document list or add new document" aria-label="Documents" onClick={onDocuments}>
        <Icon name="docs" />
        <span>Documents</span>
      </button>
      <button className={activePanel === 'bookmarks' ? 'is-active' : ''} type="button" title="See outlines and bookmarked sentences" aria-label="Outlines / Bookmarks" onClick={onBookmarks}>
        <Icon name="bookmark" />
        <span>Bookmarks</span>
      </button>
      <button
        className={activePanel ? 'mobile-left-popup-toggle is-active' : 'mobile-left-popup-toggle'}
        type="button"
        title={activePanel ? 'Close left popup' : 'Open left popup'}
        aria-label={activePanel ? 'Close left popup' : 'Open left popup'}
        aria-expanded={Boolean(activePanel)}
        onClick={onPopupToggle}
      >
        {activePanel ? '‹' : '›'}
        <span>Popup</span>
      </button>
      <section className={`mobile-left-popup-panel${activePanel ? ' is-open' : ' is-hidden'}`} aria-label="Source context panel" aria-hidden={!activePanel}>
        <header>
          <h2>{popupTitle}</h2>
          <button className="mobile-modal-close" type="button" aria-label="Close" onClick={onPopupClose}>×</button>
        </header>
        <div className="mobile-left-popup-body">{children}</div>
      </section>
    </aside>
  )
}

function leftPopupTitle(mode: Exclude<LeftPopupMode, null>) {
  if (mode === 'highlight-view') return 'Highlight View'
  if (mode === 'documents') return 'Documents'
  if (mode === 'bookmarks') return 'Outlines / Bookmarks'
  return 'Share'
}

function AnnotationLayer({
  documentId,
  pageNumber,
  sourceZoom,
  workspace,
      selectionHighlights,
      linkedAnchors,
      draftPath,
  onTextboxChange,
  onTextboxDelete,
  onAnchorPopup
}: {
  documentId: string
  pageNumber: number
  sourceZoom: number
  workspace: MobileWorkspaceState
  selectionHighlights: PageAnchor[]
  linkedAnchors: PageAnchor[]
  draftPath: DraftPath | null
  onTextboxChange: (textbox: SourceTextbox) => void
  onTextboxDelete: (textboxId: string) => void
  onAnchorPopup: (anchor: PageAnchor) => void
}) {
  const pageSelectionHighlights = selectionHighlights.filter((entry) => entry.pageNumber === pageNumber)
  const pageLinkedAnchors = linkedAnchors.filter((entry) => entry.pageNumber === pageNumber)
  const bookmarkAnchorIds = new Set(workspace.bookmarks.filter((bookmark) => bookmark.documentId === documentId).map((bookmark) => bookmark.sourceAnchorId))
  const pageBookmarkAnchors = pageSelectionHighlights.filter((anchor) => bookmarkAnchorIds.has(anchor.id))
  const highlights = (workspace.freeformHighlights ?? []).filter((entry) => entry.documentId === documentId && (entry.pageNumber ?? 1) === pageNumber)
  const inkStrokes = (workspace.inkStrokes ?? []).filter((entry) => entry.documentId === documentId && (entry.pageNumber ?? 1) === pageNumber)
  const textboxes = (workspace.sourceTextboxes ?? []).filter((entry) => entry.documentId === documentId && (entry.pageNumber ?? 1) === pageNumber)
  const draft = draftPath?.pageNumber === pageNumber ? draftPath : null
  return (
    <div className="mobile-annotation-layer">
      {pageSelectionHighlights.flatMap((anchor) =>
        bookmarkAnchorIds.has(anchor.id) ? [] : anchorToHighlightRects(anchor, sourceZoom).map((rect, index) => (
          <div
            key={`${anchor.id}-${index}`}
            data-anchor-id={anchor.id}
            className={`mobile-text-highlight${workspace.activeAnchorId === anchor.id ? ' is-active' : ''}`}
            style={{
              left: rect.x,
              top: rect.y,
              width: Math.max(8, rect.width),
              height: Math.max(8, rect.height),
              background: anchor.selectionColor ? `${anchor.selectionColor}44` : 'rgba(255, 255, 255, 0.01)',
              borderColor: anchor.selectionColor ?? 'rgba(24, 33, 43, 0.35)'
            }}
            title={anchor.textQuote}
            aria-hidden="true"
          >
            {index === 0
              ? (anchor.tags ?? []).slice(0, 2).map((tag) => (
                  <span key={tag}>#{tag}</span>
                ))
              : null}
          </div>
        ))
      )}
      {pageBookmarkAnchors.map((anchor) => {
        const rect = anchorToHighlightRects(anchor, sourceZoom)[0]
        if (!rect) return null
        return (
          <button
            key={`bookmark-${anchor.id}`}
            type="button"
            className="mobile-source-bookmark-icon"
            data-anchor-id={anchor.id}
            title={anchor.textQuote}
            aria-label={`Bookmark for ${anchor.textQuote.slice(0, 48)}`}
            style={{
              left: Math.max(0, rect.x - 16),
              top: Math.max(0, rect.y - 8)
            }}
            onClick={() => onAnchorPopup(anchor)}
          >
            <img src={bookmarkIcon.src} alt="" />
          </button>
        )
      })}
      {pageLinkedAnchors.map((anchor) => {
        const marker = anchorMarkerPosition(anchor, sourceZoom)
        const color = visibleAnchorColor(anchor)
        return (
          <button
            key={anchor.id}
            data-anchor-id={anchor.id}
            className={`mobile-source-anchor-marker page-anchor-indicator page-anchor-indicator-right${workspace.activeAnchorId === anchor.id ? ' is-active' : ''}`}
            type="button"
            title={anchor.textQuote}
            aria-label={`Source anchor for ${anchor.textQuote.slice(0, 48)}`}
            style={{
              top: marker.top,
              color,
              background: color,
              borderColor: color
            }}
            onClick={() => onAnchorPopup(anchor)}
          />
        )
      })}
      <svg className="mobile-source-overlay" aria-hidden="true" viewBox="0 0 1 1" preserveAspectRatio="none">
        {highlights.map((highlight) => (
          <polyline
            key={highlight.id}
            className="mobile-freeform-highlight-path"
            points={pointsToPolyline(highlight.points)}
            stroke={highlight.color}
            strokeWidth={(highlight.size ?? 18) / 900}
            opacity={highlight.opacity ?? 0.42}
          />
        ))}
        {draft?.kind === 'freeform-highlight' ? (
          <polyline className="mobile-freeform-highlight-path is-draft" points={pointsToPolyline(draft.points)} stroke={workspace.toolSettings.highlight.color} strokeWidth={workspace.toolSettings.highlight.size / 900} />
        ) : null}
        {inkStrokes.map((stroke) => (
          <polyline
            key={stroke.id}
            className={`mobile-ink-path${stroke.tool === 'pencil' ? ' is-pencil' : ''}`}
            points={pointsToPolyline(stroke.points)}
            stroke={stroke.color}
            strokeWidth={(stroke.size ?? 4) / 900}
            opacity={stroke.tool === 'pencil' ? stroke.opacity ?? 0.58 : undefined}
          />
        ))}
        {draft?.kind === 'pen' ? (
          <polyline className="mobile-ink-path is-draft" points={pointsToPolyline(draft.points)} stroke={workspace.toolSettings.pen.color} strokeWidth={workspace.toolSettings.pen.size / 900} />
        ) : null}
        {draft?.kind === 'pencil' ? (
          <polyline className="mobile-ink-path is-draft is-pencil" points={pointsToPolyline(draft.points)} stroke={workspace.toolSettings.pencil.color} strokeWidth={workspace.toolSettings.pencil.size / 900} opacity={workspace.toolSettings.pencil.opacity} />
        ) : null}
      </svg>
      {textboxes.map((textbox) => (
        <SourceTextboxView key={textbox.id} textbox={textbox} onChange={onTextboxChange} onDelete={onTextboxDelete} />
      ))}
    </div>
  )
}

function SourceToolHitLayer({ pageNumber }: { pageNumber: number }) {
  return <div className="mobile-source-tool-hit-layer" data-page-number={pageNumber} aria-hidden="true" />
}

function SourceTextboxView({ textbox, onChange, onDelete }: { textbox: SourceTextbox; onChange: (textbox: SourceTextbox) => void; onDelete: (textboxId: string) => void }) {
  function stopSourceTextboxEvent(event: React.PointerEvent<HTMLElement>) {
    event.stopPropagation()
  }

  return (
    <div
      className="mobile-source-textbox-shell"
      onPointerDown={stopSourceTextboxEvent}
      onPointerMove={stopSourceTextboxEvent}
      onPointerUp={stopSourceTextboxEvent}
      style={{
        left: `${textbox.xNorm * 100}%`,
        top: `${textbox.yNorm * 100}%`,
        width: `${(textbox.widthNorm ?? 0.28) * 100}%`,
        minHeight: `${(textbox.heightNorm ?? 0.16) * 100}%`
      }}
    >
      <div className="mobile-source-textbox-handle">
        <span>Text</span>
        <button type="button" onClick={(event) => { event.stopPropagation(); onDelete(textbox.id) }}>Delete</button>
      </div>
      <textarea
        className="mobile-source-textbox"
        value={textbox.content}
        placeholder="Type source note..."
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => onChange({ ...textbox, content: event.target.value })}
      />
    </div>
  )
}

function ToolPanel({
  toolMode,
  settings,
  onToolMode,
  onSettingsChange,
  onClose
}: {
  toolMode: ToolMode
  settings: MobileToolSettings
  onToolMode: (mode: ToolMode) => void
  onSettingsChange: (settings: MobileToolSettings) => void
  onClose: () => void
}) {
  return (
    <aside className="mobile-tool-panel" aria-label="Source tools">
      <header>
        <strong>Source Tools</strong>
        <button className="mobile-secondary-button" type="button" onClick={onClose}>Close</button>
      </header>
      <div className="mobile-tool-selector">
        {SOURCE_TOOLS.map((tool) => (
          <button key={tool.mode} className={toolMode === tool.mode ? 'is-active' : ''} type="button" onClick={() => onToolMode(tool.mode)}>
            <Icon name={tool.icon} /> {tool.label}
          </button>
        ))}
      </div>
      <label>Pen color<input type="color" value={settings.pen.color} onChange={(event) => onSettingsChange({ ...settings, pen: { ...settings.pen, color: event.target.value } })} /></label>
      <label>Pen size<input type="range" min="1" max="18" value={settings.pen.size} onChange={(event) => onSettingsChange({ ...settings, pen: { ...settings.pen, size: Number(event.target.value) } })} /></label>
      <label>Pencil color<input type="color" value={settings.pencil.color} onChange={(event) => onSettingsChange({ ...settings, pencil: { ...settings.pencil, color: event.target.value } })} /></label>
      <label>Pencil size<input type="range" min="1" max="14" value={settings.pencil.size} onChange={(event) => onSettingsChange({ ...settings, pencil: { ...settings.pencil, size: Number(event.target.value) } })} /></label>
      <label>Pencil opacity<input type="range" min="0.2" max="0.9" step="0.01" value={settings.pencil.opacity} onChange={(event) => onSettingsChange({ ...settings, pencil: { ...settings.pencil, opacity: Number(event.target.value) } })} /></label>
      <label>Highlight color<input type="color" value={settings.highlight.color} onChange={(event) => onSettingsChange({ ...settings, highlight: { ...settings.highlight, color: event.target.value } })} /></label>
      <label>Highlight size<input type="range" min="8" max="42" value={settings.highlight.size} onChange={(event) => onSettingsChange({ ...settings, highlight: { ...settings.highlight, size: Number(event.target.value) } })} /></label>
      <label>Opacity<input type="range" min="0.15" max="0.8" step="0.01" value={settings.highlight.opacity} onChange={(event) => onSettingsChange({ ...settings, highlight: { ...settings.highlight, opacity: Number(event.target.value) } })} /></label>
      <label className="mobile-toggle-row"><input type="checkbox" checked={settings.highlight.smoothed} onChange={(event) => onSettingsChange({ ...settings, highlight: { ...settings.highlight, smoothed: event.target.checked } })} /> Smooth highlight</label>
      <label>Eraser size<input type="range" min="12" max="72" value={settings.eraser.size} onChange={(event) => onSettingsChange({ ...settings, eraser: { ...settings.eraser, size: Number(event.target.value) } })} /></label>
    </aside>
  )
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="mobile-modal-backdrop" role="presentation">
      <section className="mobile-modal" role="dialog" aria-modal="true" aria-label={title}>
        <header>
          <h2>{title}</h2>
          <button className="mobile-modal-close" type="button" aria-label="Close" onClick={onClose}>×</button>
        </header>
        <div className="mobile-modal-body">{children}</div>
      </section>
    </div>
  )
}

function SelectionActionPopup({
  popup,
  bookmarked,
  onExcerpt,
  onComment,
  onBookmark,
  onTags,
  onClearTags,
  onColor,
  onCopy,
  onClear
}: {
  popup: SelectionPopupState
  bookmarked: boolean
  onExcerpt: () => void
  onComment: () => void
  onBookmark: () => void
  onTags: (tags: string[]) => void
  onClearTags: () => void
  onColor: (color: string) => void
  onCopy: () => void
  onClear: () => void
}) {
  const [tagDraft, setTagDraft] = useState(popup.tags.join(', '))
  const [expanded, setExpanded] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const popupRef = useRef<HTMLElement | null>(null)
  const [position, setPosition] = useState({ left: popup.left, top: popup.top })
  const [popupSize, setPopupSize] = useState({ width: 0, height: 0 })
  const swatches = ['#ff6b6b', '#2ecc71', '#5d5df6', '#ffd400', '#db38ff', '#00b8d9']
  const tags = tagDraft.split(',').map((tag) => tag.trim()).filter(Boolean)

  useEffect(() => {
    setExpanded(false)
    setMoreOpen(false)
    setTagDraft(popup.tags.join(', '))
  }, [popup.selection.text, popup.tags])
  
  useLayoutEffect(() => {
    const element = popupRef.current
    if (!element) return

    const emit = () => {
      const rect = element.getBoundingClientRect()
      setPopupSize((current) =>
        Math.abs(current.width - rect.width) < 0.5 && Math.abs(current.height - rect.height) < 0.5
          ? current
          : { width: rect.width, height: rect.height }
      )
    }

    emit()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(emit)
    observer.observe(element)
    return () => observer.disconnect()
  }, [expanded, moreOpen, tagDraft])

  useLayoutEffect(() => {
    if (!popupSize.width || !popupSize.height) return
    const next = resolveSelectionPopupPosition({
      preferredLeft: popup.left,
      preferredTop: popup.top,
      popupWidth: popupSize.width,
      popupHeight: popupSize.height,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      selectionRect: popup.selectionRect
    })
    setPosition((current) =>
      Math.abs(current.left - next.left) < 0.5 && Math.abs(current.top - next.top) < 0.5 ? current : next
    )
  }, [popupSize, popup.left, popup.top, popup.selectionRect])

  function handleClearPointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault()
    event.stopPropagation()
    onClear()
  }

  return (
    <aside ref={popupRef} className={`mobile-selection-popup selection-action-popup ${expanded ? 'is-mobile-expanded' : 'is-mobile-compact'}`} style={{ left: position.left, top: position.top, borderColor: `${popup.color ?? '#5d5df6'}55`, boxShadow: `0 22px 45px ${popup.color ?? '#5d5df6'}22` }}>
      <div className="selection-action-header">
        <div className="mobile-selection-actions selection-action-row">
          <button className="selection-action-pill selection-action-pill-primary" style={{ background: popup.color ?? '#5d5df6' }} type="button" onClick={onExcerpt}>Auto Excerpt</button>
          <button className="selection-action-pill" type="button" onClick={onComment}>Comment</button>
          <button className="selection-action-pill" type="button" onClick={onBookmark}>{bookmarked ? 'Remove Bookmark' : 'Bookmark'}</button>
          <button className="selection-action-pill" type="button" onClick={() => setExpanded(true)}>Tag</button>
          <button className="selection-action-pill" type="button" onPointerDown={handleClearPointerDown}>Clear</button>
          <div className="selection-action-more">
            <button className="selection-action-pill" type="button" onClick={() => { setExpanded(true); setMoreOpen((current) => !current) }}>...</button>
            {moreOpen ? (
              <div className="selection-action-menu">
                <div className="selection-action-menu-inner">
                  <button className="selection-action-menu-item" type="button" onClick={onCopy}>Copy</button>
                  <button className="selection-action-menu-item" type="button" onClick={() => { onClearTags(); setTagDraft(''); setMoreOpen(false) }}>Clear Tags</button>
                  <button className="selection-action-menu-item" type="button" onClick={() => { onTags(Array.from(new Set([...tags, 'defined-term']))); setMoreOpen(false) }}>Add Defined Term</button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
      <div className="selection-action-content">
        <div className="selection-action-row selection-action-row-secondary">
          <div className="mobile-selection-swatches selection-action-swatches">
            {swatches.map((color) => (
              <button key={color} type="button" style={{ background: color, boxShadow: popup.color === color ? '0 0 0 3px rgba(53, 94, 153, 0.22)' : 'none' }} className="selection-action-swatch" onClick={() => onColor(color)} />
            ))}
          </div>
          <label className="selection-action-tags">
            Tags
            <input
              value={tagDraft}
              placeholder="important, evidence"
              onChange={(event) => setTagDraft(event.target.value)}
              onBlur={() => onTags(tags)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') onTags(tags)
              }}
            />
          </label>
        </div>
      </div>
    </aside>
  )
}

type IconName = 'home' | 'back' | 'forward' | 'select' | 'pen' | 'highlighter' | 'eraser' | 'more' | 'textbox' | 'outline' | 'bookmark' | 'docs' | 'highlightView' | 'editPages'

function Icon({ name }: { name: IconName }) {
  const common = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true }
  if (name === 'home') return <svg {...common}><path d="m3 11 9-8 9 8" /><path d="M5 10v10h14V10" /><path d="M10 20v-6h4v6" /></svg>
  if (name === 'back') return <svg {...common}><path d="m15 18-6-6 6-6" /></svg>
  if (name === 'forward') return <svg {...common}><path d="m9 18 6-6-6-6" /></svg>
  if (name === 'pen') return <svg {...common}><path d="m12 20 9-9-4-4-9 9-2 6 6-2Z" /><path d="m15 8 1 1" /></svg>
  if (name === 'highlighter') return <svg {...common}><path d="m9 11 6 6" /><path d="m4 20 4-1 10-10-3-3L5 16l-1 4Z" /><path d="m14 5 5 5" /></svg>
  if (name === 'eraser') return <svg {...common}><path d="m7 21-4-4 11-11 7 7-8 8H7Z" /><path d="M14 21h7" /></svg>
  if (name === 'textbox') return <svg {...common}><path d="M4 20 10 4h4l6 16" /><path d="M7 14h10" /></svg>
  if (name === 'highlightView') return <svg {...common}><path d="m7 7-2 2-2-2" /><path d="M10 8h10" /><path d="m7 17-2-2-2 2" /><path d="M10 16h10" /></svg>
  if (name === 'editPages') return <svg {...common}><rect x="4" y="4" width="6" height="6" /><rect x="14" y="4" width="6" height="6" /><rect x="4" y="14" width="6" height="6" /><rect x="14" y="14" width="6" height="6" /></svg>
  if (name === 'outline') return <svg {...common}><path d="M4 7h2" /><path d="M4 12h2" /><path d="M4 17h2" /><path d="M10 7h10" /><path d="M10 12h10" /><path d="M10 17h10" /></svg>
  if (name === 'bookmark') return <svg {...common}><path d="M6 4h12v18l-6-4-6 4V4Z" /><path d="M12 8v6" /><path d="M9 11h6" /></svg>
  if (name === 'docs') return <svg {...common}><path d="M6 3h9l3 3v15H6V3Z" /><path d="M14 3v4h4" /><path d="M9 13h6" /><path d="M12 10v6" /></svg>
  if (name === 'more') return <svg {...common}><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></svg>
  return <svg {...common}><path d="M4 4 14 20l2-7 6-2L4 4Z" /></svg>
}

function toolIcon(mode: ToolMode): IconName {
  if (mode === 'pen' || mode === 'pencil') return 'pen'
  if (mode === 'freeform-highlight') return 'highlighter'
  if (mode === 'eraser') return 'eraser'
  return 'select'
}

function captureReadableSelection(root: HTMLElement) {
  const selection = document.getSelection()
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null
  const range = selection.getRangeAt(0)
  const page = (range.commonAncestorContainer instanceof Element
    ? range.commonAncestorContainer.closest<HTMLElement>('.mobile-readable-page')
    : range.commonAncestorContainer.parentElement?.closest<HTMLElement>('.mobile-readable-page')) ?? root.querySelector<HTMLElement>('.mobile-readable-page')
  if (!page || !root.contains(page)) return null
  const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 1 && rect.height > 1)
  const rect = buildUnionRect(rects) ?? range.getBoundingClientRect()
  if (!rect || rect.width <= 0 || rect.height <= 0) return null
  const pageRect = page.getBoundingClientRect()
  const selectedText = selection.toString().replace(/\s+/g, ' ').trim()
  return {
    text: selectedText,
    pageNumber: Number(page.dataset.pageNumber ?? 1),
    anchor: {
      pageNumber: Number(page.dataset.pageNumber ?? 1),
      boundingBox: {
        x: rect.left - pageRect.left,
        y: rect.top - pageRect.top,
        width: rect.width,
        height: rect.height
      },
      quadPoints: rects.flatMap((entry) => [
        entry.left - pageRect.left,
        entry.top - pageRect.top,
        entry.right - pageRect.left,
        entry.top - pageRect.top,
        entry.right - pageRect.left,
        entry.bottom - pageRect.top,
        entry.left - pageRect.left,
        entry.bottom - pageRect.top
      ]),
      viewportScale: 1,
      textQuote: selectedText
    }
  }
}

function capturePdfSelection(root: HTMLElement): CapturedSourceSelection | null {
  const selection = document.getSelection()
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null
  const range = selection.getRangeAt(0)
  const textLayer = closestFromNode(selection.anchorNode, '.textLayer') ?? closestFromNode(selection.focusNode, '.textLayer') ?? closestFromNode(range.commonAncestorContainer, '.textLayer')
  const page =
    textLayer?.closest<HTMLElement>('.page') ??
    closestFromNode(selection.anchorNode, '.page') ??
    closestFromNode(selection.focusNode, '.page') ??
    closestFromNode(range.commonAncestorContainer, '.page')
  const pageLayer =
    textLayer?.closest<HTMLElement>('.mobile-pdf-page-layer') ??
    closestFromNode(selection.anchorNode, '.mobile-pdf-page-layer') ??
    closestFromNode(selection.focusNode, '.mobile-pdf-page-layer') ??
    closestFromNode(range.commonAncestorContainer, '.mobile-pdf-page-layer')
  if (!page || !pageLayer || !root.contains(page)) return null
  const layerRect = pageLayer.getBoundingClientRect()
  const start = resolveRangeBoundary(range, 'start')
  const end = resolveRangeBoundary(range, 'end')
  const selectedText = reconstructPdfSelectionText(textLayer, range, start, end) || selection.toString().replace(/\s+/g, ' ').trim()
  if (!selectedText) return null
  const rawRects = getVisibleSelectionClientRects(range, textLayer, pageLayer)
  const meaningfulRects = rawRects.filter((rect) => rect.width > 1 && rect.height > 1)
  const rects = mergeNearbyRects(meaningfulRects.length > 0 ? meaningfulRects : rawRects)
  const pageGeometry = convertClientRectsToPageAnchorGeometry(rects, pageLayer)
  if (!pageGeometry) return null
  const pageNumber = Number(page.dataset.pageNumber ?? 1)
  const viewportScale = Number(page.dataset.viewportScale ?? 1)

  if (DEBUG_PDF_SELECTION) {
    console.debug('[pdf-selection]', {
      pageNumber,
      viewportScale,
      appScale: pageGeometry.captureScale,
      layerRect: {
        left: Math.round(layerRect.left),
        top: Math.round(layerRect.top),
        width: Math.round(layerRect.width),
        height: Math.round(layerRect.height)
      },
      rectCount: rects.length,
      firstQuad: pageGeometry.quadPoints.slice(0, 8),
      boundingBox: pageGeometry.boundingBox,
      text: selectedText.slice(0, 72)
    })
  }

  return {
    text: selectedText,
    pageNumber,
    anchor: {
      pageNumber,
      startSpanIndex: start?.index,
      startOffset: start?.offset,
      endSpanIndex: end?.index,
      endOffset: end?.offset,
      boundingBox: pageGeometry.boundingBox,
      quadPoints: pageGeometry.quadPoints,
      viewportScale,
      textQuote: selectedText
    }
  }
}

function closestFromNode(node: Node | null, selector: string) {
  if (!node) return null
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
  return element?.closest<HTMLElement>(selector) ?? null
}

function getVisibleSelectionClientRects(range: Range, textLayer: HTMLElement | null, pageLayer: HTMLElement | null) {
  if (!textLayer || !pageLayer) return []
  const layerRect = pageLayer.getBoundingClientRect()
  const browserRects = Array.from(range.getClientRects()).filter(
    (rect) =>
      rect.width > 0.5 &&
      rect.height > 0.5 &&
      rect.left < layerRect.right &&
      rect.right > layerRect.left &&
      rect.top < layerRect.bottom &&
      rect.bottom > layerRect.top
  )
  if (browserRects.length > 0) return dedupeRects(browserRects)

  const startBoundary = resolveRangeBoundary(range, 'start')
  const endBoundary = resolveRangeBoundary(range, 'end')
  const selectedSpanSlices = collectSelectedSpanSlices(textLayer, range, startBoundary, endBoundary)
  const indexedRects =
    selectedSpanSlices.length > 0
      ? buildRectsFromSelectedSpanSlices(selectedSpanSlices)
      : buildRectsFromIndexedSpans(textLayer, startBoundary, endBoundary)
  return dedupeRects(indexedRects)
}

type ResolvedBoundary = {
  span: HTMLElement
  index: number
  offset: number
}

type SelectedSpanSlice = {
  span: HTMLElement
  index: number
  startOffset: number
  endOffset: number
}

type PositionedSelectionText = {
  text: string
  left: number
  top: number
  width: number
  height: number
}

function resolveRangeBoundary(range: Range, boundary: 'start' | 'end') {
  const container = boundary === 'start' ? range.startContainer : range.endContainer
  const offset = boundary === 'start' ? range.startOffset : range.endOffset
  const span = findIndexedSpanForBoundary(container, offset, boundary === 'end')
  if (!span) return null
  const index = Number(span.dataset.textIndex)
  if (!Number.isFinite(index)) return null
  const resolvedOffset = getBoundaryOffsetWithinSpan(span, container, offset)
  return { span, index, offset: clampTextOffset(resolvedOffset, getSpanTextLength(span)) }
}

function findIndexedSpanWithin(node: Node | null, fromEnd = false): HTMLElement | null {
  if (!node) return null
  if (node instanceof HTMLElement && node.matches('span[data-text-index]')) return node
  if (node instanceof Text) return node.parentElement?.closest<HTMLElement>('span[data-text-index]') ?? null
  if (node instanceof Element) {
    const matches = node.querySelectorAll<HTMLElement>('span[data-text-index]')
    return fromEnd ? matches[matches.length - 1] ?? null : matches[0] ?? null
  }
  return null
}

function findIndexedSpanForBoundary(container: Node, offset: number, isEndBoundary: boolean) {
  const direct = closestFromNode(container, 'span[data-text-index]')
  if (direct) return direct
  if (!(container instanceof Element)) return null

  const childNodes = Array.from(container.childNodes)
  const preferredChild = isEndBoundary
    ? childNodes[Math.max(0, Math.min(childNodes.length - 1, offset - 1))] ?? null
    : childNodes[Math.max(0, Math.min(childNodes.length - 1, offset))] ?? null
  const preferredSpan = findIndexedSpanWithin(preferredChild, isEndBoundary)
  if (preferredSpan) return preferredSpan

  if (isEndBoundary) {
    for (let index = Math.min(offset - 1, childNodes.length - 1); index >= 0; index -= 1) {
      const span = findIndexedSpanWithin(childNodes[index], true)
      if (span) return span
    }
  } else {
    for (let index = Math.max(0, offset); index < childNodes.length; index += 1) {
      const span = findIndexedSpanWithin(childNodes[index], false)
      if (span) return span
    }
  }

  return null
}

function getSpanTextLength(span: HTMLElement) {
  return span.textContent?.length ?? 0
}

function clampTextOffset(offset: number, textLength: number) {
  return Math.max(0, Math.min(offset, textLength))
}

function getBoundaryOffsetWithinSpan(span: HTMLElement, container: Node, offset: number) {
  const textLength = getSpanTextLength(span)
  if (!textLength) return 0
  try {
    const range = document.createRange()
    range.selectNodeContents(span)
    range.setEnd(container, offset)
    return clampTextOffset(range.toString().length, textLength)
  } catch {
    return 0
  }
}

function findTextNodeAtOffset(span: HTMLElement, offset: number) {
  const textWalker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT)
  const targetOffset = clampTextOffset(offset, getSpanTextLength(span))
  let remaining = targetOffset
  let current = textWalker.nextNode() as Text | null
  let lastText: Text | null = null

  while (current) {
    lastText = current
    if (remaining <= current.data.length) return { node: current, offset: remaining }
    remaining -= current.data.length
    current = textWalker.nextNode() as Text | null
  }

  return lastText ? { node: lastText, offset: lastText.data.length } : null
}

function buildRangeForSpanSlice(span: HTMLElement, startOffset: number, endOffset: number) {
  const startPoint = findTextNodeAtOffset(span, startOffset)
  const endPoint = findTextNodeAtOffset(span, endOffset)
  if (!startPoint || !endPoint) return null
  const range = document.createRange()
  range.setStart(startPoint.node, startPoint.offset)
  range.setEnd(endPoint.node, endPoint.offset)
  return range
}

function collectSelectedSpanSlices(
  textLayer: HTMLElement,
  range: Range,
  startBoundary: ResolvedBoundary | null,
  endBoundary: ResolvedBoundary | null
) {
  const startIndex = startBoundary?.index ?? Number.NEGATIVE_INFINITY
  const endIndex = endBoundary?.index ?? Number.POSITIVE_INFINITY
  const lowerBound = Math.min(startIndex, endIndex)
  const upperBound = Math.max(startIndex, endIndex)
  const spans = Array.from(textLayer.querySelectorAll<HTMLElement>('span[data-text-index]'))
  const slices: SelectedSpanSlice[] = []

  for (const span of spans) {
    const index = Number(span.dataset.textIndex)
    if (!Number.isFinite(index) || index < lowerBound || index > upperBound) continue
    if (!range.intersectsNode(span)) continue
    const textLength = getSpanTextLength(span)
    if (!textLength || (span.textContent ?? '').trim().length === 0) continue
    const startOffset = index === startBoundary?.index ? startBoundary.offset : 0
    const endOffset = index === endBoundary?.index ? endBoundary.offset : textLength
    const normalizedStart = Math.max(0, Math.min(startOffset, endOffset))
    const normalizedEnd = Math.min(textLength, Math.max(startOffset, endOffset))
    if (normalizedEnd <= normalizedStart) continue
    slices.push({ span, index, startOffset: normalizedStart, endOffset: normalizedEnd })
  }

  return slices
}

function buildRectsFromSelectedSpanSlices(slices: SelectedSpanSlice[]) {
  const rects: DOMRect[] = []
  for (const slice of slices) {
    const spanRange = buildRangeForSpanSlice(slice.span, slice.startOffset, slice.endOffset)
    if (!spanRange) continue
    rects.push(...Array.from(spanRange.getClientRects()).filter((rect) => rect.width > 0.5 && rect.height > 0.5))
  }
  return dedupeRects(rects)
}

function buildRectsFromIndexedSpans(
  textLayer: HTMLElement,
  startBoundary: ResolvedBoundary | null,
  endBoundary: ResolvedBoundary | null
) {
  if (!startBoundary || !endBoundary) return []
  const startIndex = Math.min(startBoundary.index, endBoundary.index)
  const endIndex = Math.max(startBoundary.index, endBoundary.index)
  const rects: DOMRect[] = []

  for (let index = startIndex; index <= endIndex; index += 1) {
    const span = textLayer.querySelector<HTMLElement>(`span[data-text-index="${index}"]`)
    if (!span) continue
    const textLength = getSpanTextLength(span)
    if (!textLength || (span.textContent ?? '').trim().length === 0) continue
    const startOffset = index === startBoundary.index ? startBoundary.offset : 0
    const endOffset = index === endBoundary.index ? endBoundary.offset : textLength
    if (endOffset <= startOffset) continue
    const spanRange = buildRangeForSpanSlice(span, startOffset, endOffset)
    if (!spanRange) continue
    rects.push(...Array.from(spanRange.getClientRects()).filter((rect) => rect.width > 0.5 && rect.height > 0.5))
  }

  return dedupeRects(rects)
}

function reconstructPdfSelectionText(
  textLayer: HTMLElement | null,
  range: Range,
  startBoundary: ResolvedBoundary | null,
  endBoundary: ResolvedBoundary | null
) {
  if (!textLayer) return ''
  const slices = collectSelectedSpanSlices(textLayer, range, startBoundary, endBoundary)
  const parts = slices
    .map((slice) => {
      const text = (slice.span.textContent ?? '').slice(slice.startOffset, slice.endOffset).replace(/\s+/g, ' ')
      if (!text.trim()) return null
      const rect = slice.span.getBoundingClientRect()
      return {
        text,
        left: Number(slice.span.dataset.pageX ?? rect.left),
        top: Number(slice.span.dataset.pageY ?? rect.top),
        width: Number(slice.span.dataset.pageWidth ?? rect.width),
        height: Number(slice.span.dataset.pageHeight ?? rect.height)
      }
    })
    .filter((part): part is PositionedSelectionText => Boolean(part))
    .sort((left, right) => {
      const rowTolerance = Math.max(3, Math.min(left.height || 12, right.height || 12) * 0.55)
      if (Math.abs(left.top - right.top) > rowTolerance) return left.top - right.top
      return left.left - right.left
    })

  if (parts.length === 0) return ''

  const rows: PositionedSelectionText[][] = []
  for (const part of parts) {
    const lastRow = rows[rows.length - 1]
    const last = lastRow?.[lastRow.length - 1]
    const rowTolerance = Math.max(3, Math.min(part.height || 12, last?.height || part.height || 12) * 0.55)
    if (!lastRow || !last || Math.abs(part.top - last.top) > rowTolerance) {
      rows.push([part])
    } else {
      lastRow.push(part)
    }
  }

  return rows
    .map((row) =>
      row
        .sort((left, right) => left.left - right.left)
        .reduce((text, part, index, entries) => {
          if (index === 0) return part.text.trim()
          const previous = entries[index - 1]
          const gap = part.left - (previous.left + previous.width)
          const needsSpace = gap > Math.max(2, Math.min(part.height || 12, previous.height || 12) * 0.16)
          return `${text}${needsSpace ? ' ' : ''}${part.text.trimStart()}`
        }, '')
        .trim()
    )
    .filter(Boolean)
    .join('\n')
    .trim()
}

function dedupeRects(rects: DOMRect[]) {
  const seen = new Set<string>()
  return rects.filter((rect) => {
    const key = [
      Math.round(rect.left * 100) / 100,
      Math.round(rect.top * 100) / 100,
      Math.round(rect.width * 100) / 100,
      Math.round(rect.height * 100) / 100
    ].join(':')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function mergeNearbyRects(rects: DOMRect[]) {
  if (rects.length === 0) return rects
  const sorted = [...rects].sort((left, right) => (left.top === right.top ? left.left - right.left : left.top - right.top))
  const merged: DOMRect[] = []
  let current = sorted[0]

  for (let index = 1; index < sorted.length; index += 1) {
    const next = sorted[index]
    const currentMidY = (current.top + current.bottom) / 2
    const nextMidY = (next.top + next.bottom) / 2
    const sameLineThreshold = Math.max(2, Math.min(current.height, next.height) * 0.6)
    const sameLine = Math.abs(nextMidY - currentMidY) <= sameLineThreshold
    const gap = next.left - current.right
    const gapThreshold = Math.max(2, current.height * 0.55)

    if (sameLine && gap <= gapThreshold) {
      const left = Math.min(current.left, next.left)
      const top = Math.min(current.top, next.top)
      const right = Math.max(current.right, next.right)
      const bottom = Math.max(current.bottom, next.bottom)
      current = new DOMRect(left, top, right - left, bottom - top)
      continue
    }

    merged.push(current)
    current = next
  }

  merged.push(current)
  return merged
}

function buildUnionRect(rects: DOMRect[]) {
  const boxes = rects.filter((rect) => rect.width > 0 && rect.height > 0)
  if (boxes.length === 0) return null
  const left = Math.min(...boxes.map((rect) => rect.left))
  const top = Math.min(...boxes.map((rect) => rect.top))
  const right = Math.max(...boxes.map((rect) => rect.right))
  const bottom = Math.max(...boxes.map((rect) => rect.bottom))
  return new DOMRect(left, top, right - left, bottom - top)
}

function findAnnotatedPage(target: EventTarget | null) {
  return target instanceof Element ? target.closest<HTMLElement>('.mobile-annotated-page') : null
}

function findSourceAnchorIdFromPointer(clientX: number, clientY: number) {
  if (typeof document === 'undefined') return null
  const elements = document.elementsFromPoint(clientX, clientY)
  for (const element of elements) {
    const anchorElement = element.closest<HTMLElement>('[data-anchor-id]')
    if (anchorElement?.dataset.anchorId && anchorElement.closest('.mobile-annotated-page')) {
      return anchorElement.dataset.anchorId
    }
  }
  return null
}

function resolveSelectionPopupPosition({
  preferredLeft,
  preferredTop,
  popupWidth,
  popupHeight,
  viewportWidth,
  viewportHeight,
  selectionRect
}: {
  preferredLeft: number
  preferredTop: number
  popupWidth: number
  popupHeight: number
  viewportWidth: number
  viewportHeight: number
  selectionRect?: SelectionRect
}) {
  const margin = 12
  const gap = 12
  const left = clampValue(preferredLeft, margin, Math.max(margin, viewportWidth - popupWidth - margin))
  if (!selectionRect) {
    return { left, top: clampValue(preferredTop, margin, Math.max(margin, viewportHeight - popupHeight - margin)) }
  }

  const belowTop = selectionRect.bottom + gap
  const aboveTop = selectionRect.top - popupHeight - gap
  const canPlaceBelow = belowTop + popupHeight <= viewportHeight - margin
  const canPlaceAbove = aboveTop >= margin
  let top = canPlaceBelow ? belowTop : canPlaceAbove ? aboveTop : clampValue(belowTop, margin, Math.max(margin, viewportHeight - popupHeight - margin))

  const overlaps = !(
    left + popupWidth <= selectionRect.left ||
    left >= selectionRect.right ||
    top + popupHeight <= selectionRect.top ||
    top >= selectionRect.bottom
  )

  if (overlaps && canPlaceAbove) top = aboveTop
  else if (overlaps && canPlaceBelow) top = belowTop

  return { left, top: clampValue(top, margin, Math.max(margin, viewportHeight - popupHeight - margin)) }
}

function clampValue(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function findAnnotatedPageFromPointer(event: React.PointerEvent<HTMLElement>) {
  return findAnnotatedPage(event.target) ?? findAnnotatedPage(document.elementFromPoint(event.clientX, event.clientY))
}
