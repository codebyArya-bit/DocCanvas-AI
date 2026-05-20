'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject, type WheelEvent as ReactWheelEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import type { CanvasNode, PageAnchor, TextStyle } from '@workspace/domain'
import bookmarkIcon from './bookmark.png'
import { PdfCanvasPage } from './pdf/PdfCanvasPage'
import { SelectionManager, type SelectionPopupState as PdfSelectionPopupState } from './pdf/SelectionManager'
import { MobileWorkspaceCanvas } from './MobileWorkspaceCanvas'
import { SharedTextboxToolbar } from './SharedTextboxToolbar'
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
  deleteMobileDocuments,
  saveMobileDocument,
  saveMobileWorkspace,
  type FreeformHighlight,
  type InkStroke,
  type MobileDocumentRecord,
  type MobileToolSettings,
  type MobileWebSection,
  type MobileWorkspaceState,
  type NormalizedPoint,
  type SourceTextbox,
  type TagDefinition,
  type ToolMode
} from '../lib/mobile-store'
import { destroyPdfTask, isExpectedPdfCancellation, openPdfDocument, type PdfLoadingTaskLike } from '../lib/pdf-loader'
import { convertClientRectsToPageAnchorGeometry } from '../lib/excerpts/pdf-selection'
import { resolveSelectionPopupPosition, type SelectionPopupPlacement, type SelectionViewportRect } from '../lib/selection-popup-position'
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
  getPageRotation,
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
type PanelMode = 'navigate' | 'share' | 'more' | 'highlight-view' | 'page-edit' | 'documents' | 'bookmarks' | null
type LeftPopupMode = 'highlight-view' | 'documents' | 'bookmarks' | 'share' | 'more' | null

type SelectionRect = SelectionViewportRect

function ModalPortal({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    return () => setMounted(false)
  }, [])

  if (!mounted) return null
  return createPortal(children, document.body)
}

type SelectionPopupState = {
  selection: SelectionArtifactInput
  left: number
  top: number
  selectionRect?: SelectionRect
  color?: string
  tags: string[]
  tagDraft: string
}

type SourceSelectionMagnifierState = {
  left: number
  top: number
  text: string
  selectionColor: string
  width: number
  maxWidth: number
  fontSize: number
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

type GlobalInkSurface =
  | { kind: 'source'; pageNumber: number; element: HTMLElement; point: NormalizedPoint; canvasSize: { width: number; height: number } }
  | { kind: 'source-pane'; point: NormalizedPoint; canvasSize: { width: number; height: number } }
  | { kind: 'workspace'; point: NormalizedPoint }

type GlobalInkDraft = {
  kind: 'freeform-highlight' | 'pen' | 'pencil'
  surface: GlobalInkSurface['kind']
  pageNumber?: number
  points: NormalizedPoint[]
  screenPoints: NormalizedPoint[]
}

const ZOOM_STEP = 0.1
const clampAppZoom = (value: number) => Math.max(0.4, Math.min(1.5, Number(value.toFixed(2))))
const SOURCE_PANE_HORIZONTAL_PADDING = 32
const INK_TOOL_MODES = new Set<ToolMode>(['pen', 'pencil', 'freeform-highlight', 'eraser'])
const INK_COLORS = ['#111111', '#ef4444', '#f97316', '#facc15', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6']
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
  const viewerBodyRef = useRef<HTMLElement | null>(null)
  const sourcePaneRef = useRef<HTMLDivElement | null>(null)
  const activeToolPageRef = useRef<HTMLElement | null>(null)
  const readableSelectingRef = useRef(false)
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
  const draftPathRef = useRef<DraftPath | null>(null)
  const [selectionPopup, setSelectionPopup] = useState<SelectionPopupState | null>(null)
  const [pdfSelectionPopup, setPdfSelectionPopup] = useState<PdfSelectionPopupState | null>(null)
  const [sourceMagnifier, setSourceMagnifier] = useState<SourceSelectionMagnifierState | null>(null)
  const [query, setQuery] = useState('')
  const [pageInput, setPageInput] = useState('')
  const [tagInput, setTagInput] = useState('')
  const [navigateScope, setNavigateScope] = useState<'current-doc' | 'all-docs'>('current-doc')
  const [viewportSize, setViewportSize] = useState({ width: 1280, height: 800 })
  const [sourcePaneWidth, setSourcePaneWidth] = useState(0)
  const [sourceScrollVersion, setSourceScrollVersion] = useState(0)
  const [documentFilter, setDocumentFilter] = useState('')
  const [highlightFilter, setHighlightFilter] = useState('')
  const [openDocumentOptionsId, setOpenDocumentOptionsId] = useState<string | null>(null)

  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false)
  const toggleLeftPanel = () => setLeftPanelCollapsed(prev => !prev)

  const [documentPopupAnchor, setDocumentPopupAnchor] = useState<HTMLElement | null>(null)
  const [documentPopupTab, setDocumentPopupTab] = useState<'documents' | 'outline'>('documents')
  const [workspaceSwitcherOpen, setWorkspaceSwitcherOpen] = useState(false)
  const [newWorkspaceName, setNewWorkspaceName] = useState('')

  const sourceKind = record ? getDocumentSourceKind(record) : 'pdf'
  const viewerState = workspace && record ? getDocumentViewerState(workspace, record.document.id) : { viewerZoom: 1, sourceZoom: 1, workspaceZoom: 1, scrollPosition: 0, activePage: 1 }
  const toolMode = workspace?.toolMode ?? 'select'
  const toolSettings = workspace?.toolSettings
  const semanticSearchIndex = useMemo(() => buildSemanticSearchIndex(record, workspace), [record, workspace])
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
  const pageEditDeletedPages = useMemo(() => {
    if (!record || !workspace) return new Set<number>()
    return new Set(
      (workspace.pageEdits ?? [])
        .filter((edit) => edit.documentId === record.document.id && edit.action === 'delete')
        .map((edit) => edit.pageNumber)
    )
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
    // basePdfPageWidth is measured at scale 1.25, so the unscaled page width = basePdfPageWidth / 1.25.
    // Ensure viewport width (unscaledWidth * sourceZoom * sourceFitScale) never exceeds availableWidth,
    // preventing CSS max-width:100% from creating a mismatch between viewport and visual space.
    const maxFitScale = (availableWidth * 1.25) / (basePdfPageWidth * (viewerState.sourceZoom || 0.4))
    return Math.min(1, maxFitScale)
  }, [basePdfPageWidth, sourcePaneWidth, viewerState.sourceZoom])
  const effectiveSourceZoom = viewerState.sourceZoom * sourceFitScale
  const currentDocumentMarks = useMemo(() => {
    if (!workspace || !record) return []
    return workspace.anchors
      .filter((anchor) => anchor.documentId === record.document.id && Boolean(anchor.selectionColor || anchor.tags?.length || anchor.textQuote))
      .sort((left, right) => left.pageNumber - right.pageNumber)
  }, [record, workspace])
  const filteredDocuments = useMemo(() => {
    const queryText = documentFilter.trim().toLowerCase()
    if (!queryText) return documents
    return documents.filter((entry) => entry.document.title.toLowerCase().includes(queryText))
  }, [documentFilter, documents])
  const filteredHighlights = useMemo(() => {
    const queryText = highlightFilter.trim().toLowerCase()
    if (!queryText) return currentDocumentMarks
    return currentDocumentMarks.filter((anchor) => `${anchor.textQuote} ${(anchor.tags ?? []).join(' ')}`.toLowerCase().includes(queryText))
  }, [currentDocumentMarks, highlightFilter])

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

  const updateDraftPath = useCallback((next: DraftPath | null | ((current: DraftPath | null) => DraftPath | null)) => {
    const resolved = typeof next === 'function' ? next(draftPathRef.current) : next
    draftPathRef.current = resolved
    setDraftPath(resolved)
  }, [])

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

        const baseWorkspace = {
          ...loadedWorkspace,
          activeDocumentId: loadedRecord.document.id
        }
        const normalizedWorkspace = ensureWorkspaceBoards(baseWorkspace, loadedRecord.document.id)
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
      workspaceBoardId: workspace.activeWorkspaceBoardId ?? 'default-board',
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
    const existingAnchor = findExistingAnchorForSelection(selection)
    const existingTags = existingAnchor?.tags ?? []
    const rect = window.getSelection()?.rangeCount ? window.getSelection()?.getRangeAt(0).getBoundingClientRect() : null
    setSelectionPopup({
      selection: { ...selection, selectionColor: existingAnchor?.selectionColor ?? workspace.toolSettings.highlight.color, tags: existingTags },
      left: Math.max(12, Math.min(window.innerWidth - 320, rect ? rect.left : 80)),
      top: rect ? rect.bottom + 12 : 120,
      selectionRect: rect
        ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height }
        : undefined,
      color: existingAnchor?.selectionColor ?? workspace.toolSettings.highlight.color,
      tags: existingTags,
      tagDraft: existingTags.join(', ')
    })
  }

  function findExistingAnchorForSelection(selection: SelectionArtifactInput) {
    if (!workspace) return null
    return workspace.anchors.find((anchor) => {
      if (anchor.documentId !== selection.documentId || anchor.pageNumber !== selection.pageNumber) return false
      const sameText = anchor.textQuote.trim().toLowerCase() === selection.text.trim().toLowerCase()
      const sameSpan =
        anchor.startSpanIndex === selection.startSpanIndex &&
        anchor.endSpanIndex === selection.endSpanIndex &&
        anchor.startOffset === selection.startOffset &&
        anchor.endOffset === selection.endOffset
      return sameText || sameSpan
    }) ?? null
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
    const selection = { ...popup.selection, workspaceBoardId: workspace.activeWorkspaceBoardId ?? 'default-board', selectionColor: popup.color ?? '#5d5df6', tags: popup.tags }

    const viewportRatio = popup.top / Math.max(1, window.innerHeight)
    commitSourceWorkspace((current) => applyExcerptSelection(current, { ...selection, workspaceBoardId: workspace.activeWorkspaceBoardId ?? 'default-board' }, viewportRatio))
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
    const selection = { ...popup.selection, workspaceBoardId: workspace.activeWorkspaceBoardId ?? 'default-board', selectionColor: popup.color ?? '#5d5df6', tags: popup.tags }
    const viewportRatio = popup.top / Math.max(1, window.innerHeight)

    commitSourceWorkspace((current) => applyCommentSelection(current, { ...selection, workspaceBoardId: workspace.activeWorkspaceBoardId ?? 'default-board' }, viewportRatio))
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
    const anchor = buildPageAnchor(selection)
    commitSourceWorkspace((current) => {
      const alreadyBookmarked = current.bookmarks.some(
        (bookmark) => bookmark.documentId === selection.documentId && bookmark.sourceAnchorId === anchor.id
      )
      if (!alreadyBookmarked) return applyBookmarkSelection(current, selection)
      return {
        ...current,
        bookmarks: current.bookmarks.filter(
          (bookmark) => !(bookmark.documentId === selection.documentId && bookmark.sourceAnchorId === anchor.id)
        ),
        activeAnchorId: current.activeAnchorId === anchor.id ? null : current.activeAnchorId,
        updatedAt: new Date().toISOString()
      }
    })
    setSelectionPopup(null)
  }

  function bookmarkPdfSelection(selection: SelectionArtifactInput) {
    if (!workspace) return
    const anchor = buildPageAnchor(selection)
    commitSourceWorkspace((current) => {
      const alreadyBookmarked = current.bookmarks.some(
        (bookmark) => bookmark.documentId === selection.documentId && bookmark.sourceAnchorId === anchor.id
      )
      if (!alreadyBookmarked) return applyBookmarkSelection(current, selection)
      return {
        ...current,
        bookmarks: current.bookmarks.filter(
          (bookmark) => !(bookmark.documentId === selection.documentId && bookmark.sourceAnchorId === anchor.id)
        ),
        activeAnchorId: current.activeAnchorId === anchor.id ? null : current.activeAnchorId,
        updatedAt: new Date().toISOString()
      }
    })
    setPdfSelectionPopup(null)
  }

  function tagSelection(popup: SelectionPopupState, tags: string[]) {
    const existingAnchor = findExistingAnchorForSelection(popup.selection)
    const preservedColor = existingAnchor?.selectionColor
    const selection = { ...popup.selection, selectionColor: preservedColor ?? '', tags }
    commitSourceWorkspace((current) => applyTagSelection(current, selection, tags))
    setSelectionPopup({ ...popup, selection, tags, tagDraft: tags.join(', ') })
  }

  function tagPdfSelection(selection: SelectionArtifactInput, tags: string[]) {
    const existingAnchor = findExistingAnchorForSelection(selection)
    const selectionWithoutForcedHighlight = {
      ...selection,
      selectionColor: existingAnchor?.selectionColor ?? '',
      tags
    }
    commitSourceWorkspace((current) => applyTagSelection(current, selectionWithoutForcedHighlight, tags))
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
      tags: anchor.tags ?? [],
      tagDraft: (anchor.tags ?? []).join(', ')
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
    const activeBoardId = workspace.activeWorkspaceBoardId ?? 'default-board'
    const node = {
      ...buildFreeNode({ kind, workspace, documentId: record.document.id }),
      workspaceBoardId: activeBoardId
    }
    updateWorkspace((current) => ({
      ...current,
      nodes: [...current.nodes, node],
      activeNodeId: node.id,
      updatedAt: node.updatedAt
    }))
  }

  function ensureWorkspaceBoards(current: MobileWorkspaceState, documentId: string) {
    const now = new Date().toISOString()
    const existing = current.workspaceBoards ?? []
    if (existing.length > 0) return current

    const defaultBoard = {
      id: 'default-board',
      documentId,
      name: 'Workspace 1',
      createdAt: now,
      updatedAt: now
    }

    return {
      ...current,
      workspaceBoards: [defaultBoard],
      activeWorkspaceBoardId: defaultBoard.id,
      updatedAt: now
    }
  }

  function createWorkspaceBoard() {
    if (!record) return
    const name = newWorkspaceName.trim()
    if (!name) return

    const now = new Date().toISOString()
    const board = {
      id: `workspace-board-${crypto.randomUUID()}`,
      documentId: record.document.id,
      name,
      createdAt: now,
      updatedAt: now
    }

    updateWorkspace((current) => {
      const normalized = ensureWorkspaceBoards(current, record.document.id)
      return {
        ...normalized,
        workspaceBoards: [...(normalized.workspaceBoards ?? []), board],
        activeWorkspaceBoardId: board.id,
        activeNodeId: null,
        updatedAt: now
      }
    })
    setNewWorkspaceName('')
  }

  function switchWorkspaceBoard(boardId: string) {
    updateWorkspace((current) => ({
      ...current,
      activeWorkspaceBoardId: boardId,
      activeNodeId: null,
      activeAnchorId: null,
      updatedAt: new Date().toISOString()
    }))
  }

  function clearWorkspaceInk() {
    if (!record) return
    updateWorkspace((current) => ({
      ...current,
      freeformHighlights: (current.freeformHighlights ?? []).filter(
        (entry) => !(entry.documentId === record.document.id && entry.surface === 'workspace')
      ),
      inkStrokes: (current.inkStrokes ?? []).filter(
        (entry) => !(entry.documentId === record.document.id && entry.surface === 'workspace')
      ),
      updatedAt: new Date().toISOString()
    }))
  }

  function setToolMode(mode: ToolMode) {
    readableSelectingRef.current = false
    document.body.classList.remove('is-selecting-pdf-text')
    setSourceMagnifier(null)
    updateWorkspace((current) => dispatchInteractionAction(current, { type: 'SET_TOOL_MODE', mode }))
  }

  function updateToolSettings(nextSettings: MobileToolSettings) {
    updateWorkspace((current) => ({
      ...current,
      toolSettings: nextSettings,
      updatedAt: new Date().toISOString()
    }))
  }

  function clearCurrentPageInk() {
    if (!record || !workspace) return
    const pageNumber = viewerState.activePage
    const pageHighlights = (workspace.freeformHighlights ?? []).filter((entry) => entry.surface !== 'workspace' && entry.surface !== 'source-pane' && entry.documentId === record.document.id && (entry.pageNumber ?? 1) === pageNumber)
    const pageInk = (workspace.inkStrokes ?? []).filter((entry) => entry.surface !== 'workspace' && entry.surface !== 'source-pane' && entry.documentId === record.document.id && (entry.pageNumber ?? 1) === pageNumber)
    const clearCount = pageHighlights.length + pageInk.length
    if (clearCount === 0) return
    if (!window.confirm(`Clear ${clearCount} ink mark${clearCount === 1 ? '' : 's'} from page ${pageNumber}?`)) return
    updateWorkspace((current) =>
      dispatchInteractionAction(current, {
        type: 'CLEAR_PAGE_INK',
        payload: {
          documentId: record.document.id,
          pageNumber
        }
      })
    )
  }

  function startInkDraft(kind: DraftPath['kind'], pageNumber: number, point: NormalizedPoint) {
    updateDraftPath({ kind, pageNumber, points: [point] })
  }

  function moveInkDraft(pageNumber: number, point: NormalizedPoint) {
    const current = draftPathRef.current
    if (!current || current.pageNumber !== pageNumber) return
    draftPathRef.current = { ...current, points: [...current.points, point] }
  }

  function commitInkDraft() {
    const currentDraftPath = draftPathRef.current
    if (!currentDraftPath || !record || !toolSettings) {
      updateDraftPath(null)
      return
    }
    const points = currentDraftPath.kind === 'freeform-highlight' && toolSettings.highlight.smoothed ? simplifyPath(currentDraftPath.points) : currentDraftPath.points
    if (points.length < 2) {
      updateDraftPath(null)
      activeToolPageRef.current = null
      return
    }
    if (currentDraftPath.kind === 'freeform-highlight') {
      const payload: FreeformHighlight = {
        id: crypto.randomUUID(),
        documentId: record.document.id,
        surface: 'source',
        pageNumber: currentDraftPath.pageNumber,
        points,
        color: toolSettings.highlight.color,
        size: toolSettings.highlight.size,
        opacity: toolSettings.highlight.opacity,
        smoothed: toolSettings.highlight.smoothed
      }
      updateWorkspace((current) => dispatchInteractionAction(current, { type: 'ADD_FREEFORM_HIGHLIGHT', payload }))
    } else {
      const isPencil = currentDraftPath.kind === 'pencil'
      const payload: InkStroke = {
        id: crypto.randomUUID(),
        documentId: record.document.id,
        surface: 'source',
        pageNumber: currentDraftPath.pageNumber,
        tool: isPencil ? 'pencil' : 'pen',
        points,
        color: isPencil ? toolSettings.pencil.color : toolSettings.pen.color,
        size: isPencil ? toolSettings.pencil.size : toolSettings.pen.size,
        opacity: isPencil ? toolSettings.pencil.opacity : undefined
      }
      updateWorkspace((current) => dispatchInteractionAction(current, { type: 'ADD_INK_STROKE', payload }))
    }
    updateDraftPath(null)
    activeToolPageRef.current = null
  }

  function eraseInkAtPoint(pageNumber: number, point: NormalizedPoint, clientX: number, clientY: number, canvasSize?: { width: number; height: number }) {
    if (!record || !toolSettings) return
    const anchorId = findSourceAnchorIdFromPointer(clientX, clientY)
    updateWorkspace((current) =>
      dispatchInteractionAction(current, {
        type: 'ERASE_AT_POINT',
        payload: { documentId: record.document.id, pageNumber, point, size: toolSettings.eraser.size, anchorId, canvasSize }
      })
    )
  }

  function routeGlobalInkPoint(
    clientX: number,
    clientY: number,
    activeSurface?: 'workspace' | 'source'
  ): GlobalInkSurface | null {
    if (!record || !workspace) return null

    if (activeSurface === 'workspace') {
      return routeWorkspaceInkPoint(clientX, clientY)
    }

    if (activeSurface === 'source') {
      return routeSourceInkPoint(clientX, clientY)
    }

    return routeSourceInkPoint(clientX, clientY) ?? routeWorkspaceInkPoint(clientX, clientY)
  }

  function routeWorkspaceInkPoint(clientX: number, clientY: number): GlobalInkSurface | null {
    if (!workspace) return null

    const workspaceCanvas = document.querySelector<HTMLElement>('.mobile-workspace-canvas')
    const workspaceRect = workspaceCanvas?.getBoundingClientRect()
    if (!workspaceRect) return null

    if (
      clientX < workspaceRect.left ||
      clientX > workspaceRect.right ||
      clientY < workspaceRect.top ||
      clientY > workspaceRect.bottom
    ) {
      return null
    }

    const appZoom = 1
    return {
      kind: 'workspace',
      point: {
        x: ((clientX - workspaceRect.left) / appZoom - (workspace.workspaceViewport.panX ?? 0)) / viewerState.workspaceZoom,
        y: ((clientY - workspaceRect.top) / appZoom - (workspace.workspaceViewport.panY ?? 0)) / viewerState.workspaceZoom
      }
    }
  }

  function routeSourceInkPoint(clientX: number, clientY: number): GlobalInkSurface | null {
    const elements = document.elementsFromPoint(clientX, clientY)

    const pageElement = elements.find(
      (element) =>
        element instanceof HTMLElement &&
        element.classList.contains('mobile-annotated-page')
    ) as HTMLElement | undefined

    if (pageElement) {
      const sourceBounds = getSourcePageInkBounds(pageElement)
      return {
        kind: 'source',
        pageNumber: Number(pageElement.dataset.pageNumber ?? 1),
        element: pageElement,
        point: normalizePointInSourceInkBounds(clientX, clientY, pageElement),
        canvasSize: { width: sourceBounds.width, height: sourceBounds.height }
      }
    }

    const sourcePane = sourcePaneRef.current
    const sourceRect = sourcePane?.getBoundingClientRect()

    if (
      sourceRect &&
      clientX >= sourceRect.left &&
      clientX <= sourceRect.right &&
      clientY >= sourceRect.top &&
      clientY <= sourceRect.bottom
    ) {
      return {
        kind: 'source-pane',
        point: {
          x: Math.max(0, Math.min(1, (clientX - sourceRect.left) / Math.max(1, sourceRect.width))),
          y: Math.max(0, Math.min(1, (clientY - sourceRect.top) / Math.max(1, sourceRect.height)))
        },
        canvasSize: { width: sourceRect.width, height: sourceRect.height }
      }
    }

    return null
  }

  function eraseGlobalInkAt(route: GlobalInkSurface, clientX: number, clientY: number) {
    if (!record || !toolSettings) return
    if (route.kind === 'source') {
      eraseInkAtPoint(route.pageNumber, route.point, clientX, clientY, route.canvasSize)
      return
    }
    const appZoom = Math.max(viewerState.viewerZoom || 1, 0.1)
    updateWorkspace((current) =>
      dispatchInteractionAction(current, {
        type: 'ERASE_SURFACE_INK_AT_POINT',
        payload: {
          documentId: record.document.id,
          surface: route.kind,
          point: route.point,
          size: route.kind === 'workspace' ? toolSettings.eraser.size / (appZoom * Math.max(viewerState.workspaceZoom, 0.3)) : toolSettings.eraser.size,
          canvasSize: route.kind === 'source-pane' ? route.canvasSize : undefined
        }
      })
    )
  }

  function scrollGlobalInkSurface(event: ReactWheelEvent<HTMLCanvasElement>) {
    if (!workspace) return
    const route = routeGlobalInkPoint(event.clientX, event.clientY)
    if (!route) return
    event.preventDefault()
    event.stopPropagation()

    if (route.kind === 'source' || route.kind === 'source-pane') {
      sourcePaneRef.current?.scrollBy({ left: event.deltaX, top: event.deltaY, behavior: 'auto' })
      return
    }

    const direction = workspace.reverseScrollDirection ? -1 : 1
    if (event.ctrlKey || event.metaKey || (workspace.scrollWheelBehavior ?? 'zoom') === 'zoom') {
      const nextZoom = Math.max(0.3, Math.min(3, Number((viewerState.workspaceZoom * Math.exp(-event.deltaY * direction * 0.001)).toFixed(2))))
      updateWorkspace((current) => ({
        ...current,
        viewerStateByDocument: record ? {
          ...current.viewerStateByDocument,
          [record.document.id]: {
            ...getDocumentViewerState(current, record.document.id),
            workspaceZoom: nextZoom
          }
        } : current.viewerStateByDocument,
        updatedAt: new Date().toISOString()
      }))
      return
    }

    updateWorkspace((current) => ({
      ...current,
      workspaceViewport: {
        ...current.workspaceViewport,
        panX: (current.workspaceViewport.panX ?? 0) - event.deltaX * direction,
        panY: (current.workspaceViewport.panY ?? 0) - event.deltaY * direction
      },
      updatedAt: new Date().toISOString()
    }))
  }

  function commitGlobalInkDraft(draft: GlobalInkDraft) {
    if (!record || !toolSettings || draft.points.length < 2) return
    const points = draft.kind === 'freeform-highlight' && toolSettings.highlight.smoothed ? simplifyPath(draft.points) : draft.points
    if (points.length < 2) return

    if (draft.kind === 'freeform-highlight') {
      const payload: FreeformHighlight = {
        id: crypto.randomUUID(),
        documentId: record.document.id,
        surface: draft.surface,
        pageNumber: draft.surface === 'source' ? draft.pageNumber : undefined,
        points,
        color: toolSettings.highlight.color,
        size: toolSettings.highlight.size,
        opacity: toolSettings.highlight.opacity,
        smoothed: toolSettings.highlight.smoothed
      }
      updateWorkspace((current) => dispatchInteractionAction(current, { type: 'ADD_FREEFORM_HIGHLIGHT', payload }))
      return
    }

    const isPencil = draft.kind === 'pencil'
    const payload: InkStroke = {
      id: crypto.randomUUID(),
      documentId: record.document.id,
      surface: draft.surface,
      pageNumber: draft.surface === 'source' ? draft.pageNumber : undefined,
      tool: isPencil ? 'pencil' : 'pen',
      points,
      color: isPencil ? toolSettings.pencil.color : toolSettings.pen.color,
      size: isPencil ? toolSettings.pencil.size : toolSettings.pen.size,
      opacity: isPencil ? toolSettings.pencil.opacity : undefined
    }
    updateWorkspace((current) => dispatchInteractionAction(current, { type: 'ADD_INK_STROKE', payload }))
  }

  function handlePointerDown(event: React.PointerEvent<HTMLElement>) {
    if (!workspace || !record || !toolSettings) return
    if (event.target instanceof Element && event.target.closest('.mobile-source-textbox-shell')) {
      return
    }
    if (toolMode === 'select') {
      setSelectionPopup(null)
      setSourceMagnifier(null)
      const target = event.target instanceof Element ? event.target : null
      const canTrackReadableSelection = sourceKind === 'web-clean' && Boolean(target?.closest('.mobile-readable-page'))
      readableSelectingRef.current = canTrackReadableSelection
      document.body.classList.toggle('is-selecting-pdf-text', canTrackReadableSelection)
      return
    }
    if (INK_TOOL_MODES.has(toolMode)) return
    if (toolMode !== 'textbox') return
    const pageElement = findAnnotatedPageFromPointer(event)
    if (!pageElement) return
    event.preventDefault()
    activeToolPageRef.current = pageElement
    const point = normalizePointer(event.clientX, event.clientY, pageElement)
    const pageNumber = Number(pageElement.dataset.pageNumber ?? 1)

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
    setToolMode('select')
    void now
  }

  function handlePointerMove(event: React.PointerEvent<HTMLElement>) {
    if (!draftPath && toolMode === 'select' && sourceKind === 'web-clean' && event.buttons === 1) {
      if (readableSelectingRef.current) {
        updateReadableSelectionMagnifier(sourcePaneRef.current, toolSettings?.highlight.color ?? '#5d5df6', setSourceMagnifier)
      }
      return
    }
    if (!draftPath) return
  }

  function handlePointerUp(event: React.PointerEvent<HTMLElement>) {
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    if (!draftPath) {
      if (sourceKind === 'web-clean') {
        readableSelectingRef.current = false
        document.body.classList.remove('is-selecting-pdf-text')
        setSourceMagnifier(null)
        window.setTimeout(captureSourceSelection, 0)
      }
      return
    }
    commitInkDraft()
  }

  useEffect(() => {
    if (sourceKind !== 'web-clean') return

    const handleSelectionChange = () => {
      if (!readableSelectingRef.current) return
      updateReadableSelectionMagnifier(sourcePaneRef.current, toolSettings?.highlight.color ?? '#5d5df6', setSourceMagnifier)
    }

    document.addEventListener('selectionchange', handleSelectionChange)
    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange)
      readableSelectingRef.current = false
      document.body.classList.remove('is-selecting-pdf-text')
    }
  }, [sourceKind, toolSettings?.highlight.color])

  function closeLeftPopup() {
    setLeftPopup(null)
    setOpenDocumentOptionsId(null)
  }

  function openLeftPopup(mode: Exclude<LeftPopupMode, null>) {
    setPanelMode(null)
    setLeftPopup((current) => (current === mode ? null : mode))
    setOpenDocumentOptionsId(null)
  }

  async function refreshDocuments() {
    setDocuments(await listMobileDocuments())
  }

  async function renameDocument(documentRecord: MobileDocumentRecord) {
    const nextTitle = window.prompt('Rename document', documentRecord.document.title)?.trim()
    if (!nextTitle || nextTitle === documentRecord.document.title) return
    const updatedRecord = {
      ...documentRecord,
      document: { ...documentRecord.document, title: nextTitle, updatedAt: new Date().toISOString() }
    }
    await saveMobileDocument(updatedRecord)
    if (record?.document.id === updatedRecord.document.id) {
      setRecord(updatedRecord)
      setStatus(`${nextTitle} renamed.`)
    }
    await refreshDocuments()
  }

  async function deleteDocument(documentRecord: MobileDocumentRecord) {
    if (!window.confirm(`Delete "${documentRecord.document.title}" from this device?`)) return
    await deleteMobileDocuments([documentRecord.document.id])
    await refreshDocuments()
    if (record?.document.id === documentRecord.document.id) router.push('/')
  }

  function copyText(value: string, label: string) {
    void navigator.clipboard?.writeText(value).then(() => setStatus(`${label} copied.`)).catch(() => setStatus(`Could not copy ${label.toLowerCase()}.`))
  }

  function extractPage(pageNumber: number) {
    if (!record) return
    const payload = {
      documentId: record.document.id,
      title: record.document.title,
      extractedPages: [pageNumber]
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${record.document.title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'document'}-page-${pageNumber}.json`
    link.click()
    URL.revokeObjectURL(url)
    setStatus(`Page ${pageNumber} extracted.`)
  }

  function insertPageAfter(pageNumber: number) {
    if (!record) return
    const now = new Date().toISOString()
    updateWorkspace((current) => ({
      ...current,
      pageEdits: [
        ...(current.pageEdits ?? []),
        { id: crypto.randomUUID(), documentId: record.document.id, pageNumber: pageNumber + 1, action: 'insert' }
      ],
      updatedAt: now
    }))
    setStatus(`Insert page queued after page ${pageNumber}.`)
  }

  function deletePage(pageNumber: number) {
    if (!record) return
    const now = new Date().toISOString()
    updateWorkspace((current) => ({
      ...current,
      pageEdits: [
        ...(current.pageEdits ?? []).filter((edit) => !(edit.documentId === record.document.id && edit.pageNumber === pageNumber && edit.action === 'delete')),
        { id: crypto.randomUUID(), documentId: record.document.id, pageNumber, action: 'delete' }
      ],
      updatedAt: now
    }))
    setStatus(`Page ${pageNumber} marked deleted.`)
  }

  function updateTextbox(textbox: SourceTextbox) {
    updateWorkspace((current) => dispatchInteractionAction(current, { type: 'UPDATE_SOURCE_TEXTBOX', payload: textbox }))
  }

  function deleteTextbox(textboxId: string) {
    updateWorkspace((current) => ({
      ...current,
      sourceTextboxes: (current.sourceTextboxes ?? []).filter((textbox) => textbox.id !== textboxId),
      updatedAt: new Date().toISOString()
    }))
  }

  function deleteWorkspaceNode(nodeId: string) {
    updateWorkspace((current) => {
      const deletingNode = current.nodes.find((node) => node.id === nodeId)
      const remainingNodes = current.nodes.filter((node) => node.id !== nodeId)
      const sourceAnchorId = deletingNode?.sourceAnchorId
      const shouldRemoveAnchor = Boolean(
        sourceAnchorId &&
        !remainingNodes.some((node) => node.sourceAnchorId === sourceAnchorId)
      )
      return {
        ...current,
        nodes: remainingNodes,
        excerpts: shouldRemoveAnchor ? current.excerpts.filter((excerpt) => excerpt.anchorId !== sourceAnchorId) : current.excerpts,
        anchors: shouldRemoveAnchor ? current.anchors.filter((anchor) => anchor.id !== sourceAnchorId) : current.anchors,
        bookmarks: shouldRemoveAnchor ? current.bookmarks.filter((bookmark) => bookmark.sourceAnchorId !== sourceAnchorId) : current.bookmarks,
        workspaceLinks: current.workspaceLinks.filter((link) => link.fromNodeId !== nodeId && link.toNodeId !== nodeId),
        canvasEdges: current.canvasEdges.filter(
          (edge) => edge.targetNodeId !== nodeId && (!shouldRemoveAnchor || edge.sourceAnchorId !== sourceAnchorId)
        ),
        activeAnchorId: shouldRemoveAnchor && current.activeAnchorId === sourceAnchorId ? null : current.activeAnchorId,
        activeNodeId: current.activeNodeId === nodeId ? null : current.activeNodeId,
        updatedAt: new Date().toISOString()
      }
    })
  }

  function changeSplit(clientX: number, clientY?: number) {
    const body = document.querySelector<HTMLElement>('.mobile-viewer-body')
    if (!body || !workspace) return
    const rect = body.getBoundingClientRect()
    const arrangement = workspace.workspaceArrangement ?? 'automatic'
    const resolvedArrangement =
      arrangement === 'automatic'
        ? viewportSize.width < 900 || viewportSize.height < 620
          ? 'vertical'
          : 'horizontal'
        : arrangement
    const rawRatio =
      resolvedArrangement === 'vertical'
        ? ((clientY ?? rect.top + rect.height * 0.54) - rect.top) / Math.max(1, rect.height)
        : (clientX - rect.left) / Math.max(1, rect.width)
    pendingSplitRef.current = clampSplitRatio(rawRatio)
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
  const leftHandLayout = workspace?.viewerLayout.leftHandLayout ?? false
  const effectiveSplitRatio = leftHandLayout ? 1 - splitRatio : splitRatio
  const workspaceArrangement = workspace?.workspaceArrangement ?? 'automatic'
  const resolvedWorkspaceArrangement =
    workspaceArrangement === 'automatic'
      ? viewportSize.width < 900 || viewportSize.height < 620
        ? 'vertical'
        : 'horizontal'
      : workspaceArrangement
  const gridTemplateColumns = viewerGridTemplateColumns(effectiveSplitRatio, layoutMode)
  const viewerBodyClassName = [
    'mobile-viewer-body',
    leftHandLayout ? 'is-left-hand-layout' : '',
    resolvedWorkspaceArrangement === 'vertical' ? 'is-workspace-below' : 'is-workspace-beside'
  ].filter(Boolean).join(' ')
  const viewerBodyStyle =
    resolvedWorkspaceArrangement === 'vertical' && layoutMode !== 'mobile'
      ? {
          gridTemplateColumns: layoutMode === 'compact' ? '96px minmax(0, 1fr)' : '112px minmax(0, 1fr)',
          gridTemplateRows: 'minmax(280px, 0.95fr) 10px minmax(280px, 1fr)'
        }
      : { gridTemplateColumns }
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
  const commandInkSettings = toolSettings && INK_TOOL_MODES.has(toolMode)
    ? toolMode === 'pen'
      ? toolSettings.pen
      : toolMode === 'pencil'
        ? toolSettings.pencil
        : toolMode === 'freeform-highlight'
          ? toolSettings.highlight
          : toolSettings.eraser
    : null
  const commandInkColor = toolSettings
    ? toolMode === 'pen'
      ? toolSettings.pen.color
      : toolMode === 'pencil'
        ? toolSettings.pencil.color
        : toolMode === 'freeform-highlight'
          ? toolSettings.highlight.color
          : ''
    : ''
  const commandInkSize = commandInkSettings?.size ?? 4
  const commandInkSizeMax = toolMode === 'freeform-highlight' ? 42 : toolMode === 'eraser' ? 72 : 24
  const commandInkSizeMin = toolMode === 'eraser' ? 12 : 1

  function updateCommandInkColor(color: string) {
    if (!toolSettings || toolMode === 'eraser') return
    if (toolMode === 'freeform-highlight') {
      updateToolSettings({ ...toolSettings, highlight: { ...toolSettings.highlight, color } })
      return
    }
    if (toolMode === 'pencil') {
      updateToolSettings({ ...toolSettings, pencil: { ...toolSettings.pencil, color } })
      return
    }
    updateToolSettings({ ...toolSettings, pen: { ...toolSettings.pen, color } })
  }

  function updateCommandInkSize(size: number) {
    if (!toolSettings || !commandInkSettings) return
    if (toolMode === 'freeform-highlight') {
      updateToolSettings({ ...toolSettings, highlight: { ...toolSettings.highlight, size } })
      return
    }
    if (toolMode === 'eraser') {
      updateToolSettings({ ...toolSettings, eraser: { ...toolSettings.eraser, size } })
      return
    }
    if (toolMode === 'pencil') {
      updateToolSettings({ ...toolSettings, pencil: { ...toolSettings.pencil, size } })
      return
    }
    updateToolSettings({ ...toolSettings, pen: { ...toolSettings.pen, size } })
  }

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
    <div className="mobile-viewer-zoom-frame" style={{ overflowX: 'hidden', overflowY: 'auto' }}>
    <main
      className={`mobile-viewer mobile-viewer-${layoutMode}`}
      data-layout-mode={layoutMode}
      style={{
        width: `calc(100dvw / ${viewerState.viewerZoom})`,
        height: `calc(100dvh / ${viewerState.viewerZoom})`,
        maxWidth: '100%',
        transform: `scale(${viewerState.viewerZoom})`,
        transformOrigin: 'top left'
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
          <div className="mobile-command-tool-selector" role="group" aria-label="Drawing tools">
            {SOURCE_TOOLS.filter((tool) => tool.mode !== 'textbox').map((tool) => (
              <button
                key={tool.mode}
                className={toolMode === tool.mode ? 'mobile-command-tool is-active' : 'mobile-command-tool'}
                type="button"
                aria-label={tool.label}
                title={tool.label}
                onClick={() => {
                  setToolMode(tool.mode)
                  if (tool.mode === 'select') setPanelMode(null)
                }}
              >
                <Icon name={tool.icon} />
              </button>
            ))}
          </div>
          {commandInkSettings ? (
            <div className="mobile-command-ink-settings" aria-label="Ink settings">
              {toolMode !== 'eraser' ? (
                <div className="mobile-command-ink-colors" aria-label="Ink colors">
                  {INK_COLORS.map((color) => (
                    <button
                      key={color}
                      className={commandInkColor.toLowerCase() === color.toLowerCase() ? 'is-active' : ''}
                      type="button"
                      aria-label={`Color ${color}`}
                      title={color}
                      onClick={() => updateCommandInkColor(color)}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              ) : null}
              <label className="mobile-command-ink-size">
                <span>{commandInkSize}px</span>
                <input
                  type="range"
                  min={commandInkSizeMin}
                  max={commandInkSizeMax}
                  value={commandInkSize}
                  aria-label="Ink size"
                  onChange={(event) => updateCommandInkSize(Number(event.target.value))}
                />
              </label>
            </div>
          ) : null}
          <button className="mobile-tool-button" type="button" aria-label="Zoom out whole page" title="Zoom out whole page" onClick={() => setViewerZoom(viewerState.viewerZoom - ZOOM_STEP)}>-</button>
          <button className="mobile-tool-button mobile-zoom-readout" type="button" aria-label="Reset whole page zoom" title="Reset whole page zoom" onClick={() => setViewerZoom(1)}>{Math.round(viewerState.viewerZoom * 100)}%</button>
          <button className="mobile-tool-button" type="button" aria-label="Zoom in whole page" title="Zoom in whole page" onClick={() => setViewerZoom(viewerState.viewerZoom + ZOOM_STEP)}>+</button>
          <button className="mobile-tool-button" type="button" onClick={() => { setLeftPopup(null); setPanelMode('navigate') }}>Navigate</button>
        </div>
        <div className="mobile-viewer-command-group">
          <button className={leftPopup === 'share' ? 'mobile-primary-button mobile-share-button is-active' : 'mobile-primary-button mobile-share-button'} type="button" onClick={() => openLeftPopup('share')}>Share</button>
          <button className={panelMode === 'more' ? 'mobile-tool-button is-active' : 'mobile-tool-button'} type="button" onClick={() => { closeLeftPopup(); setPanelMode(panelMode === 'more' ? null : 'more') }}>
            <Icon name="more" /> More
          </button>
        </div>
      </nav>

      <div className="mobile-pane-tabs" role="tablist" aria-label="Viewer panes">
        <button className={paneMode === 'source' ? 'is-active' : ''} type="button" onClick={() => { setPaneMode('source'); updateWorkspace((current) => ({ ...current, activeNodeId: null, updatedAt: new Date().toISOString() })); }}>Source</button>
        <button className={paneMode === 'workspace' ? 'is-active' : ''} type="button" onClick={() => setPaneMode('workspace')}>Workspace</button>
      </div>
      <div className="mobile-drawer-shortcuts" aria-label="Document drawer shortcuts">
        <button className={leftPopup === 'documents' ? 'is-active' : ''} type="button" onClick={() => openLeftPopup('documents')}>Documents</button>
        <button className={leftPopup === 'highlight-view' ? 'is-active' : ''} type="button" onClick={() => openLeftPopup('highlight-view')}>Highlights</button>
        <button className={leftPopup === 'bookmarks' ? 'is-active' : ''} type="button" onClick={() => openLeftPopup('bookmarks')}>Bookmarks</button>
      </div>

      <section
        ref={viewerBodyRef}
        className={viewerBodyClassName}
        style={viewerBodyStyle}
      >
        {layoutMode !== 'mobile' ? (
          <SourceSidePanel
            activePanel={leftPopup}
            pageEditActive={panelMode === 'page-edit'}
            textboxActive={toolMode === 'textbox'}
            onHighlightView={() => openLeftPopup('highlight-view')}
            onTextbox={() => {
              setToolMode(toolMode === 'textbox' ? 'select' : 'textbox')
              setPanelMode(null)
              closeLeftPopup()
            }}
            onPageEdit={() => { closeLeftPopup(); setPanelMode('page-edit') }}
            onDocuments={() => openLeftPopup('documents')}
            onBookmarks={() => openLeftPopup('bookmarks')}
            collapsed={leftPanelCollapsed}
            onToggle={toggleLeftPanel}
            onDocumentsClick={(buttonElement, tab) => {
              setDocumentPopupAnchor(buttonElement)
              setDocumentPopupTab(tab)
              setPanelMode(null)
              closeLeftPopup()
            }}
            documentPopupAnchor={documentPopupAnchor}
            documentPopupTab={documentPopupTab}
          />
        ) : null}
        {documentPopupAnchor && record && workspace && (
          <ModalPortal>
            <DocumentOutlinePopup
              anchor={documentPopupAnchor}
              initialTab={documentPopupTab}
              records={documents}
              activeDocumentId={record.document.id}
              workspace={workspace}
              sourceBookmarks={(workspace.sourceBookmarks ?? []).filter(
                (b) => b.documentId === record.document.id
              )}
              currentDocumentTitle={record.document.title}
              onClose={() => setDocumentPopupAnchor(null)}
              onOpenDocument={(documentId) => {
                setDocumentPopupAnchor(null)
                router.push(`/viewer/${documentId}`)
              }}
              onFocusAnchor={(anchorId) => {
                focusAnchor(anchorId)
                setDocumentPopupAnchor(null)
              }}
              onScrollPage={(pageNumber) => {
                scrollToPage(pageNumber)
                setDocumentPopupAnchor(null)
              }}
              onAddDocument={() => {
                setDocumentPopupAnchor(null)
                router.push('/')
              }}
              onAddBookmark={() => {
                const selection = window.getSelection()
                if (selection && !selection.isCollapsed && selection.toString().trim()) {
                  captureSourceSelection()
                } else {
                  window.alert('Select text in the source document to bookmark.')
                }
                setDocumentPopupAnchor(null)
              }}
            />
          </ModalPortal>
        )}
        <section
          ref={sourcePaneRef}
          className={paneMode === 'source' ? 'mobile-pdf-pane is-active' : 'mobile-pdf-pane'}
          onScroll={handleSourceScroll}
          aria-label="Source document"
        >
          <SourcePaneInkLayer documentId={record.document.id} workspace={workspace} />
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
              updateDraftPath(null)
            }}
          >
            <div className="mobile-source-document-content">
              {sourceKind === 'web-clean' ? (
                <ReadableWebDocument record={record} zoom={viewerState.sourceZoom}>
                  <AnnotationLayer documentId={record.document.id} pageNumber={1} sourceZoom={effectiveSourceZoom} workspace={workspace} selectionHighlights={sourceSelectionHighlights} linkedAnchors={linkedSourceAnchors} draftPath={draftPath} onTextboxChange={updateTextbox} onTextboxDelete={deleteTextbox} onAnchorPopup={openAnchorPopup} />
                  <SourceToolHitLayer pageNumber={1} />
                </ReadableWebDocument>
              ) : pdfState ? (
                pdfState.pages.map((page, index) => {
                  const pageNumber = index + 1
                  if (pageEditDeletedPages.has(pageNumber)) return null
                  const rotation = getPageRotation(viewerState, pageNumber)
                  return (
                    <div key={pageNumber} className="mobile-annotated-page" data-page-number={pageNumber}>
                      <PdfCanvasPage page={page} pageNumber={pageNumber} zoom={effectiveSourceZoom} rotation={rotation} />
                      <SelectedTextHighlightLayer documentId={record.document.id} pageNumber={pageNumber} sourceZoom={effectiveSourceZoom} workspace={workspace} selectionHighlights={sourceSelectionHighlights} onAnchorPopup={openAnchorPopup} />
                      <SourceInkLayer documentId={record.document.id} pageNumber={pageNumber} workspace={workspace} draftPath={draftPath} />
                      <SourceToolHitLayer pageNumber={pageNumber} />
                      <SourceTextboxLayer documentId={record.document.id} pageNumber={pageNumber} workspace={workspace} onTextboxChange={updateTextbox} onTextboxDelete={deleteTextbox} />
                      <SourceMarkerLayer documentId={record.document.id} pageNumber={pageNumber} sourceZoom={effectiveSourceZoom} workspace={workspace} selectionHighlights={sourceSelectionHighlights} linkedAnchors={linkedSourceAnchors} onAnchorPopup={openAnchorPopup} />
                    </div>
                  )
                })
              ) : (
                <div className="mobile-loading-panel">No visual PDF bytes found for this document.</div>
              )}
            </div>
            {sourceMagnifier && !selectionPopup ? <SourceSelectionMagnifierLens magnifier={sourceMagnifier} /> : null}
            {sourceKind !== 'web-clean' && record && workspace ? (
              <SelectionManager
                rootRef={sourcePaneRef}
                workspaceId={workspace.workspaceId}
                documentId={record.document.id}
                availableTags={workspaceTagOptions(workspace)}
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
        </section>

        <div
          className="mobile-pane-divider"
          role="separator"
          aria-orientation={resolvedWorkspaceArrangement === 'vertical' ? 'horizontal' : 'vertical'}
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
            changeSplit(event.clientX, event.clientY)
          }}
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) changeSplit(event.clientX, event.clientY)
          }}
        />

        <section className={paneMode === 'workspace' ? 'mobile-workspace-pane is-active' : 'mobile-workspace-pane'} aria-label="Workspace">
          {workspaceSwitcherOpen ? (
            <ModalPortal>
              <>
              <button
                className="workspace-switcher-backdrop"
                type="button"
                aria-label="Close workspace switcher"
                onClick={() => setWorkspaceSwitcherOpen(false)}
              />
              <aside className="workspace-switcher-panel" aria-label="Workspaces">
                <header>
                  <div>
                    <span>Mobile Workspace</span>
                    <h2>Workspaces</h2>
                  </div>
                  <button type="button" aria-label="Close workspace switcher" onClick={() => setWorkspaceSwitcherOpen(false)}>×</button>
                </header>
                <div className="workspace-switcher-list">
                  {(workspace.workspaceBoards?.length
                    ? workspace.workspaceBoards
                    : [
                        {
                          id: 'default-board',
                          documentId: record.document.id,
                          name: 'Workspace 1',
                          createdAt: new Date().toISOString(),
                          updatedAt: new Date().toISOString()
                        }
                      ]).map((board) => (
                    <button
                      key={board.id}
                      type="button"
                      className={board.id === (workspace.activeWorkspaceBoardId ?? 'default-board') ? 'is-active' : ''}
                      onClick={() => switchWorkspaceBoard(board.id)}
                    >
                      <strong>{board.name}</strong>
                      <small>{board.id === (workspace.activeWorkspaceBoardId ?? 'default-board') ? 'Active' : 'Tap to switch'}</small>
                    </button>
                  ))}
                </div>
                <form
                  className="workspace-switcher-create"
                  onSubmit={(event) => {
                    event.preventDefault()
                    createWorkspaceBoard()
                  }}
                >
                  <label>
                    <span>New workspace name</span>
                    <input
                      value={newWorkspaceName}
                      placeholder={`Workspace ${(workspace.workspaceBoards ?? []).length + 1}`}
                      onChange={(event) => setNewWorkspaceName(event.target.value)}
                    />
                  </label>
                  <button type="submit">Create Workspace</button>
                </form>
              </aside>
              </>
            </ModalPortal>
          ) : null}
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
            toolMode={toolMode}
            toolSettings={toolSettings}
            inkStrokes={workspace.inkStrokes}
            freeformHighlights={workspace.freeformHighlights}
            workspaceBoards={workspace.workspaceBoards ?? []}
            activeWorkspaceBoardId={workspace.activeWorkspaceBoardId}
            onWorkspaceInkStroke={(payload) => updateWorkspace((current) => dispatchInteractionAction(current, { type: 'ADD_INK_STROKE', payload }))}
            onWorkspaceFreeformHighlight={(payload) => updateWorkspace((current) => dispatchInteractionAction(current, { type: 'ADD_FREEFORM_HIGHLIGHT', payload }))}
            onWorkspaceEraseInk={(point, size) =>
              updateWorkspace((current) =>
                dispatchInteractionAction(current, {
                  type: 'ERASE_WORKSPACE_INK_AT_POINT',
                  payload: { documentId: record.document.id, point, size }
                })
              )
            }
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
            onDeleteNode={deleteWorkspaceNode}
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
            onOpenWorkspaceSwitcher={() => setWorkspaceSwitcherOpen(true)}
          />
        </section>
        {toolSettings && INK_TOOL_MODES.has(toolMode) ? (
          <GlobalInkCaptureLayer
            toolMode={toolMode}
            settings={toolSettings}
            bodyRef={viewerBodyRef}
            onRoutePoint={routeGlobalInkPoint}
            onErase={eraseGlobalInkAt}
            onCommit={commitGlobalInkDraft}
            onWheelScroll={scrollGlobalInkSurface}
          />
        ) : null}
      </section>

      {leftPopup ? (
        <LeftDrawer
          mode={leftPopup}
          title={leftPopupTitle(leftPopup)}
          record={record}
          documents={filteredDocuments}
          workspace={workspace}
          activeDocumentId={record.document.id}
          documentFilter={documentFilter}
          highlightFilter={highlightFilter}
          highlights={filteredHighlights}
          sourceBookmarks={(workspace.sourceBookmarks ?? []).filter((bookmark) => bookmark.documentId === record.document.id)}
          openDocumentOptionsId={openDocumentOptionsId}
          onDocumentFilter={setDocumentFilter}
          onHighlightFilter={setHighlightFilter}
          onClose={closeLeftPopup}
          onOpenLibrary={() => router.push('/')}
          onImportMore={() => router.push('/')}
          onOpenDocument={(documentId) => { closeLeftPopup(); router.push(`/viewer/${documentId}`) }}
          onDocumentOptions={(documentId) => setOpenDocumentOptionsId((current) => (current === documentId ? null : documentId))}
          onRenameDocument={(documentRecord) => { void renameDocument(documentRecord) }}
          onDeleteDocument={(documentRecord) => { void deleteDocument(documentRecord) }}
          onCopyText={copyText}
          onFocusAnchor={(anchorId) => { focusAnchor(anchorId); closeLeftPopup() }}
          onScrollPage={(pageNumber) => { scrollToPage(pageNumber); closeLeftPopup() }}
          onExportBundle={exportProjectBundle}
          onExportPrintable={exportPrintablePdf}
          onResetSplit={() => {
            updateWorkspace((current) => ({ ...current, viewerLayout: { ...current.viewerLayout, splitRatio: resetSplitRatio() }, updatedAt: new Date().toISOString() }))
          }}
        />
      ) : null}

      <footer className="mobile-viewer-footer">
        Page {viewerState.activePage} of {Math.max(record.document.pageCount, pdfState?.pages.length ?? 1)} · {sourceKindLabel(sourceKind)}
      </footer>

      {selectionPopup ? (
        <SelectionActionPopup
          key={`${selectionPopup.selection.text}:${selectionPopup.left}:${selectionPopup.top}`}
          popup={selectionPopup}
          availableTags={workspaceTagOptions(workspace)}
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

      {panelMode === 'page-edit' && pdfState ? (
        <Modal title="Edit Pages" className="page-editor-modal-shell" onClose={() => setPanelMode(null)}>
          <PageEditPanel
            pages={pdfState.pages}
            pageCount={pdfState.pages.length}
            currentPage={viewerState.activePage}
            deletedPages={pageEditDeletedPages}
            rotations={viewerState.pageRotations ?? {}}
            onGoToPage={(pageNumber) => {
              scrollToPage(pageNumber)
              setPanelMode(null)
            }}
            onRotateCurrent={(degrees, pageNumber) => {
              const currentRotation = getPageRotation(viewerState, pageNumber)
              commitViewerState({
                pageRotations: {
                  ...(viewerState.pageRotations ?? {}),
                  [pageNumber]: (currentRotation + degrees + 360) % 360
                }
              })
            }}
            onRotateAll={(degrees) => {
              const pageRotations: Record<number, number> = {}
              for (let pageNumber = 1; pageNumber <= pdfState.pages.length; pageNumber += 1) {
                pageRotations[pageNumber] = (getPageRotation(viewerState, pageNumber) + degrees + 360) % 360
              }
              commitViewerState({ pageRotations })
            }}
            onInsertPage={(pageNumber) => insertPageAfter(pageNumber)}
            onDeletePage={(pageNumber) => deletePage(pageNumber)}
            onExtractPage={(pageNumber) => extractPage(pageNumber)}
          />
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
        <Modal title="Settings" onClose={() => setPanelMode(null)}>
          <MoreSettingsPanel
            workspace={workspace}
            onUpdateWorkspace={updateWorkspace}
            record={record}
            onClose={() => setPanelMode(null)}
          />
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
  onHighlightView,
  onTextbox,
  onPageEdit,
  onDocuments,
  onBookmarks,
  collapsed = false,
  onToggle,
  onDocumentsClick,
  documentPopupAnchor,
  documentPopupTab
}: {
  activePanel: LeftPopupMode
  pageEditActive: boolean
  textboxActive: boolean
  onHighlightView: () => void
  onTextbox: () => void
  onPageEdit: () => void
  onDocuments: () => void
  onBookmarks: () => void
  collapsed?: boolean
  onToggle?: () => void
  onDocumentsClick: (button: HTMLButtonElement, tab: 'documents' | 'outline') => void
  documentPopupAnchor: HTMLElement | null
  documentPopupTab: 'documents' | 'outline'
}) {
  const documentsButtonRef = useRef<HTMLButtonElement>(null)
  const bookmarksButtonRef = useRef<HTMLButtonElement>(null)

  if (collapsed) {
    return (
      <aside className="mobile-viewer-side-panel mobile-viewer-side-panel-collapsed">
        <button className={activePanel === 'highlight-view' ? 'is-active' : ''} type="button" title="Highlight View - see all highlights together" aria-label="Highlight View" onClick={onHighlightView}>
          <Icon name="highlightView" />
        </button>
        <button className={textboxActive ? 'is-active' : ''} type="button" title="Insert textbox in document" aria-label="Insert Textbox" onClick={onTextbox}>
          <Icon name="textbox" />
        </button>
        <button className={pageEditActive ? 'is-active' : ''} type="button" title="Edit pages in this document" aria-label="Edit Pages" onClick={onPageEdit}>
          <Icon name="editPages" />
        </button>
        <button
          ref={documentsButtonRef}
          className={documentPopupAnchor && documentPopupTab === 'documents' ? 'is-active' : (activePanel === 'documents' ? 'is-active' : '')}
          type="button"
          title="See document list or add new document"
          aria-label="Documents"
          onClick={() => {
            if (documentsButtonRef.current) {
              onDocumentsClick(documentsButtonRef.current, 'documents')
            } else {
              onDocuments()
            }
          }}
        >
          <Icon name="docs" />
        </button>
        <button
          ref={bookmarksButtonRef}
          className={documentPopupAnchor && documentPopupTab === 'outline' ? 'is-active' : (activePanel === 'bookmarks' ? 'is-active' : '')}
          type="button"
          title="See outlines and bookmarked sentences"
          aria-label="Outlines / Bookmarks"
          onClick={() => {
            if (bookmarksButtonRef.current) {
              onDocumentsClick(bookmarksButtonRef.current, 'outline')
            } else {
              onBookmarks()
            }
          }}
        >
          <Icon name="bookmark" />
        </button>
        <button
          className="mobile-viewer-rail-toggle mobile-viewer-rail-toggle-expand"
          type="button"
          onClick={onToggle}
          aria-label="Expand left sidebar"
          title="Expand sidebar"
        >
          ›
        </button>
      </aside>
    )
  }

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
      <button
        ref={documentsButtonRef}
        className={documentPopupAnchor && documentPopupTab === 'documents' ? 'is-active' : (activePanel === 'documents' ? 'is-active' : '')}
        type="button"
        title="See document list or add new document"
        aria-label="Documents"
        onClick={() => {
          if (documentsButtonRef.current) {
            onDocumentsClick(documentsButtonRef.current, 'documents')
          } else {
            onDocuments()
          }
        }}
      >
        <Icon name="docs" />
        <span>Documents</span>
      </button>
      <button
        ref={bookmarksButtonRef}
        className={documentPopupAnchor && documentPopupTab === 'outline' ? 'is-active' : (activePanel === 'bookmarks' ? 'is-active' : '')}
        type="button"
        title="See outlines and bookmarked sentences"
        aria-label="Outlines / Bookmarks"
        onClick={() => {
          if (bookmarksButtonRef.current) {
            onDocumentsClick(bookmarksButtonRef.current, 'outline')
          } else {
            onBookmarks()
          }
        }}
      >
        <Icon name="bookmark" />
        <span>Bookmarks</span>
      </button>

      <button
        className="mobile-viewer-rail-toggle"
        type="button"
        onClick={onToggle}
        aria-label="Collapse left sidebar"
        title="Collapse sidebar"
      >
        ‹
      </button>
    </aside>
  )
}

function leftPopupTitle(mode: Exclude<LeftPopupMode, null>) {
  if (mode === 'highlight-view') return 'Highlight View'
  if (mode === 'documents') return 'Documents'
  if (mode === 'bookmarks') return 'Outlines / Bookmarks'
  if (mode === 'more') return 'More Options'
  return 'Share'
}

function LeftDrawer({
  mode,
  title,
  record,
  documents,
  workspace,
  activeDocumentId,
  documentFilter,
  highlightFilter,
  highlights,
  sourceBookmarks,
  openDocumentOptionsId,
  onDocumentFilter,
  onHighlightFilter,
  onClose,
  onOpenLibrary,
  onImportMore,
  onOpenDocument,
  onDocumentOptions,
  onRenameDocument,
  onDeleteDocument,
  onCopyText,
  onFocusAnchor,
  onScrollPage,
  onExportBundle,
  onExportPrintable,
  onResetSplit
}: {
  mode: Exclude<LeftPopupMode, null>
  title: string
  record: MobileDocumentRecord
  documents: MobileDocumentRecord[]
  workspace: MobileWorkspaceState
  activeDocumentId: string
  documentFilter: string
  highlightFilter: string
  highlights: PageAnchor[]
  sourceBookmarks: Array<{ id: string; label: string; pageNumber?: number }>
  openDocumentOptionsId: string | null
  onDocumentFilter: (value: string) => void
  onHighlightFilter: (value: string) => void
  onClose: () => void
  onOpenLibrary: () => void
  onImportMore: () => void
  onOpenDocument: (documentId: string) => void
  onDocumentOptions: (documentId: string) => void
  onRenameDocument: (documentRecord: MobileDocumentRecord) => void
  onDeleteDocument: (documentRecord: MobileDocumentRecord) => void
  onCopyText: (value: string, label: string) => void
  onFocusAnchor: (anchorId: string) => void
  onScrollPage: (pageNumber: number) => void
  onExportBundle: () => void
  onExportPrintable: () => void
  onResetSplit: () => void
}) {
  const currentBookmarks = workspace.bookmarks.filter((bookmark) => bookmark.documentId === activeDocumentId)
  const pageCount = Math.max(record.document.pageCount ?? 0, 1)
  return (
    <>
      <button className="mobile-left-popup-backdrop" type="button" aria-label="Close left drawer" onClick={onClose} />
      <aside className="mobile-left-popup" aria-label={title}>
        <header className="mobile-left-popup-header">
          <div>
            <span>{sourceKindLabel(getDocumentSourceKind(record))}</span>
            <h2>{title}</h2>
          </div>
          <button className="mobile-modal-close" type="button" aria-label="Close" onClick={onClose}>×</button>
        </header>

        <div className="mobile-left-popup-body">
          {mode === 'documents' ? (
            <>
              <input className="mobile-left-popup-search" value={documentFilter} onChange={(event) => onDocumentFilter(event.target.value)} placeholder="Search documents" aria-label="Search documents" />
              <div className="mobile-left-popup-actions">
                <button className="mobile-secondary-button" type="button" onClick={onOpenLibrary}>Open Library</button>
                <button className="mobile-primary-button" type="button" onClick={onImportMore}>Import More</button>
              </div>
              <div className="mobile-left-popup-list">
                {documents.length ? documents.map((documentRecord) => (
                  <article key={documentRecord.document.id} className={documentRecord.document.id === activeDocumentId ? 'mobile-left-popup-item is-active' : 'mobile-left-popup-item'}>
                    <button type="button" onClick={() => onOpenDocument(documentRecord.document.id)}>
                      <strong>{documentRecord.document.title}</strong>
                      <span>{sourceKindLabel(getDocumentSourceKind(documentRecord))} · {documentRecord.document.pageCount || 1} pages</span>
                      <small>{documentRecord.lastOpenedAt ?? documentRecord.document.updatedAt ?? 'No date'}</small>
                    </button>
                    <button className="mobile-left-popup-options-button" type="button" aria-label={`Options for ${documentRecord.document.title}`} onClick={() => onDocumentOptions(documentRecord.document.id)}>•••</button>
                    {openDocumentOptionsId === documentRecord.document.id ? (
                      <div className="mobile-left-popup-options">
                        <button type="button" onClick={() => onOpenDocument(documentRecord.document.id)}>Open</button>
                        <button type="button" onClick={() => onRenameDocument(documentRecord)}>Rename</button>
                        <button type="button" disabled title="Coming soon">Duplicate metadata</button>
                        <button type="button" onClick={() => onDeleteDocument(documentRecord)}>Delete</button>
                        <button type="button" onClick={() => onCopyText(documentRecord.document.title, 'Title')}>Copy title</button>
                        <button type="button" onClick={() => onCopyText(documentRecord.document.id, 'Document id')}>Copy id</button>
                      </div>
                    ) : null}
                  </article>
                )) : <p className="mobile-left-popup-empty">No documents found.</p>}
              </div>
            </>
          ) : null}

          {mode === 'bookmarks' ? (
            <div className="mobile-left-popup-list">
              {currentBookmarks.map((bookmark) => {
                const anchor = workspace.anchors.find((entry) => entry.id === bookmark.sourceAnchorId)
                return (
                  <button key={bookmark.id} className="mobile-left-popup-item" type="button" onClick={() => { if (anchor) onFocusAnchor(anchor.id) }}>
                    <strong>{anchor ? `Page ${anchor.pageNumber}` : 'Bookmark'}</strong>
                    <span>{anchor?.textQuote ?? bookmark.bookmarkLabel}</span>
                  </button>
                )
              })}
              {sourceBookmarks.map((bookmark) => (
                <button key={bookmark.id} className="mobile-left-popup-item" type="button" onClick={() => onScrollPage(bookmark.pageNumber ?? 1)}>
                  <strong>Page {bookmark.pageNumber ?? 1}</strong>
                  <span>{bookmark.label}</span>
                </button>
              ))}
              {!currentBookmarks.length && !sourceBookmarks.length ? <p className="mobile-left-popup-empty">No bookmarks yet.</p> : null}
            </div>
          ) : null}

          {mode === 'highlight-view' ? (
            <>
              <input className="mobile-left-popup-search" value={highlightFilter} onChange={(event) => onHighlightFilter(event.target.value)} placeholder="Search highlights or tags" aria-label="Search highlights" />
              <div className="mobile-left-popup-list">
                {highlights.map((anchor) => (
                  <button key={anchor.id} className="mobile-left-popup-item" type="button" onClick={() => onFocusAnchor(anchor.id)}>
                    <strong><span className="mobile-left-popup-color-dot" style={{ background: anchor.selectionColor ?? '#5d5df6' }} /> Page {anchor.pageNumber}</strong>
                    <span>{anchor.textQuote}</span>
                    {(anchor.tags ?? []).length ? <small>{anchor.tags?.map((tag) => `#${tag}`).join(' ')}</small> : null}
                  </button>
                ))}
                {!highlights.length ? <p className="mobile-left-popup-empty">No highlights yet.</p> : null}
              </div>
            </>
          ) : null}

          {mode === 'share' ? (
            <div className="mobile-left-popup-actions is-column">
              <button className="mobile-primary-button" type="button" onClick={onExportBundle}>Export Project Bundle</button>
              <p>Downloads a JSON project bundle with document and workspace data.</p>
              <button className="mobile-secondary-button" type="button" onClick={onExportPrintable}>Printable Export</button>
              <p>Opens a printable view of excerpts, notes, and source marks.</p>
            </div>
          ) : null}

          {mode === 'more' ? (
            <div className="mobile-left-popup-list">
              <section className="mobile-left-popup-item">
                <strong>{record.document.title}</strong>
                <span>ID: {record.document.id}</span>
                <span>{sourceKindLabel(getDocumentSourceKind(record))} · {pageCount} pages</span>
              </section>
              <div className="mobile-left-popup-actions is-column">
                <button className="mobile-secondary-button" type="button" onClick={() => onCopyText(record.document.id, 'Document id')}>Copy document id</button>
                <button className="mobile-secondary-button" type="button" onClick={() => onCopyText(record.document.title, 'Title')}>Copy title</button>
                <button className="mobile-secondary-button" type="button" onClick={onResetSplit}>Reset split layout</button>
                <button className="mobile-secondary-button" type="button" onClick={onClose}>Close panel</button>
                <button className="mobile-secondary-button" type="button" disabled>Cloud sync Coming soon</button>
                <button className="mobile-secondary-button" type="button" disabled>Version history Coming soon</button>
                <button className="mobile-secondary-button" type="button" disabled>Offline folder export Coming soon</button>
              </div>
            </div>
          ) : null}
        </div>
      </aside>
    </>
  )
}

function DocumentOutlinePopup({
  anchor,
  initialTab = 'documents',
  records,
  activeDocumentId,
  workspace,
  sourceBookmarks,
  currentDocumentTitle,
  onClose,
  onOpenDocument,
  onFocusAnchor,
  onScrollPage,
  onAddDocument,
  onAddBookmark
}: {
  anchor: HTMLElement
  initialTab?: 'documents' | 'outline'
  records: MobileDocumentRecord[]
  activeDocumentId: string
  workspace: MobileWorkspaceState
  sourceBookmarks: Array<{ id: string; label: string; pageNumber?: number }>
  currentDocumentTitle: string
  onClose: () => void
  onOpenDocument: (documentId: string) => void
  onFocusAnchor: (anchorId: string) => void
  onScrollPage: (pageNumber: number) => void
  onAddDocument: () => void
  onAddBookmark: () => void
}) {
  const [activeTab, setActiveTab] = useState<'documents' | 'outline'>(initialTab)
  const [documentFilter, setDocumentFilter] = useState('')
  const [outlineFilter, setOutlineFilter] = useState('')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc')
  const popupRef = useRef<HTMLDivElement>(null)

  const rect = anchor.getBoundingClientRect()
  const viewportWidth = typeof window === 'undefined' ? 390 : window.innerWidth
  const popupWidth = Math.min(360, Math.max(260, viewportWidth - 32))
  const popupLeft = Math.max(12, Math.min(rect.left, viewportWidth - popupWidth - 12))
  const arrowLeft = Math.max(18, Math.min(rect.left + rect.width / 2 - popupLeft, popupWidth - 18))
  const style: React.CSSProperties = {
    position: 'fixed',
    left: popupLeft,
    top: rect.bottom + 4,
    zIndex: 1000,
    width: popupWidth,
  }

  useEffect(() => {
    setActiveTab(initialTab)
  }, [initialTab])

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [onClose])

  const filterLower = documentFilter.toLowerCase()
  const filteredDocuments = records
    .filter((record) => record.document.title.toLowerCase().includes(filterLower))
    .sort((a, b) => {
      const titleA = a.document.title.toLowerCase()
      const titleB = b.document.title.toLowerCase()
      return sortOrder === 'asc' ? titleA.localeCompare(titleB) : titleB.localeCompare(titleA)
    })

  const outlineFilterLower = outlineFilter.toLowerCase()
  const workspaceBookmarks = workspace.bookmarks.filter(
    (b) => b.documentId === activeDocumentId
  )
  const filteredOutlineItems = [
    ...workspaceBookmarks.map((bookmark) => {
      const anchor = workspace.anchors.find((a) => a.id === bookmark.sourceAnchorId)
      return {
        id: bookmark.id,
        type: 'bookmark' as const,
        pageNumber: anchor?.pageNumber,
        label: anchor?.textQuote ?? bookmark.bookmarkLabel,
        anchorId: anchor?.id,
      }
    }),
    ...sourceBookmarks.map((bookmark) => ({
      id: bookmark.id,
      type: 'source' as const,
      pageNumber: bookmark.pageNumber ?? 1,
      label: bookmark.label,
      anchorId: undefined,
    })),
  ].filter(
    (item) =>
      !outlineFilterLower ||
      item.label.toLowerCase().includes(outlineFilterLower) ||
      `page ${item.pageNumber}`.includes(outlineFilterLower)
  )

  return (
    <div ref={popupRef} className="mobile-document-outline-popup" style={style}>
      <div className="mobile-popup-arrow" style={{ left: arrowLeft }} />
      <div className="mobile-popup-doc-title">
        <span className="mobile-popup-doc-title-label">Current document</span>
        <strong>{currentDocumentTitle}</strong>
      </div>

      <div className="mobile-popup-tabs">
        <button
          className={activeTab === 'documents' ? 'is-active' : ''}
          onClick={() => setActiveTab('documents')}
        >
          Documents
        </button>
        <button
          className={activeTab === 'outline' ? 'is-active' : ''}
          onClick={() => setActiveTab('outline')}
        >
          Outline
        </button>
        <button className="mobile-popup-close" onClick={onClose}>×</button>
      </div>

      {activeTab === 'documents' ? (
        <div className="mobile-popup-documents">
          <div className="mobile-popup-action-bar">
            <button className="mobile-secondary-button" type="button" onClick={onAddDocument}>
              Add Document
            </button>
            <div className="mobile-popup-search-sort">
              <input
                type="text"
                placeholder="Filter Documents"
                value={documentFilter}
                onChange={(e) => setDocumentFilter(e.target.value)}
                autoFocus
              />
              <button
                className="mobile-popup-sort-btn"
                type="button"
                onClick={() => setSortOrder((current) => (current === 'asc' ? 'desc' : 'asc'))}
                title={sortOrder === 'asc' ? 'Sort A-Z' : 'Sort Z-A'}
                aria-label={sortOrder === 'asc' ? 'Sort documents A to Z' : 'Sort documents Z to A'}
              >
                {sortOrder === 'asc' ? '↓' : '↑'}
              </button>
            </div>
          </div>
          <div className="mobile-popup-list">
            {filteredDocuments.length === 0 && (
              <div className="mobile-popup-empty">No documents match</div>
            )}
            {filteredDocuments.map((record) => (
              <button
                key={record.document.id}
                className={record.document.id === activeDocumentId ? 'is-active' : ''}
                onClick={() => {
                  onOpenDocument(record.document.id)
                  onClose()
                }}
              >
                <strong>{record.document.title}</strong>
                <span>
                  {sourceKindLabel(getDocumentSourceKind(record))} ·{' '}
                  {record.document.pageCount || 1} pages
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="mobile-popup-outline">
          <div className="mobile-popup-action-bar">
            <button className="mobile-secondary-button" type="button" onClick={onAddBookmark}>
              Add Bookmark
            </button>
          </div>
          <div className="mobile-popup-search-wrap">
            <input
              type="text"
              placeholder="Filter Outline"
              value={outlineFilter}
              onChange={(e) => setOutlineFilter(e.target.value)}
              autoFocus
            />
          </div>
          <div className="mobile-popup-list">
            {filteredOutlineItems.length === 0 && (
              <div className="mobile-popup-empty">No bookmarks match filter</div>
            )}
            {filteredOutlineItems.map((item) => (
              <button
                key={item.id}
                onClick={() => {
                  if (item.type === 'bookmark' && item.anchorId) {
                    onFocusAnchor(item.anchorId)
                  } else if (item.type === 'source') {
                    onScrollPage(item.pageNumber!)
                  }
                  onClose()
                }}
              >
                <strong>Page {item.pageNumber ?? '?'}</strong>
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
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
  return (
    <>
      <SelectedTextHighlightLayer documentId={documentId} pageNumber={pageNumber} sourceZoom={sourceZoom} workspace={workspace} selectionHighlights={selectionHighlights} onAnchorPopup={onAnchorPopup} />
      <SourceInkLayer documentId={documentId} pageNumber={pageNumber} workspace={workspace} draftPath={draftPath} />
      <SourceTextboxLayer documentId={documentId} pageNumber={pageNumber} workspace={workspace} onTextboxChange={onTextboxChange} onTextboxDelete={onTextboxDelete} />
      <SourceMarkerLayer documentId={documentId} pageNumber={pageNumber} sourceZoom={sourceZoom} workspace={workspace} selectionHighlights={selectionHighlights} linkedAnchors={linkedAnchors} onAnchorPopup={onAnchorPopup} />
    </>
  )
}

function getSourcePageVisualInkElement(pageElement: HTMLElement) {
  return (
    pageElement.querySelector<HTMLElement>('.mobile-pdf-page-layer') ??
    pageElement.querySelector<HTMLElement>('.mobile-readable-web-document') ??
    pageElement
  )
}

function getSourcePageInkBounds(pageElement: HTMLElement) {
  const canvas = pageElement.querySelector<HTMLCanvasElement>('.mobile-source-ink-canvas')
  const canvasRect = canvas?.getBoundingClientRect()
  if (canvasRect && canvasRect.width > 1 && canvasRect.height > 1) return canvasRect

  const visualElement = getSourcePageVisualInkElement(pageElement)
  const visualRect = visualElement.getBoundingClientRect()
  if (visualRect.width > 1 && visualRect.height > 1) return visualRect

  return pageElement.getBoundingClientRect()
}

function normalizePointInSourceInkBounds(clientX: number, clientY: number, pageElement: HTMLElement): NormalizedPoint {
  const rect = getSourcePageInkBounds(pageElement)
  return {
    x: Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width))),
    y: Math.max(0, Math.min(1, (clientY - rect.top) / Math.max(1, rect.height)))
  }
}

function positionSourceInkCanvas(canvas: HTMLCanvasElement) {
  const layer = canvas.parentElement
  const pageElement = canvas.closest<HTMLElement>('.mobile-annotated-page')
  if (!layer || !pageElement) return

  const visualRect = getSourcePageVisualInkElement(pageElement).getBoundingClientRect()
  const layerRect = layer.getBoundingClientRect()
  const width = Math.max(1, visualRect.width)
  const height = Math.max(1, visualRect.height)

  canvas.style.left = `${visualRect.left - layerRect.left}px`
  canvas.style.top = `${visualRect.top - layerRect.top}px`
  canvas.style.right = 'auto'
  canvas.style.bottom = 'auto'
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`
}

function SelectedTextHighlightLayer({
  documentId,
  pageNumber,
  sourceZoom,
  workspace,
  selectionHighlights,
  onAnchorPopup
}: {
  documentId: string
  pageNumber: number
  sourceZoom: number
  workspace: MobileWorkspaceState
  selectionHighlights: PageAnchor[]
  onAnchorPopup: (anchor: PageAnchor) => void
}) {
  const pageSelectionHighlights = selectionHighlights.filter((entry) => entry.pageNumber === pageNumber)
  const bookmarkAnchorIds = new Set(workspace.bookmarks.filter((bookmark) => bookmark.documentId === documentId).map((bookmark) => bookmark.sourceAnchorId))
  const excerptAnchorIds = new Set(
    workspace.nodes
      .filter((node) => node.documentId === documentId && (node.kind === 'excerpt' || node.kind === 'comment') && node.sourceAnchorId)
      .map((node) => node.sourceAnchorId as string)
  )
  return (
    <div className="mobile-selected-text-highlight-layer">
      {pageSelectionHighlights.flatMap((anchor) => {
        const hasTags = (anchor.tags ?? []).length > 0
        const isActiveTagMatch = Boolean(workspace.activeTag && (anchor.tags ?? []).includes(workspace.activeTag))
        const isDefinedTerm = (anchor.tags ?? []).some((tag) => tag.toLowerCase().includes('defined'))
        const shouldShowDefinedTerm = workspace.showDefinedTermsAttachments !== false && Boolean(workspace.underlineDefinedTerms) && isDefinedTerm
        const hasTextFill = Boolean(anchor.selectionColor || workspace.activeAnchorId === anchor.id || excerptAnchorIds.has(anchor.id) || isActiveTagMatch || shouldShowDefinedTerm)
        return bookmarkAnchorIds.has(anchor.id) ? [] : anchorToHighlightRects(anchor, sourceZoom).map((rect, index) => (
          <div
            key={`${anchor.id}-${index}`}
            data-anchor-id={anchor.id}
            className={`mobile-text-highlight${workspace.activeAnchorId === anchor.id ? ' is-active' : ''}${hasTags ? ' has-tag-marker' : ''}${hasTextFill ? ' has-text-fill' : ' is-tag-only'}`}
            style={{
              left: rect.x,
              top: rect.y,
              width: Math.max(8, rect.width),
              height: Math.max(8, rect.height),
              background: hasTextFill
                ? `${anchor.selectionColor ?? getTagColor(anchor.tags?.[0] ?? 'tag')}33`
                : 'transparent',
              borderColor: hasTextFill ? (anchor.selectionColor ?? getTagColor(anchor.tags?.[0] ?? 'tag')) : 'transparent',
              textDecoration: shouldShowDefinedTerm ? 'underline' : undefined
            }}
            title={anchor.textQuote}
            aria-hidden={hasTags ? undefined : true}
          >
            {index === 0 && hasTags ? (
              <button
                type="button"
                className="source-highlight-tag-marker"
                title={(anchor.tags ?? []).map((tag) => `#${tag}`).join(', ')}
                style={{ background: getTagColor(anchor.tags?.[0] ?? 'tag') }}
                onClick={(event) => {
                  event.stopPropagation()
                  onAnchorPopup(anchor)
                }}
              >
                {tagBadgeLabel(anchor.tags?.[0] ?? 'tag').replace(/^#/, '')}
              </button>
            ) : null}
          </div>
        ))
      })}
    </div>
  )
}

function SourceInkLayer({
  documentId,
  pageNumber,
  workspace,
  draftPath
}: {
  documentId: string
  pageNumber: number
  workspace: MobileWorkspaceState
  draftPath: DraftPath | null
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const highlights = (workspace.freeformHighlights ?? []).filter((entry) => entry.surface !== 'workspace' && entry.surface !== 'source-pane' && entry.documentId === documentId && (entry.pageNumber ?? 1) === pageNumber)
  const inkStrokes = (workspace.inkStrokes ?? []).filter((entry) => entry.surface !== 'workspace' && entry.surface !== 'source-pane' && entry.documentId === documentId && (entry.pageNumber ?? 1) === pageNumber)
  const draft = draftPath?.pageNumber === pageNumber ? draftPath : null

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    const layer = canvas?.parentElement
    if (!canvas || !layer) return

    const draw = () => {
      positionSourceInkCanvas(canvas)
      const rect = canvas.getBoundingClientRect()
      const width = Math.max(1, rect.width)
      const height = Math.max(1, rect.height)
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`

      const context = canvas.getContext('2d')
      if (!context) return
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
      context.clearRect(0, 0, width, height)

      highlights.forEach((highlight) => {
        drawInkPath(context, highlight.points, width, height, {
          color: highlight.color,
          size: highlight.size ?? 18,
          opacity: highlight.opacity ?? 0.42,
          kind: 'highlighter'
        })
      })
      if (draft?.kind === 'freeform-highlight') {
        drawInkPath(context, draft.points, width, height, {
          color: workspace.toolSettings.highlight.color,
          size: workspace.toolSettings.highlight.size,
          opacity: Math.min(0.75, (workspace.toolSettings.highlight.opacity ?? 0.42) + 0.16),
          kind: 'highlighter'
        })
      }

      inkStrokes.forEach((stroke) => {
        drawInkPath(context, stroke.points, width, height, {
          color: stroke.color,
          size: stroke.size ?? 4,
          opacity: stroke.tool === 'pencil' ? stroke.opacity ?? 0.58 : 0.92,
          kind: stroke.tool === 'pencil' ? 'pencil' : 'pen'
        })
      })
      if (draft?.kind === 'pen') {
        drawInkPath(context, draft.points, width, height, {
          color: workspace.toolSettings.pen.color,
          size: workspace.toolSettings.pen.size,
          opacity: 0.92,
          kind: 'pen'
        })
      }
      if (draft?.kind === 'pencil') {
        drawInkPath(context, draft.points, width, height, {
          color: workspace.toolSettings.pencil.color,
          size: workspace.toolSettings.pencil.size,
          opacity: workspace.toolSettings.pencil.opacity,
          kind: 'pencil'
        })
      }
    }

    draw()
    const observer = new ResizeObserver(draw)
    observer.observe(layer)
    const pageElement = canvas.closest<HTMLElement>('.mobile-annotated-page')
    const visualElement = pageElement ? getSourcePageVisualInkElement(pageElement) : null
    if (visualElement && visualElement !== layer) observer.observe(visualElement)
    return () => observer.disconnect()
  }, [draft, highlights, inkStrokes, workspace.toolSettings])

  return (
    <div className="mobile-source-ink-layer">
      <canvas
        ref={canvasRef}
        className="mobile-source-ink-canvas"
        aria-hidden="true"
        data-normalized-ink-canvas="true"
      />
    </div>
  )
}

function SourcePaneInkLayer({ documentId, workspace }: { documentId: string; workspace: MobileWorkspaceState }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const highlights = (workspace.freeformHighlights ?? []).filter((entry) => entry.surface === 'source-pane' && entry.documentId === documentId)
  const inkStrokes = (workspace.inkStrokes ?? []).filter((entry) => entry.surface === 'source-pane' && entry.documentId === documentId)

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const draw = () => {
      const rect = canvas.getBoundingClientRect()
      const width = Math.max(1, rect.width)
      const height = Math.max(1, rect.height)
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`

      const context = canvas.getContext('2d')
      if (!context) return
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
      context.clearRect(0, 0, width, height)

      highlights.forEach((highlight) => {
        drawInkPath(context, highlight.points, width, height, {
          color: highlight.color,
          size: highlight.size ?? 18,
          opacity: highlight.opacity ?? 0.42,
          kind: 'highlighter'
        })
      })
      inkStrokes.forEach((stroke) => {
        drawInkPath(context, stroke.points, width, height, {
          color: stroke.color,
          size: stroke.size ?? 4,
          opacity: stroke.tool === 'pencil' ? stroke.opacity ?? 0.58 : 0.92,
          kind: stroke.tool === 'pencil' ? 'pencil' : 'pen'
        })
      })
    }

    draw()
    const observer = new ResizeObserver(draw)
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [highlights, inkStrokes])

  return <canvas ref={canvasRef} className="mobile-source-pane-ink-canvas" aria-hidden="true" data-source-pane-ink-canvas="true" />
}

function GlobalInkCaptureLayer({
  toolMode,
  settings,
  bodyRef,
  onRoutePoint,
  onErase,
  onCommit,
  onWheelScroll
}: {
  toolMode: ToolMode
  settings: MobileToolSettings
  bodyRef: RefObject<HTMLElement | null>
  onRoutePoint: (clientX: number, clientY: number, activeSurface?: 'workspace' | 'source') => GlobalInkSurface | null
  onErase: (route: GlobalInkSurface, clientX: number, clientY: number) => void
  onCommit: (draft: GlobalInkDraft) => void
  onWheelScroll: (event: ReactWheelEvent<HTMLCanvasElement>) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const draftRef = useRef<GlobalInkDraft | null>(null)
  const pointerDownRef = useRef(false)
  const activeGlobalInkSurfaceRef = useRef<'workspace' | 'source' | null>(null)

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    const body = bodyRef.current
    if (!canvas || !body) return
    const resize = () => resizeGlobalInkCanvas(canvas)
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(body)
    return () => observer.disconnect()
  }, [bodyRef])

  function screenPoint(event: ReactPointerEvent<HTMLCanvasElement>): NormalizedPoint {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  function clearLiveCanvas() {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    const rect = canvas?.getBoundingClientRect()
    if (!canvas || !context || !rect) return
    context.clearRect(0, 0, Math.max(1, rect.width), Math.max(1, rect.height))
  }

  function isInteractiveViewerUiTarget(target: EventTarget | null) {
    return target instanceof Element && Boolean(
      target.closest('.mobile-viewer-commandbar') ||
      target.closest('.mobile-command-tool-selector') ||
      target.closest('.mobile-command-ink-settings') ||
      target.closest('.mobile-command-ink-colors') ||
      target.closest('.source-ink-toolbar') ||
      target.closest('.floating-universal-toolbar') ||
      target.closest('.workspace-tool-rail') ||
      target.closest('.mobile-canvas-zoom-level') ||
      target.closest('.workspace-switcher-panel') ||
      target.closest('.mobile-modal') ||
      target.closest('.mobile-left-popup') ||
      target.closest('.lt-settings-panel') ||
      target.closest('.lt-floating-menu')
    )
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (isInteractiveViewerUiTarget(event.target)) {
      return
    }
    const route = onRoutePoint(event.clientX, event.clientY)
    if (!route) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    pointerDownRef.current = true
    activeGlobalInkSurfaceRef.current = route.kind === 'workspace' ? 'workspace' : 'source'

    if (toolMode === 'eraser') {
      onErase(route, event.clientX, event.clientY)
      return
    }
    if (toolMode === 'pen' || toolMode === 'pencil' || toolMode === 'freeform-highlight') {
      draftRef.current = {
        kind: toolMode,
        surface: route.kind,
        pageNumber: route.kind === 'source' ? route.pageNumber : undefined,
        points: [route.point],
        screenPoints: [screenPoint(event)]
      }
    }
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!pointerDownRef.current) return
    const route = onRoutePoint(event.clientX, event.clientY, activeGlobalInkSurfaceRef.current ?? undefined)
    if (!route) return
    event.preventDefault()
    event.stopPropagation()

    if (toolMode === 'eraser') {
      onErase(route, event.clientX, event.clientY)
      return
    }
    const draft = draftRef.current
    if (!draft || draft.surface !== route.kind || (draft.surface === 'source' && draft.pageNumber !== (route.kind === 'source' ? route.pageNumber : undefined))) return

    const nextScreenPoint = screenPoint(event)
    const previous = draft.screenPoints.at(-1)
    if (previous) drawLiveGlobalInkSegment(event.currentTarget, draft.kind, [previous, nextScreenPoint], settings)
    draftRef.current = {
      ...draft,
      points: [...draft.points, route.point],
      screenPoints: [...draft.screenPoints, nextScreenPoint]
    }
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLCanvasElement>) {
    event.preventDefault()
    event.stopPropagation()
    pointerDownRef.current = false
    activeGlobalInkSurfaceRef.current = null
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    const draft = draftRef.current
    draftRef.current = null
    clearLiveCanvas()
    if (draft) onCommit(draft)
  }

  return (
    <canvas
      ref={canvasRef}
      className="global-ink-capture-layer"
      data-global-ink-capture-layer="true"
      aria-hidden="true"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onWheel={onWheelScroll}
    />
  )
}

function drawInkPath(
  context: CanvasRenderingContext2D,
  points: NormalizedPoint[],
  width: number,
  height: number,
  options: { color: string; size: number; opacity: number; kind: 'pen' | 'pencil' | 'highlighter' }
) {
  if (points.length < 2) return

  context.save()
  context.globalCompositeOperation = options.kind === 'highlighter' ? 'multiply' : 'source-over'
  context.globalAlpha = options.opacity
  context.strokeStyle = options.color
  context.lineWidth = Math.max(1.5, options.size)
  context.lineCap = 'round'
  context.lineJoin = 'round'

  context.beginPath()
  context.moveTo(points[0].x * width, points[0].y * height)
  for (let index = 1; index < points.length - 1; index += 1) {
    const next = points[index + 1]
    const midpointX = ((points[index].x + next.x) / 2) * width
    const midpointY = ((points[index].y + next.y) / 2) * height
    context.quadraticCurveTo(points[index].x * width, points[index].y * height, midpointX, midpointY)
  }
  const last = points[points.length - 1]
  context.lineTo(last.x * width, last.y * height)
  context.stroke()
  context.restore()
}

function drawLiveInkSegment(canvas: HTMLCanvasElement, kind: DraftPath['kind'], points: NormalizedPoint[], settings: MobileToolSettings) {
  const rect = canvas.getBoundingClientRect()
  const width = Math.max(1, rect.width)
  const height = Math.max(1, rect.height)
  const dpr = window.devicePixelRatio || 1
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(height * dpr)
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
  }

  const context = canvas.getContext('2d')
  if (!context) return
  context.setTransform(dpr, 0, 0, dpr, 0, 0)
  if (kind === 'freeform-highlight') {
    drawInkPath(context, points, width, height, {
      color: settings.highlight.color,
      size: settings.highlight.size,
      opacity: Math.min(0.75, (settings.highlight.opacity ?? 0.42) + 0.16),
      kind: 'highlighter'
    })
    return
  }
  if (kind === 'pencil') {
    drawInkPath(context, points, width, height, {
      color: settings.pencil.color,
      size: settings.pencil.size,
      opacity: settings.pencil.opacity,
      kind: 'pencil'
    })
    return
  }
  drawInkPath(context, points, width, height, {
    color: settings.pen.color,
    size: settings.pen.size,
    opacity: 0.92,
    kind: 'pen'
  })
}

function resizeGlobalInkCanvas(canvas: HTMLCanvasElement) {
  const rect = canvas.getBoundingClientRect()
  const width = Math.max(1, rect.width)
  const height = Math.max(1, rect.height)
  const dpr = window.devicePixelRatio || 1
  const nextWidth = Math.round(width * dpr)
  const nextHeight = Math.round(height * dpr)
  if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
    canvas.width = nextWidth
    canvas.height = nextHeight
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
  }
  canvas.getContext('2d')?.setTransform(dpr, 0, 0, dpr, 0, 0)
}

function drawLiveGlobalInkSegment(canvas: HTMLCanvasElement, kind: DraftPath['kind'], points: NormalizedPoint[], settings: MobileToolSettings) {
  const context = canvas.getContext('2d')
  if (!context) return

  const options = kind === 'freeform-highlight'
    ? {
        color: settings.highlight.color,
        size: settings.highlight.size,
        opacity: Math.min(0.75, (settings.highlight.opacity ?? 0.42) + 0.16),
        kind: 'highlighter' as const
      }
    : kind === 'pencil'
      ? {
          color: settings.pencil.color,
          size: settings.pencil.size,
          opacity: settings.pencil.opacity,
          kind: 'pencil' as const
        }
      : {
          color: settings.pen.color,
          size: settings.pen.size,
          opacity: 0.92,
          kind: 'pen' as const
        }

  if (points.length < 2) return
  context.save()
  context.globalCompositeOperation = options.kind === 'highlighter' ? 'multiply' : 'source-over'
  context.globalAlpha = options.opacity
  context.strokeStyle = options.color
  context.lineWidth = Math.max(1.5, options.size)
  context.lineCap = 'round'
  context.lineJoin = 'round'
  context.beginPath()
  context.moveTo(points[0].x, points[0].y)
  context.lineTo(points[1].x, points[1].y)
  context.stroke()
  context.restore()
}

function SourceToolHitLayer({ pageNumber }: { pageNumber: number }) {
  return <div className="mobile-source-tool-hit-layer" data-page-number={pageNumber} aria-hidden="true" />
}

function SourceInkToolbar({
  toolMode,
  settings,
  pageNumber,
  canUndo,
  onToolMode,
  onSettingsChange,
  onUndo,
  onClearPage
}: {
  toolMode: ToolMode
  settings: MobileToolSettings
  pageNumber: number
  canUndo: boolean
  onToolMode: (mode: ToolMode) => void
  onSettingsChange: (settings: MobileToolSettings) => void
  onUndo: () => void
  onClearPage: () => void
}) {
  const toolbarRef = useRef<HTMLDivElement | null>(null)
  const [position, setPosition] = useState({ left: 18, top: 72 })
  const [drag, setDrag] = useState<{ pointerId: number; dx: number; dy: number } | null>(null)
  const usesColor = toolMode !== 'eraser'
  const activeColor = toolMode === 'freeform-highlight'
    ? settings.highlight.color
    : toolMode === 'pencil'
      ? settings.pencil.color
      : settings.pen.color
  const activeSize = toolMode === 'freeform-highlight'
    ? settings.highlight.size
    : toolMode === 'eraser'
      ? settings.eraser.size
      : toolMode === 'pencil'
        ? settings.pencil.size
        : settings.pen.size
  const sizeMax = toolMode === 'freeform-highlight' ? 42 : toolMode === 'eraser' ? 72 : 24
  const sizeMin = toolMode === 'eraser' ? 12 : 1
  const activeToolLabel = toolMode === 'freeform-highlight' ? 'Highlighter' : toolMode === 'pencil' ? 'Pencil' : toolMode === 'eraser' ? 'Eraser' : 'Pen'

  function updateColor(color: string) {
    if (!usesColor) return
    if (toolMode === 'freeform-highlight') {
      onSettingsChange({ ...settings, highlight: { ...settings.highlight, color } })
      return
    }
    if (toolMode === 'pencil') {
      onSettingsChange({ ...settings, pencil: { ...settings.pencil, color } })
      return
    }
    onSettingsChange({ ...settings, pen: { ...settings.pen, color } })
  }

  function updateSize(size: number) {
    if (toolMode === 'freeform-highlight') {
      onSettingsChange({ ...settings, highlight: { ...settings.highlight, size } })
      return
    }
    if (toolMode === 'eraser') {
      onSettingsChange({ ...settings, eraser: { ...settings.eraser, size } })
      return
    }
    if (toolMode === 'pencil') {
      onSettingsChange({ ...settings, pencil: { ...settings.pencil, size } })
      return
    }
    onSettingsChange({ ...settings, pen: { ...settings.pen, size } })
  }

  const clampToolbarPosition = useCallback((left: number, top: number) => {
    const toolbar = toolbarRef.current
    const parent = toolbar?.parentElement
    const parentRect = parent?.getBoundingClientRect()
    const toolbarRect = toolbar?.getBoundingClientRect()
    if (!parentRect || !toolbarRect) return { left, top }

    const maxLeft = Math.max(8, parentRect.width - toolbarRect.width - 8)
    const maxTop = Math.max(8, parentRect.height - toolbarRect.height - 8)
    return {
      left: Math.max(8, Math.min(left, maxLeft)),
      top: Math.max(8, Math.min(top, maxTop))
    }
  }, [])

  const moveToolbar = useCallback((clientX: number, clientY: number, offsetX: number, offsetY: number) => {
    const toolbar = toolbarRef.current
    const parent = toolbar?.parentElement
    const parentRect = parent?.getBoundingClientRect()
    if (!parentRect) return
    setPosition(clampToolbarPosition(clientX - parentRect.left - offsetX, clientY - parentRect.top - offsetY))
  }, [clampToolbarPosition])

  useLayoutEffect(() => {
    const toolbar = toolbarRef.current
    const parent = toolbar?.parentElement
    if (!toolbar || !parent) return
    const clampCurrent = () =>
      setPosition((current) => {
        const next = clampToolbarPosition(current.left, current.top)
        return next.left === current.left && next.top === current.top ? current : next
      })
    clampCurrent()
    const observer = new ResizeObserver(clampCurrent)
    observer.observe(parent)
    observer.observe(toolbar)
    window.addEventListener('orientationchange', clampCurrent)
    return () => {
      observer.disconnect()
      window.removeEventListener('orientationchange', clampCurrent)
    }
  }, [clampToolbarPosition])

  function actionTitle(action: string) {
    return `${action} ink toolbar`
  }

  return (
    <div
      ref={toolbarRef}
      className="source-ink-toolbar"
      aria-label="Ink tools"
      style={{ top: position.top }}
      onPointerMove={(event) => {
        if (!drag || drag.pointerId !== event.pointerId) return
        event.preventDefault()
        moveToolbar(event.clientX, event.clientY, drag.dx, drag.dy)
      }}
      onPointerUp={(event) => {
        if (drag?.pointerId === event.pointerId) {
          event.currentTarget.releasePointerCapture(event.pointerId)
          setDrag(null)
        }
      }}
      onPointerCancel={(event) => {
        if (drag?.pointerId === event.pointerId) setDrag(null)
      }}
    >
      <button
        className="source-ink-toolbar-grip"
        type="button"
        aria-label="Move ink toolbar"
        title="Move toolbar"
        onPointerDown={(event) => {
          const rect = toolbarRef.current?.getBoundingClientRect()
          if (!rect) return
          event.preventDefault()
          event.currentTarget.parentElement?.setPointerCapture(event.pointerId)
          setDrag({ pointerId: event.pointerId, dx: event.clientX - rect.left, dy: event.clientY - rect.top })
        }}
      >
        <span />
        <span />
      </button>
      <div className="source-ink-toolbar-tools" role="group" aria-label="Ink mode">
        <button className={toolMode === 'select' ? 'is-active' : ''} type="button" onClick={() => onToolMode('select')} aria-label="Select" title="Select"><Icon name="select" /></button>
        <button className={toolMode === 'pen' ? 'is-active' : ''} type="button" onClick={() => onToolMode('pen')} aria-label="Pen" title="Pen"><Icon name="pen" /></button>
        <button className={toolMode === 'pencil' ? 'is-active' : ''} type="button" onClick={() => onToolMode('pencil')} aria-label="Pencil" title="Pencil"><Icon name="pencil" /></button>
        <button className={toolMode === 'freeform-highlight' ? 'is-active' : ''} type="button" onClick={() => onToolMode('freeform-highlight')} aria-label="Highlighter" title="Highlighter"><Icon name="highlighter" /></button>
        <button className={toolMode === 'eraser' ? 'is-active' : ''} type="button" onClick={() => onToolMode('eraser')} aria-label="Eraser" title="Eraser"><Icon name="eraser" /></button>
      </div>
      {usesColor ? (
        <div className="source-ink-toolbar-colors" aria-label={`${activeToolLabel} colors`}>
          {INK_COLORS.map((color) => (
            <button
              key={color}
              className={color.toLowerCase() === activeColor.toLowerCase() ? 'is-active' : ''}
              type="button"
              aria-label={`${activeToolLabel} color ${color}`}
              title={color}
              onClick={() => updateColor(color)}
              style={{ backgroundColor: color }}
            />
          ))}
        </div>
      ) : null}
      <label className="source-ink-toolbar-size">
        <span title={`${activeToolLabel} size`}>{activeSize}</span>
        <input aria-label={`${activeToolLabel} size`} type="range" min={sizeMin} max={sizeMax} value={activeSize} onChange={(event) => updateSize(Number(event.target.value))} />
      </label>
      <button className="source-ink-toolbar-action" type="button" onClick={onUndo} disabled={!canUndo} aria-label="Undo ink stroke" title="Undo"><Icon name="undo" /></button>
      <button className="source-ink-toolbar-action" type="button" onClick={onClearPage} aria-label={`Clear ink on page ${pageNumber}`} title={`Clear page ${pageNumber}`}><Icon name="trash" /></button>
      <button className="source-ink-toolbar-close" type="button" aria-label="Close ink toolbar" title={actionTitle('Close')} onClick={() => onToolMode('select')}><Icon name="close" /></button>
    </div>
  )
}

function SourceMarkerLayer({
  documentId,
  pageNumber,
  sourceZoom,
  workspace,
  selectionHighlights,
  linkedAnchors,
  onAnchorPopup
}: {
  documentId: string
  pageNumber: number
  sourceZoom: number
  workspace: MobileWorkspaceState
  selectionHighlights: PageAnchor[]
  linkedAnchors: PageAnchor[]
  onAnchorPopup: (anchor: PageAnchor) => void
}) {
  const pageSelectionHighlights = selectionHighlights.filter((entry) => entry.pageNumber === pageNumber)
  const pageLinkedAnchors = linkedAnchors.filter((entry) => entry.pageNumber === pageNumber)
  const bookmarkAnchorIds = new Set(workspace.bookmarks.filter((bookmark) => bookmark.documentId === documentId).map((bookmark) => bookmark.sourceAnchorId))
  const pageBookmarkAnchors = pageSelectionHighlights.filter((anchor) => bookmarkAnchorIds.has(anchor.id))
  return (
    <div className="mobile-source-marker-layer">
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
    </div>
  )
}

function SourceTextboxLayer({
  documentId,
  pageNumber,
  workspace,
  onTextboxChange,
  onTextboxDelete
}: {
  documentId: string
  pageNumber: number
  workspace: MobileWorkspaceState
  onTextboxChange: (textbox: SourceTextbox) => void
  onTextboxDelete: (textboxId: string) => void
}) {
  const textboxes = (workspace.sourceTextboxes ?? []).filter((entry) => entry.documentId === documentId && (entry.pageNumber ?? 1) === pageNumber)
  return (
    <div className="mobile-source-textbox-layer">
      {textboxes.map((textbox) => (
        <SourceTextboxView key={textbox.id} textbox={textbox} onChange={onTextboxChange} onDelete={onTextboxDelete} />
      ))}
    </div>
  )
}

function SourceTextboxView({
  textbox,
  onChange,
  onDelete
}: {
  textbox: SourceTextbox
  onChange: (textbox: SourceTextbox) => void
  onDelete: (textboxId: string) => void
}) {
  const [focused, setFocused] = useState(false)
  const [dragging, setDragging] = useState<{
    pointerId: number
    startX: number
    startY: number
    xNorm: number
    yNorm: number
  } | null>(null)

  function stopSourceTextboxEvent(event: React.PointerEvent<HTMLElement>) {
    event.stopPropagation()
  }

  function updateTextStyle(style: Partial<TextStyle>) {
    onChange({ ...textbox, textStyle: { ...(textbox.textStyle ?? {}), ...style } })
  }

  function moveTextbox(clientX: number, clientY: number) {
    if (!dragging) return

    const page = document
      .querySelector(`[data-page-number="${textbox.pageNumber ?? 1}"]`)
      ?.querySelector<HTMLElement>('.mobile-source-textbox-layer')
      ?? document.querySelector<HTMLElement>('.mobile-source-textbox-layer')

    const rect = page?.getBoundingClientRect()
    if (!rect) return

    const dxNorm = (clientX - dragging.startX) / Math.max(1, rect.width)
    const dyNorm = (clientY - dragging.startY) / Math.max(1, rect.height)
    const widthNorm = textbox.widthNorm ?? 0.3
    const heightNorm = textbox.heightNorm ?? 0.16

    onChange({
      ...textbox,
      xNorm: Math.max(0, Math.min(1 - widthNorm, dragging.xNorm + dxNorm)),
      yNorm: Math.max(0, Math.min(1 - heightNorm, dragging.yNorm + dyNorm))
    })
  }

  return (
    <div
      className={`mobile-source-textbox-shell shared-textbox-card${focused ? ' is-editing' : ''}${dragging ? ' is-dragging' : ''}`}
      onPointerDown={stopSourceTextboxEvent}
      onPointerMove={(event) => {
        stopSourceTextboxEvent(event)
        if (!dragging || dragging.pointerId !== event.pointerId) return
        event.preventDefault()
        moveTextbox(event.clientX, event.clientY)
      }}
      onPointerUp={(event) => {
        stopSourceTextboxEvent(event)
        if (dragging?.pointerId === event.pointerId) {
          event.currentTarget.releasePointerCapture(event.pointerId)
          setDragging(null)
        }
      }}
      onPointerCancel={() => setDragging(null)}
      style={{
        left: `${textbox.xNorm * 100}%`,
        top: `${textbox.yNorm * 100}%`,
        width: `${(textbox.widthNorm ?? 0.3) * 100}%`,
        minHeight: `${(textbox.heightNorm ?? 0.16) * 100}%`
      }}
    >
      <SharedTextboxToolbar
        visible={focused}
        kind="source"
        left={0}
        top={-64}
        style={textbox.textStyle}
        onStyleChange={updateTextStyle}
        onDelete={() => onDelete(textbox.id)}
        onUndo={() => document.execCommand('undo')}
        onRedo={() => document.execCommand('redo')}
      />
      <div
        className="mobile-source-textbox-handle shared-textbox-handle"
        onPointerDown={(event) => {
          event.preventDefault()
          event.stopPropagation()
          event.currentTarget.parentElement?.setPointerCapture(event.pointerId)
          setFocused(true)
          setDragging({
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            xNorm: textbox.xNorm,
            yNorm: textbox.yNorm
          })
        }}
      >
        <span>Text</span>
        <button
          type="button"
          onPointerDown={(event) => {
            event.preventDefault()
            event.stopPropagation()
          }}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onDelete(textbox.id)
          }}
        >
          Delete
        </button>
      </div>
      <textarea
        className="mobile-source-textbox shared-textbox-editor"
        value={textbox.content}
        placeholder="Type source note..."
        style={styleToCss(textbox.textStyle)}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
        onFocus={() => setFocused(true)}
        onBlur={() => window.setTimeout(() => setFocused(false), 160)}
        onChange={(event) => onChange({ ...textbox, content: event.target.value })}
      />
    </div>
  )
}

function tagBadgeLabel(tag: string) {
  const clean = tag.replace(/^#/, '').trim()
  const first = clean.charAt(0).toUpperCase()
  return first ? `#${first}` : '#'
}

function tagDisplayLabel(tag: string) {
  return tag.replace(/^#/, '').trim() || 'Tag'
}

function globalTagLabel(tag: TagDefinition) {
  return `${tag.category.trim()}-${tag.name.trim()}`
    .replace(/\s+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
}

function workspaceTagOptions(workspace: MobileWorkspaceState) {
  return Array.from(new Set([
    ...TAG_PRESETS,
    ...(workspace.globalTags ?? []).map(globalTagLabel)
  ])).filter(Boolean)
}

function styleToCss(style?: TextStyle): CSSProperties {
  const decoration = [
    style?.underline ? 'underline' : '',
    style?.strikethrough ? 'line-through' : ''
  ].filter(Boolean).join(' ')
  return {
    fontFamily: style?.fontFamily,
    fontSize: style?.fontSize,
    fontWeight: style?.fontWeight,
    fontStyle: style?.fontStyle,
    textDecoration: decoration || undefined,
    color: style?.color,
    backgroundColor: style?.backgroundColor
  }
}

function FloatingUniversalToolBar({
  toolMode,
  settings,
  pageNumber,
  canUndo,
  onToolMode,
  onSettingsChange,
  onUndo,
  onClearPage,
  onClose
}: {
  toolMode: ToolMode
  settings: MobileToolSettings
  pageNumber: number
  canUndo: boolean
  onToolMode: (mode: ToolMode) => void
  onSettingsChange: (settings: MobileToolSettings) => void
  onUndo: () => void
  onClearPage: () => void
  onClose: () => void
}) {
  const barRef = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [position, setPosition] = useState<{ left: number; top: number }>({ left: 0, top: 0 })
  const dragging = useRef(false)
  const dragOffset = useRef({ x: 0, y: 0 })
  const initialized = useRef(false)

  const currentTool = SOURCE_TOOLS.find((t) => t.mode === toolMode)
  const isInkTool = INK_TOOL_MODES.has(toolMode)

  const activeSettings =
    toolMode === 'pen' ? settings.pen
    : toolMode === 'pencil' ? settings.pencil
    : toolMode === 'freeform-highlight' ? settings.highlight
    : toolMode === 'eraser' ? settings.eraser
    : null

  const clampPosition = useCallback((left: number, top: number) => {
    const w = typeof window === 'undefined' ? 400 : window.innerWidth
    const h = typeof window === 'undefined' ? 800 : window.innerHeight
    const bw = barRef.current?.offsetWidth ?? 220
    const bh = barRef.current?.offsetHeight ?? 48
    return {
      left: Math.max(8, Math.min(left, w - bw - 8)),
      top: Math.max(72, Math.min(top, h - bh - 16))
    }
  }, [])

  useLayoutEffect(() => {
    if (initialized.current) return
    initialized.current = true
    const w = typeof window === 'undefined' ? 400 : window.innerWidth
    const h = typeof window === 'undefined' ? 800 : window.innerHeight
    const bw = barRef.current?.offsetWidth ?? 220
    setPosition({
      left: Math.round((w - bw) / 2),
      top: Math.round(h * 0.12)
    })
  }, [])

  useLayoutEffect(() => {
    const onResize = () => {
      setPosition((prev) => clampPosition(prev.left, prev.top))
    }
    const observer = new ResizeObserver(onResize)
    if (barRef.current) observer.observe(barRef.current)
    window.addEventListener('resize', onResize)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', onResize)
    }
  }, [clampPosition])

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement
    if (target.closest('button, input, label, select')) return
    dragging.current = true
    const rect = barRef.current?.getBoundingClientRect()
    if (rect) {
      dragOffset.current = { x: event.clientX - rect.left, y: event.clientY - rect.top }
    }
    barRef.current?.setPointerCapture(event.pointerId)
    event.preventDefault()
  }, [])

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return
    const nextLeft = event.clientX - dragOffset.current.x
    const nextTop = event.clientY - dragOffset.current.y
    setPosition(clampPosition(nextLeft, nextTop))
  }, [clampPosition])

  const handlePointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    dragging.current = false
    barRef.current?.releasePointerCapture(event.pointerId)
  }, [])

  const toggleExpand = useCallback(() => setExpanded((prev) => !prev), [])

  const activeColor =
    toolMode === 'pen' ? settings.pen.color
    : toolMode === 'pencil' ? settings.pencil.color
    : toolMode === 'freeform-highlight' ? settings.highlight.color
    : '#5d5df6'
  const activeSize = activeSettings?.size ?? 3

  return (
    <aside
      ref={barRef}
      className={`floating-universal-toolbar${expanded ? ' is-expanded' : ''}`}
      style={{ left: position.left, top: position.top }}
      aria-label="Universal tools"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      <div className="floating-toolbar-header">
        <span className="floating-toolbar-grip" aria-hidden="true">
          <svg width="12" height="18" viewBox="0 0 12 18"><circle cx="3" cy="3" r="1.5" fill="currentColor" opacity="0.45"/><circle cx="9" cy="3" r="1.5" fill="currentColor" opacity="0.45"/><circle cx="3" cy="9" r="1.5" fill="currentColor" opacity="0.45"/><circle cx="9" cy="9" r="1.5" fill="currentColor" opacity="0.45"/><circle cx="3" cy="15" r="1.5" fill="currentColor" opacity="0.45"/><circle cx="9" cy="15" r="1.5" fill="currentColor" opacity="0.45"/></svg>
        </span>
        <button
          type="button"
          className="floating-toolbar-toggle"
          onClick={toggleExpand}
        >
          {expanded ? (
            <svg width="16" height="16" viewBox="0 0 16 16"><polyline points="4,10 8,6 12,10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
          ) : (
            currentTool ? (
              <span className="floating-toolbar-current-label">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 5 }}>
                  {toolMode === 'select' && <><path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/><path d="M13 13l6 6"/></>}
                  {toolMode === 'pen' && <><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></>}
                  {toolMode === 'pencil' && <><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></>}
                  {toolMode === 'freeform-highlight' && <><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" opacity="0.55"/><rect x="2" y="16" width="16" height="5" rx="1" fill="currentColor" opacity="0.35"/></>}
                  {toolMode === 'eraser' && <><path d="M20 20H7L3 16c-.8-.8-.8-2 0-2.8L14 2.2c.8-.8 2-.8 2.8 0L20 5.5"/><path d="M6 17l3 3"/><path d="M18 4l3 3"/><path d="M10 12l4 4"/></>}
                  {toolMode === 'textbox' && <><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 8h10"/><path d="M7 12h10"/><path d="M7 16h6"/></>}
                </svg>
                {currentTool.label}
              </span>
            ) : (
              <span className="floating-toolbar-current-label">Tools</span>
            )
          )}
        </button>
        {expanded && (
          <button type="button" className="floating-toolbar-close" onClick={onClose} aria-label="Close toolbar">
            <svg width="16" height="16" viewBox="0 0 16 16"><line x1="4" y1="4" x2="12" y2="12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/><line x1="12" y1="4" x2="4" y2="12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
          </button>
        )}
      </div>

      {expanded && (
        <div className="floating-toolbar-body">
          <div className="floating-toolbar-mode-row">
            {SOURCE_TOOLS.map((tool) => (
              <button
                key={tool.mode}
                type="button"
                className={toolMode === tool.mode ? 'is-active' : ''}
                onClick={() => onToolMode(tool.mode)}
                title={tool.label}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  {tool.mode === 'select' && <><path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/><path d="M13 13l6 6"/></>}
                  {tool.mode === 'pen' && <><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></>}
                  {tool.mode === 'pencil' && <><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></>}
                  {tool.mode === 'freeform-highlight' && <><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" opacity="0.55"/><rect x="2" y="16" width="16" height="5" rx="1" fill="currentColor" opacity="0.35"/></>}
                  {tool.mode === 'eraser' && <><path d="M20 20H7L3 16c-.8-.8-.8-2 0-2.8L14 2.2c.8-.8 2-.8 2.8 0L20 5.5"/><path d="M6 17l3 3"/><path d="M18 4l3 3"/><path d="M10 12l4 4"/></>}
                  {tool.mode === 'textbox' && <><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 8h10"/><path d="M7 12h10"/><path d="M7 16h6"/></>}
                </svg>
              </button>
            ))}
          </div>

          {isInkTool && activeSettings && (
            <>
              {toolMode !== 'eraser' ? (
                <div className="floating-toolbar-color-row">
                  {INK_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      className={activeColor === color ? 'is-active' : ''}
                      style={{ backgroundColor: color }}
                      onClick={() => {
                        const key = toolMode === 'pen' ? 'pen' : toolMode === 'pencil' ? 'pencil' : 'highlight'
                        onSettingsChange({ ...settings, [key]: { ...activeSettings, color } })
                      }}
                      aria-label={`Color ${color}`}
                    />
                  ))}
                </div>
              ) : null}

              <label className="floating-toolbar-size-row">
                <span>Size</span>
                <input
                  type="range"
                  min="1"
                  max={toolMode === 'freeform-highlight' ? 42 : toolMode === 'eraser' ? 72 : 18}
                  value={activeSize}
                  onChange={(event) => {
                    const key = toolMode === 'pen' ? 'pen' : toolMode === 'pencil' ? 'pencil' : toolMode === 'freeform-highlight' ? 'highlight' : 'eraser'
                    onSettingsChange({ ...settings, [key]: { ...activeSettings, size: Number(event.target.value) } })
                  }}
                />
                <span className="floating-toolbar-size-value">{activeSize}</span>
              </label>

              <div className="floating-toolbar-actions-row">
                <button type="button" disabled={!canUndo} onClick={onUndo} title="Undo">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
                </button>
                <button type="button" onClick={onClearPage} title="Clear page ink">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </aside>
  )
}

function Modal({
  title,
  children,
  onClose,
  className = ''
}: {
  title: string
  children: React.ReactNode
  onClose: () => void
  className?: string
}) {
  return (
    <ModalPortal>
      <div className="mobile-modal-backdrop" role="presentation">
        <section className={`mobile-modal ${className}`.trim()} role="dialog" aria-modal="true" aria-label={title}>
          <header>
            <h2>{title}</h2>
            <button className="mobile-modal-close" type="button" aria-label="Close" onClick={onClose}>×</button>
          </header>
          <div className="mobile-modal-body">{children}</div>
        </section>
      </div>
    </ModalPortal>
  )
}

function MoreSettingsPanel({
  workspace,
  onUpdateWorkspace,
  record,
  onClose
}: {
  workspace: MobileWorkspaceState
  onUpdateWorkspace: (updater: (current: MobileWorkspaceState) => MobileWorkspaceState) => void
  record: MobileDocumentRecord
  onClose: () => void
}) {
  const [showTagManager, setShowTagManager] = useState(false)
  const [showDefinedTerms, setShowDefinedTerms] = useState(false)
  const [showScrollOptions, setShowScrollOptions] = useState(false)
  const [showExcerptOptions, setShowExcerptOptions] = useState(false)
  const [showPenScrolling, setShowPenScrolling] = useState(false)
  const [showChooseLayout, setShowChooseLayout] = useState(false)
  const [activeMenu, setActiveMenu] = useState<LtSettingsMenu>(null)
  const [floatingPosition, setFloatingPosition] = useState({ top: 160, right: 472 })
  function updateWorkspaceSetting<K extends keyof MobileWorkspaceState>(key: K, value: MobileWorkspaceState[K]) {
    onUpdateWorkspace((current) => ({ ...current, [key]: value, updatedAt: new Date().toISOString() }))
  }

  function updateLayoutSetting<K extends keyof MobileWorkspaceState['viewerLayout']>(key: K, value: MobileWorkspaceState['viewerLayout'][K]) {
    onUpdateWorkspace((current) => ({
      ...current,
      viewerLayout: { ...current.viewerLayout, [key]: value },
      updatedAt: new Date().toISOString()
    }))
  }

  function updateSyncEnabled(syncEnabled: boolean) {
    onUpdateWorkspace((current) => ({
      ...current,
      settings: { ...current.settings, syncEnabled },
      updatedAt: new Date().toISOString()
    }))
  }

  function openMenuFromEvent(menu: LtSettingsMenu, event: ReactMouseEvent<HTMLButtonElement>) {
    if (!menu) return
    const rect = event.currentTarget.getBoundingClientRect()
    setFloatingPosition({
      top: Math.max(96, rect.top - 8),
      right: Math.max(16, window.innerWidth - rect.left + 12)
    })
    setActiveMenu((current) => (current === menu ? null : menu))
  }

  const arrangement = workspace.workspaceArrangement ?? 'automatic'
  const scrollWheelBehavior = workspace.scrollWheelBehavior ?? 'zoom'
  const excerptDoubleClickAction = workspace.excerptDoubleClickAction ?? 'selectGroup'
  const penScrollingBehavior = workspace.penScrollingBehavior ?? 'scrollByDefault'

  return (
    <>
      <div className="lt-settings-panel">
        <div className="lt-settings-project">
          <div>
            <strong>Project Name</strong>
            <span>{record.document.title}</span>
          </div>
          <button className="lt-settings-close" type="button" aria-label="Close settings" onClick={onClose}>×</button>
        </div>

        <SettingsSection title="Project">
          <SettingsRow icon="▱" label="Tag Manager" active={showTagManager} onClick={() => setShowTagManager(true)} />
          <SettingsRow icon="Ex" label="Defined Terms & Attachments" hasChevron active={activeMenu === 'definedTerms'} onClick={(event) => openMenuFromEvent('definedTerms', event)} />
        </SettingsSection>
        <SettingsSection title="Syncing">
          <SettingsRow icon="☁" label="Sync Across Devices" hasChevron active={activeMenu === 'sync'} onClick={(event) => openMenuFromEvent('sync', event)} />
        </SettingsSection>
        <SettingsSection title="Display">
          <SettingsRow icon="←" label="Left Hand Layout" toggleValue={workspace.viewerLayout.leftHandLayout ?? false} onToggle={() => updateLayoutSetting('leftHandLayout', !(workspace.viewerLayout.leftHandLayout ?? false))} />
          <SettingsRow icon="▦" label="Workspace Location" hasChevron active={activeMenu === 'workspaceLocation'} onClick={(event) => openMenuFromEvent('workspaceLocation', event)} />
          <SettingsRow icon="▤" label="Multiple Workspace Layout" hasChevron active={activeMenu === 'multipleWorkspaceLayout'} onClick={(event) => openMenuFromEvent('multipleWorkspaceLayout', event)} />
          <SettingsRow icon="▥" label="Multiple Document Layout" hasChevron active={activeMenu === 'multipleDocumentLayout'} onClick={(event) => openMenuFromEvent('multipleDocumentLayout', event)} />
          <SettingsRow icon="✣" label="Lock Workspace by Default" hasChevron active={activeMenu === 'lockWorkspace'} onClick={(event) => openMenuFromEvent('lockWorkspace', event)} />
          <SettingsRow icon="▤" label="Auto-Position Doc Comments" toggleValue={workspace.viewerLayout.autoPositionComments ?? true} onToggle={() => updateLayoutSetting('autoPositionComments', !(workspace.viewerLayout.autoPositionComments ?? true))} />
        </SettingsSection>
        <SettingsSection title="Text Linking">
          <SettingsRow icon="BA" label="Link Reference Style" hasChevron active={activeMenu === 'linkReferenceStyle'} onClick={(event) => openMenuFromEvent('linkReferenceStyle', event)} />
        </SettingsSection>
        <SettingsSection title="Navigation">
          <SettingsRow icon="◐" label="Scroll-Wheel Options" hasChevron active={activeMenu === 'scrollWheel'} onClick={(event) => openMenuFromEvent('scrollWheel', event)} />
          <SettingsRow icon="☝" label="Excerpt Double-Click Options" hasChevron active={activeMenu === 'doubleClick'} onClick={(event) => openMenuFromEvent('doubleClick', event)} />
        </SettingsSection>
        <SettingsSection title="Ink Settings">
          <SettingsRow icon="〽" label="Use finger for inking" toggleValue={workspace.useFingerForInking ?? false} onToggle={() => updateWorkspaceSetting('useFingerForInking', !(workspace.useFingerForInking ?? false))} />
          <SettingsRow icon="✎" label="Pen Scrolling Options" hasChevron active={activeMenu === 'penScrolling'} onClick={(event) => openMenuFromEvent('penScrolling', event)} />
        </SettingsSection>
      </div>

      {activeMenu === 'definedTerms' ? (
        <SettingsFloatingMenu className="lt-floating-menu--large" position={floatingPosition}>
          <div className="lt-submenu-title">Show Defined Terms & Attachments</div>
          <ToggleLine label="Show Defined Terms, Attachments" value={workspace.showDefinedTermsAttachments ?? true} onChange={() => updateWorkspaceSetting('showDefinedTermsAttachments', !(workspace.showDefinedTermsAttachments ?? true))} />
          <p className="lt-muted">Parsing Disabled</p>
          <div className="lt-submenu-title">Finding Inconsistencies</div>
          <ActionLine title="Search for Undefined Terms" description="Search for possible defined terms without definitions" active={workspace.findUndefinedTerms ?? false} onClick={() => updateWorkspaceSetting('findUndefinedTerms', !(workspace.findUndefinedTerms ?? false))} />
          <ActionLine title="Search for Overdefined Terms" description="Find defined terms that may have multiple definitions" active={workspace.findOverdefinedTerms ?? false} onClick={() => updateWorkspaceSetting('findOverdefinedTerms', !(workspace.findOverdefinedTerms ?? false))} />
          <div className="lt-submenu-title">Options</div>
          <ActionLine title="Underline Defined Terms" description="Underline defined terms and link back to the definition" active={workspace.underlineDefinedTerms ?? false} onClick={() => updateWorkspaceSetting('underlineDefinedTerms', !(workspace.underlineDefinedTerms ?? false))} />
          <ActionLine title="Underline Exhibits" description="Underline references to exhibits, annexures, and attachments" active={workspace.underlineExhibits ?? false} onClick={() => updateWorkspaceSetting('underlineExhibits', !(workspace.underlineExhibits ?? false))} />
          <ActionLine title="Link Across Documents" description="Underline and link terms that refer to different documents" active={workspace.linkAcrossDocuments ?? false} onClick={() => updateWorkspaceSetting('linkAcrossDocuments', !(workspace.linkAcrossDocuments ?? false))} />
        </SettingsFloatingMenu>
      ) : null}

      {activeMenu === 'sync' ? (
        <SettingsFloatingMenu className="lt-sync-popup" position={floatingPosition}>
          <h2>LiquidText Syncing</h2>
          <div className="lt-sync-icons"><span>▯</span><b>+</b><span>☁</span><b>+</b><span>▭</span></div>
          <ul>
            <li>Sync projects between devices!</li>
            <li>Get LiquidText on PC, Mac, & iPad</li>
            <li>Backup to the cloud</li>
            <li>Inking, multiple documents per project, tagging, and all latest features</li>
          </ul>
          <div className="lt-sync-status-card">
            <strong>{workspace.settings.syncEnabled ? 'Syncing Enabled' : 'Syncing Disabled'}</strong>
            <span>
              {workspace.settings.syncEnabled
                ? 'LiquidText-style syncing mode is enabled for this workspace.'
                : 'Enable syncing mode to prepare this workspace for cross-device sync.'}
            </span>
          </div>
          <button className="lt-primary-button" type="button" onClick={() => updateSyncEnabled(!workspace.settings.syncEnabled)}>
            {workspace.settings.syncEnabled ? 'Disable Syncing' : 'Enable Syncing'}
          </button>
        </SettingsFloatingMenu>
      ) : null}

      {activeMenu === 'workspaceLocation' ? (
        <SettingsFloatingMenu position={floatingPosition}>
          <div className="lt-submenu-title">Choose Layout</div>
          <OptionLine icon="▦" label="Beside Document" selected={arrangement === 'horizontal'} onClick={() => updateWorkspaceSetting('workspaceArrangement', 'horizontal')} />
          <OptionLine icon="▤" label="Below Document" selected={arrangement === 'vertical'} onClick={() => updateWorkspaceSetting('workspaceArrangement', 'vertical')} />
          <OptionLine icon="✣" label="Automatic" selected={arrangement === 'automatic'} onClick={() => updateWorkspaceSetting('workspaceArrangement', 'automatic')} />
        </SettingsFloatingMenu>
      ) : null}

      {activeMenu === 'multipleWorkspaceLayout' ? (
        <SettingsFloatingMenu position={floatingPosition}>
          <div className="lt-submenu-title">Choose Layout</div>
          <OptionLine icon="▥" label="Arrange Horizontally" selected={workspace.viewerLayout.multipleWorkspaceLayout === true} onClick={() => updateLayoutSetting('multipleWorkspaceLayout', true)} />
          <OptionLine icon="▤" label="Arrange Vertically" selected={workspace.viewerLayout.multipleWorkspaceLayout === false} onClick={() => updateLayoutSetting('multipleWorkspaceLayout', false)} />
        </SettingsFloatingMenu>
      ) : null}

      {activeMenu === 'multipleDocumentLayout' ? (
        <SettingsFloatingMenu position={floatingPosition}>
          <div className="lt-submenu-title">Choose Layout</div>
          <OptionLine icon="▥" label="Arrange Horizontally" selected={workspace.viewerLayout.multipleDocumentLayout === true} onClick={() => updateLayoutSetting('multipleDocumentLayout', true)} />
          <OptionLine icon="▤" label="Arrange Vertically" selected={workspace.viewerLayout.multipleDocumentLayout !== true} onClick={() => updateLayoutSetting('multipleDocumentLayout', false)} />
        </SettingsFloatingMenu>
      ) : null}

      {activeMenu === 'lockWorkspace' ? (
        <SettingsFloatingMenu position={floatingPosition}>
          <div className="lt-submenu-title">Options</div>
          <OptionLine label="Lock Objects in Workspace" description="Workspace objects are locked until you select them" selected={workspace.viewerLayout.workspaceLocked ?? false} onClick={() => updateLayoutSetting('workspaceLocked', true)} />
          <OptionLine label="Unlock Objects in Workspace" description="Workspace objects are unlocked" selected={!(workspace.viewerLayout.workspaceLocked ?? false)} onClick={() => updateLayoutSetting('workspaceLocked', false)} />
        </SettingsFloatingMenu>
      ) : null}

      {activeMenu === 'linkReferenceStyle' ? (
        <SettingsFloatingMenu className="lt-floating-menu--wide" position={floatingPosition}>
          <ToggleLine label="Limit Project and Doc Length" description="Limit document and project names in citations to 15 characters." value={workspace.limitProjectDocLength ?? false} onChange={() => updateWorkspaceSetting('limitProjectDocLength', !(workspace.limitProjectDocLength ?? false))} />
          <ToggleLine label="Abbreviate Document Name" description={'If a document is named "Example Earnings Report", reference links show "EER".'} value={workspace.abbreviateDocumentName ?? false} onChange={() => updateWorkspaceSetting('abbreviateDocumentName', !(workspace.abbreviateDocumentName ?? false))} />
          <ToggleLine label="Enclose in Parenthesis" description="Enclose the citation in parenthesis." value={workspace.encloseInParenthesis ?? false} onChange={() => updateWorkspaceSetting('encloseInParenthesis', !(workspace.encloseInParenthesis ?? false))} />
        </SettingsFloatingMenu>
      ) : null}

      {activeMenu === 'scrollWheel' ? (
        <SettingsFloatingMenu position={floatingPosition}>
          <div className="lt-submenu-title">Scroll-Wheel Options</div>
          <OptionLine label="Zoom Workspace" description="Mouse wheel over workspace zooms in or out." selected={scrollWheelBehavior === 'zoom'} onClick={() => updateWorkspaceSetting('scrollWheelBehavior', 'zoom')} />
          <OptionLine label="Scroll Workspace" description="Mouse wheel over workspace scrolls up or down." selected={scrollWheelBehavior === 'scroll'} onClick={() => updateWorkspaceSetting('scrollWheelBehavior', 'scroll')} />
          <ToggleLine label="Reverse scroll direction" value={workspace.reverseScrollDirection ?? false} onChange={() => updateWorkspaceSetting('reverseScrollDirection', !(workspace.reverseScrollDirection ?? false))} />
        </SettingsFloatingMenu>
      ) : null}

      {activeMenu === 'doubleClick' ? (
        <SettingsFloatingMenu position={floatingPosition}>
          <div className="lt-submenu-title">Double-Click Options</div>
          <OptionLine label="Select Excerpt Group" description="When double-clicking an excerpt, select the excerpt group." selected={excerptDoubleClickAction === 'selectGroup'} onClick={() => updateWorkspaceSetting('excerptDoubleClickAction', 'selectGroup')} />
          <OptionLine label="Follow Source Link" description="When double-clicking an excerpt, follow the source link." selected={excerptDoubleClickAction === 'followLink'} onClick={() => updateWorkspaceSetting('excerptDoubleClickAction', 'followLink')} />
        </SettingsFloatingMenu>
      ) : null}

      {activeMenu === 'penScrolling' ? (
        <SettingsFloatingMenu position={floatingPosition}>
          <div className="lt-submenu-title">Pen Scrolling Options</div>
          <OptionLine label="Scroll by Default" description="In Text Select mode, pen scrolls by default. Hold to select text." selected={penScrollingBehavior === 'scrollByDefault'} onClick={() => updateWorkspaceSetting('penScrollingBehavior', 'scrollByDefault')} />
          <OptionLine label="Select by Default" description="In Text Select mode, pen selects text by default." selected={penScrollingBehavior === 'selectByDefault'} onClick={() => updateWorkspaceSetting('penScrollingBehavior', 'selectByDefault')} />
        </SettingsFloatingMenu>
      ) : null}

      {showTagManager ? (
        <Modal title="Tag Manager" onClose={() => setShowTagManager(false)}>
          <ImprovedTagManagerModal workspace={workspace} record={record} onUpdateWorkspace={onUpdateWorkspace} onClose={() => setShowTagManager(false)} />
        </Modal>
      ) : null}
    </>
  )

}

type LtSettingsMenu =
  | null
  | 'definedTerms'
  | 'sync'
  | 'workspaceLocation'
  | 'multipleWorkspaceLayout'
  | 'multipleDocumentLayout'
  | 'lockWorkspace'
  | 'linkReferenceStyle'
  | 'scrollWheel'
  | 'doubleClick'
  | 'penScrolling'

function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="lt-settings-section">
      <div className="lt-settings-section-title">{title}</div>
      <div className="lt-settings-section-body">{children}</div>
    </section>
  )
}

function SettingsRow({
  icon,
  label,
  active,
  hasChevron,
  toggleValue,
  onToggle,
  onClick
}: {
  icon: ReactNode
  label: string
  active?: boolean
  hasChevron?: boolean
  toggleValue?: boolean
  onToggle?: () => void
  onClick?: (event: ReactMouseEvent<HTMLButtonElement>) => void
}) {
  const isToggle = typeof toggleValue === 'boolean'
  return (
    <button type="button" className={`lt-settings-row ${active ? 'is-active' : ''}`} onClick={isToggle ? onToggle : onClick}>
      <span className="lt-settings-icon">{icon}</span>
      <span className="lt-settings-label">{label}</span>
      {isToggle ? (
        <span className={`lt-settings-toggle ${toggleValue ? 'is-on' : ''}`}><span /></span>
      ) : hasChevron ? (
        <span className="lt-settings-chevron">›</span>
      ) : null}
    </button>
  )
}

function SettingsFloatingMenu({
  className = '',
  position,
  children
}: {
  className?: string
  position: { top: number; right: number }
  children: ReactNode
}) {
  return (
    <div className={`lt-floating-menu ${className}`} style={{ top: position.top, right: position.right }}>
      {children}
    </div>
  )
}

function OptionLine({
  icon,
  label,
  description,
  selected,
  onClick
}: {
  icon?: ReactNode
  label: string
  description?: string
  selected?: boolean
  onClick: () => void
}) {
  return (
    <button type="button" className={`lt-option-row ${selected ? 'is-selected' : ''}`} onClick={onClick}>
      <span>
        {icon ? <span className="lt-option-icon">{icon}</span> : null}
        <span className="lt-option-label">{label}</span>
        {description ? <span className="lt-option-description">{description}</span> : null}
      </span>
      {selected ? <span className="lt-checkmark">✓</span> : null}
    </button>
  )
}

function ActionLine({
  title,
  description,
  active,
  onClick
}: {
  title: string
  description?: string
  active?: boolean
  onClick: () => void
}) {
  return (
    <button type="button" className={`lt-action-row ${active ? 'is-selected' : ''}`} onClick={onClick}>
      <span>
        <span className="lt-action-title">{title}</span>
        {description ? <span className="lt-action-description">{description}</span> : null}
      </span>
      {active ? <span className="lt-checkmark">✓</span> : null}
    </button>
  )
}

function ToggleLine({
  label,
  description,
  value,
  onChange
}: {
  label: string
  description?: string
  value: boolean
  onChange: () => void
}) {
  return (
    <button type="button" className="lt-toggle-line" onClick={onChange}>
      <span>
        <span className="lt-option-label">{label}</span>
        {description ? <span className="lt-option-description">{description}</span> : null}
      </span>
      <span className={`lt-settings-toggle ${value ? 'is-on' : ''}`}><span /></span>
    </button>
  )
}


const PAGE_EDIT_TABS = [
  { key: 'insert', label: 'Insert Pages' },
  { key: 'delete', label: 'Delete Pages' },
  { key: 'rotate', label: 'Rotate Pages' },
  { key: 'edit', label: 'Extract Pages' }
] as const

function PageEditorThumbnail({
  page,
  pageNumber,
  rotation = 0
}: {
  page: PDFPageProxy
  pageNumber: number
  rotation?: number
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    let cancelled = false
    const viewport = page.getViewport({ scale: 0.22, rotation })
    const context = canvas.getContext('2d')
    if (!context) return

    canvas.width = viewport.width
    canvas.height = viewport.height
    canvas.style.width = `${viewport.width}px`
    canvas.style.height = `${viewport.height}px`

    const task = page.render({ canvas, canvasContext: context, viewport })

    task.promise.catch((error) => {
      if (!cancelled && !isExpectedPdfCancellation(error)) console.error(`Failed thumbnail page ${pageNumber}:`, error)
    })

    return () => {
      cancelled = true
      try {
        task.cancel()
      } catch (error) {
        if (!isExpectedPdfCancellation(error)) console.error(`Failed to cancel thumbnail page ${pageNumber}:`, error)
      }
    }
  }, [page, pageNumber, rotation])

  return <canvas className="page-editor-thumbnail-canvas" ref={canvasRef} />
}

function PageEditPanel({
  pages,
  pageCount,
  currentPage,
  deletedPages,
  rotations,
  onGoToPage,
  onRotateCurrent,
  onRotateAll,
  onInsertPage,
  onDeletePage,
  onExtractPage
}: {
  pages?: PDFPageProxy[]
  pageCount: number
  currentPage: number
  deletedPages: Set<number>
  rotations: Record<number, number>
  onGoToPage: (pageNumber: number) => void
  onRotateCurrent: (degrees: 90 | -90 | 180, pageNumber: number) => void
  onRotateAll: (degrees: 90 | -90 | 180) => void
  onInsertPage: (pageNumber: number) => void
  onDeletePage: (pageNumber: number) => void
  onExtractPage: (pageNumber: number) => void
}) {
  const [selectedPage, setSelectedPage] = useState(currentPage)
  const [actionMode, setActionMode] = useState<'insert' | 'edit' | 'delete' | 'rotate' | null>(null)
  const [visibleActionMode, setVisibleActionMode] = useState<'insert' | 'edit' | 'delete' | 'rotate' | null>(null)
  const [sectionClosing, setSectionClosing] = useState(false)

  const selectedRotation = rotations[selectedPage] ?? 0
  const selectedDeleted = deletedPages.has(selectedPage)

  function openAction(mode: 'insert' | 'edit' | 'delete' | 'rotate') {
    if (visibleActionMode === mode && !sectionClosing) {
      closeAction()
      return
    }

    if (visibleActionMode === 'rotate' && mode !== 'rotate') {
      setSectionClosing(true)
      setActionMode(mode)
      window.setTimeout(() => {
        setVisibleActionMode(mode)
        setSectionClosing(false)
      }, 240)
      return
    }

    setSectionClosing(false)
    setActionMode(mode)
    setVisibleActionMode(mode)
  }

  function closeAction() {
    if (!visibleActionMode) return
    setSectionClosing(true)
    window.setTimeout(() => {
      setVisibleActionMode(null)
      setActionMode(null)
      setSectionClosing(false)
    }, 240)
  }

  useEffect(() => {
    if (visibleActionMode !== 'rotate' || sectionClosing) return

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Element | null
      if (target?.closest('.mobile-page-editor-section')) return
      if (target?.closest('.mobile-page-editor-mode-tabs')) return
      closeAction()
    }

    document.addEventListener('pointerdown', handlePointerDown, true)
    return () => document.removeEventListener('pointerdown', handlePointerDown, true)
  }, [visibleActionMode, sectionClosing])

  return (
    <div className="mobile-page-editor-modal">
      <div className="mobile-page-editor-content">
        <div className="mobile-page-editor-top">
          <div>
            <span className="mobile-page-editor-kicker">Selected</span>
            <strong>Page {selectedPage}</strong>
            <small>{selectedDeleted ? 'Marked deleted' : `${selectedRotation}° rotation`}</small>
          </div>
          <div className="mobile-page-editor-mode-tabs" role="tablist" aria-label="Page edit actions">
            {PAGE_EDIT_TABS.map((tab) => (
              <button
                key={tab.key}
                className={actionMode === tab.key && !sectionClosing ? 'is-active' : ''}
                type="button"
                onClick={() => {
                  if (tab.key === 'insert') {
                    onInsertPage(selectedPage)
                    openAction(tab.key)
                    return
                  }
                  if (tab.key === 'delete') {
                    onDeletePage(selectedPage)
                    openAction(tab.key)
                    return
                  }
                  if (tab.key === 'edit') {
                    onExtractPage(selectedPage)
                    openAction(tab.key)
                    return
                  }
                  openAction(tab.key)
                }}
              >
                {tab.label}
              </button>
            ))}

            <button className="page-editor-select-all" type="button" onClick={() => setSelectedPage(1)}>
              Select All
            </button>
          </div>
        </div>
        <div className="mobile-page-editor-pages" aria-label="Pages">
          {Array.from({ length: pageCount }, (_, index) => {
            const pageNumber = index + 1
            const isDeleted = deletedPages.has(pageNumber)
            return (
              <button
                key={pageNumber}
                className={`mobile-page-card${pageNumber === selectedPage ? ' is-active' : ''}${isDeleted ? ' is-deleted' : ''}`}
                type="button"
                onClick={() => setSelectedPage(pageNumber)}
                onDoubleClick={() => onGoToPage(pageNumber)}
              >
                <span className="page-editor-thumb">
                  {pages?.[index] && !isDeleted ? (
                    <PageEditorThumbnail
                      page={pages[index]}
                      pageNumber={pageNumber}
                      rotation={rotations[pageNumber] ?? 0}
                    />
                  ) : (
                    <span className="page-editor-blank-thumb" />
                  )}
                  <em className="page-editor-check" aria-hidden="true" />
                </span>
                <strong>{pageNumber}</strong>
              </button>
            )
          })}
        </div>
        {visibleActionMode === 'rotate' ? (
          <section className={`mobile-page-editor-section${sectionClosing ? ' is-fading-out' : ''}`}>
            <h4>Rotate Pages</h4>
            <div className="mobile-page-editor-actions">
              <button type="button" onClick={() => onRotateCurrent(90, selectedPage)}>Rotate 90° Clockwise</button>
              <button type="button" onClick={() => onRotateCurrent(-90, selectedPage)}>Rotate 90° Anticlockwise</button>
              <button type="button" onClick={() => onRotateCurrent(180, selectedPage)}>Rotate 180° Clockwise</button>
              <button type="button" onClick={() => onRotateAll(90)}>Apply to All Pages (90° CW)</button>
            </div>
            <p className="mobile-settings-hint">Selected page {selectedPage}: {selectedRotation}°</p>
          </section>
        ) : null}
      </div>
    </div>
  )
}

function ImprovedTagManagerModal({
  workspace,
  record,
  onUpdateWorkspace,
  onClose
}: {
  workspace: MobileWorkspaceState
  record: MobileDocumentRecord
  onUpdateWorkspace: (updater: (current: MobileWorkspaceState) => MobileWorkspaceState) => void
  onClose: () => void
}) {
  const [category, setCategory] = useState('')
  const [name, setName] = useState('')
  const [color, setColor] = useState('#c8ff8a')
  const [editingTagId, setEditingTagId] = useState<string | null>(null)
  const [editCategory, setEditCategory] = useState('')
  const [editName, setEditName] = useState('')
  const tags = workspace.globalTags ?? []
  const taggedAnchors = workspace.anchors
    .filter((anchor) => anchor.documentId === record.document.id && (anchor.tags?.length ?? 0) > 0)
    .flatMap((anchor) => (anchor.tags ?? []).map((tag) => ({
      id: `${anchor.id}-${tag}`,
      tag,
      color: getTagColor(tag),
      pageNumber: anchor.pageNumber,
      text: cleanTagSentence(anchor.textQuote)
    })))
  const taggedNodes = workspace.nodes
    .filter((node) => node.documentId === record.document.id && (node.tags?.length ?? 0) > 0)
    .flatMap((node) => (node.tags ?? []).map((tag) => ({
      id: `${node.id}-${tag}`,
      tag,
      color: node.nodeColor ?? node.selectionColor ?? '#c8ff8a',
      pageNumber: undefined,
      text: cleanTagSentence(node.text || node.title || 'Workspace note')
    })))
  const documentTagAllocations = [...taggedAnchors, ...taggedNodes]

  function addTag() {
    const nextCategory = category.trim()
    const nextName = name.trim()
    if (!nextCategory || !nextName) return
    const now = new Date().toISOString()
    const tag: TagDefinition = {
      id: crypto.randomUUID(),
      category: nextCategory,
      name: nextName,
      color,
      createdAt: now,
      updatedAt: now
    }
    onUpdateWorkspace((current) => ({
      ...current,
      globalTags: [...(current.globalTags ?? []), tag],
      updatedAt: now
    }))
    setCategory('')
    setName('')
  }

  function startEditing(tag: TagDefinition) {
    setEditingTagId(tag.id)
    setEditCategory(tag.category)
    setEditName(tag.name)
  }

  function saveEditing() {
    const nextCategory = editCategory.trim()
    const nextName = editName.trim()
    if (!editingTagId || !nextCategory || !nextName) return
    const now = new Date().toISOString()
    onUpdateWorkspace((current) => ({
      ...current,
      globalTags: (current.globalTags ?? []).map((tag) =>
        tag.id === editingTagId ? { ...tag, category: nextCategory, name: nextName, updatedAt: now } : tag
      ),
      updatedAt: now
    }))
    setEditingTagId(null)
    setEditCategory('')
    setEditName('')
  }

  function deleteTag(tagId: string) {
    onUpdateWorkspace((current) => ({
      ...current,
      globalTags: (current.globalTags ?? []).filter((tag) => tag.id !== tagId),
      updatedAt: new Date().toISOString()
    }))
  }

  return (
    <div className="lt-tag-manager-content">
      <div className="lt-tag-manager-body">
      <section className="tag-manager-create">
        <h4>Create New Tag</h4>
        <div className="tag-manager-form">
          <input className="tag-color-input" type="color" aria-label="Tag color" value={color} onChange={(e) => setColor(e.target.value)} />
          <input value={category} placeholder="Category" onChange={(e) => setCategory(e.target.value)} />
          <input value={name} placeholder="Name" onChange={(e) => setName(e.target.value)} />
          <button className="tag-add-button" type="button" onClick={addTag}>Add</button>
        </div>
      </section>
      <section className="tag-manager-edit">
        <h4>Edit Existing tags</h4>
        <div className="tag-manager-list">
          {tags.length === 0 && <p className="empty-message">No tags created yet.</p>}
          {tags.map((tag) => (
            <div key={tag.id} className="tag-manager-item">
              {editingTagId === tag.id ? (
                <>
                  <span className="tag-color-chip" style={{ background: tag.color ?? '#c8ff8a' }} />
                  <input value={editCategory} onChange={(e) => setEditCategory(e.target.value)} />
                  <input value={editName} onChange={(e) => setEditName(e.target.value)} />
                  <button onClick={saveEditing}>Save</button>
                  <button onClick={() => setEditingTagId(null)}>Cancel</button>
                </>
              ) : (
                <>
                  <span className="tag-color-chip" style={{ background: tag.color ?? '#c8ff8a' }} />
                  <strong>{tag.category}</strong>
                  <span>{tag.name}</span>
                  <button onClick={() => startEditing(tag)}>Edit</button>
                  <button onClick={() => deleteTag(tag.id)}>Delete</button>
                </>
              )}
            </div>
          ))}
        </div>
      </section>
      <section className="tag-manager-document-tags">
        <h4>Tags in this document</h4>
        <div className="tag-manager-allocation-list">
          {documentTagAllocations.length === 0 && <p className="empty-message">No document text tagged yet.</p>}
          {documentTagAllocations.map((entry) => (
            <div key={entry.id} className="tag-manager-allocation-item">
              <span className="tag-color-chip" style={{ background: entry.color }} />
              <strong>{tagDisplayLabel(entry.tag)}</strong>
              <span className="tag-manager-allocation-text">
                {entry.pageNumber ? `Page ${entry.pageNumber} · ` : ''}{entry.text}
              </span>
            </div>
          ))}
        </div>
      </section>
      </div>
      <div className="lt-tag-manager-footer">
        <button type="button" onClick={onClose}>Save</button>
        <button type="button" onClick={onClose}>Cancel</button>
      </div>
    </div>
  )
}


function ImprovedDefinedTermsModal({
  workspace,
  onUpdateWorkspace,
  onClose
}: {
  workspace: MobileWorkspaceState
  onUpdateWorkspace: (updater: (current: MobileWorkspaceState) => MobileWorkspaceState) => void
  onClose: () => void
}) {
  return (
    <div className="improved-modal-content">
      <div className="defined-row">
        <label className="toggle-switch">
          <input
            type="checkbox"
            checked={workspace.showDefinedTermsAttachments ?? true}
            onChange={(e) => onUpdateWorkspace((current) => ({ ...current, showDefinedTermsAttachments: e.target.checked, updatedAt: new Date().toISOString() }))}
          />
          <span className="toggle-slider"></span>
          <span className="toggle-label">Show Defined Terms, Attachments</span>
        </label>
        <span className="badge-disabled">Parsing Disabled</span>
      </div>
      <p className="settings-hint">Term extraction and attachment detection are ready for UI review; parsing logic can be connected later.</p>
      <div className="modal-footer">
        <button className="mobile-secondary-button" onClick={onClose}>Close</button>
      </div>
    </div>
  )
}

function ImprovedScrollWheelOptionsPopup({
  workspace,
  onUpdateWorkspace,
  onClose
}: {
  workspace: MobileWorkspaceState
  onUpdateWorkspace: (updater: (current: MobileWorkspaceState) => MobileWorkspaceState) => void
  onClose: () => void
}) {
  const behavior = workspace.scrollWheelBehavior ?? 'zoom'

  return (
    <div className="improved-popup-content">
      <div className="radio-group-stack">
        <label className="radio-card">
          <input type="radio" checked={behavior === 'zoom'} onChange={() => onUpdateWorkspace((c) => ({ ...c, scrollWheelBehavior: 'zoom', updatedAt: new Date().toISOString() }))} />
          <div>
            <strong>Zoom Workspace</strong>
            <span>When moving the scroll-wheel on your mouse while over the workspace, the workspace will zoom in or out.</span>
          </div>
        </label>
        <label className="radio-card">
          <input type="radio" checked={behavior === 'scroll'} onChange={() => onUpdateWorkspace((c) => ({ ...c, scrollWheelBehavior: 'scroll', updatedAt: new Date().toISOString() }))} />
          <div>
            <strong>Scroll Workspace</strong>
            <span>When moving the scroll-wheel on your mouse while over the workspace, the workspace will scroll up or down.</span>
          </div>
        </label>
      </div>
      <label className="toggle-switch">
        <input type="checkbox" checked={workspace.reverseScrollDirection ?? false} onChange={(e) => onUpdateWorkspace((c) => ({ ...c, reverseScrollDirection: e.target.checked, updatedAt: new Date().toISOString() }))} />
        <span className="toggle-slider"></span>
        <span className="toggle-label">Reverse scroll direction</span>
      </label>
      <div className="modal-footer">
        <button className="mobile-secondary-button" onClick={onClose}>Close</button>
      </div>
    </div>
  )
}

function ImprovedExcerptDoubleClickPopup({
  workspace,
  onUpdateWorkspace,
  onClose
}: {
  workspace: MobileWorkspaceState
  onUpdateWorkspace: (updater: (current: MobileWorkspaceState) => MobileWorkspaceState) => void
  onClose: () => void
}) {
  const action = workspace.excerptDoubleClickAction ?? 'selectGroup'

  return (
    <div className="improved-popup-content">
      <div className="radio-group-stack">
        <label className="radio-card">
          <input type="radio" checked={action === 'selectGroup'} onChange={() => onUpdateWorkspace((c) => ({ ...c, excerptDoubleClickAction: 'selectGroup', updatedAt: new Date().toISOString() }))} />
          <div>
            <strong>Select Excerpt Group</strong>
            <span>When double-clicking an excerpt, select the excerpt group.</span>
          </div>
        </label>
        <label className="radio-card">
          <input type="radio" checked={action === 'followLink'} onChange={() => onUpdateWorkspace((c) => ({ ...c, excerptDoubleClickAction: 'followLink', updatedAt: new Date().toISOString() }))} />
          <div>
            <strong>Follow Source Link</strong>
            <span>When double-clicking an excerpt, follow the source link.</span>
          </div>
        </label>
      </div>
      <div className="modal-footer">
        <button className="mobile-secondary-button" onClick={onClose}>Close</button>
      </div>
    </div>
  )
}

function ImprovedPenScrollingPopup({
  workspace,
  onUpdateWorkspace,
  onClose
}: {
  workspace: MobileWorkspaceState
  onUpdateWorkspace: (updater: (current: MobileWorkspaceState) => MobileWorkspaceState) => void
  onClose: () => void
}) {
  const behavior = workspace.penScrollingBehavior ?? 'scrollByDefault'

  return (
    <div className="improved-popup-content">
      <div className="radio-group-stack">
        <label className="radio-card">
          <input type="radio" checked={behavior === 'scrollByDefault'} onChange={() => onUpdateWorkspace((c) => ({ ...c, penScrollingBehavior: 'scrollByDefault', updatedAt: new Date().toISOString() }))} />
          <div>
            <strong>Scroll by Default</strong>
            <span>In Text Select mode, the pen will scroll the document by default. Hold for a moment to select text.</span>
          </div>
        </label>
        <label className="radio-card">
          <input type="radio" checked={behavior === 'selectByDefault'} onChange={() => onUpdateWorkspace((c) => ({ ...c, penScrollingBehavior: 'selectByDefault', updatedAt: new Date().toISOString() }))} />
          <div>
            <strong>Select by Default</strong>
            <span>In Text Select mode, the pen will select text if you drag it over the document.</span>
          </div>
        </label>
      </div>
      <div className="modal-footer">
        <button className="mobile-secondary-button" onClick={onClose}>Close</button>
      </div>
    </div>
  )
}

function ImprovedChooseLayoutPopup({
  workspace,
  onUpdateWorkspace,
  onClose
}: {
  workspace: MobileWorkspaceState
  onUpdateWorkspace: (updater: (current: MobileWorkspaceState) => MobileWorkspaceState) => void
  onClose: () => void
}) {
  const arrangement = workspace.workspaceArrangement ?? 'automatic'

  return (
    <div className="improved-popup-content">
      <div className="radio-group-stack">
        <label className="radio-card">
          <input type="radio" checked={arrangement === 'horizontal'} onChange={() => onUpdateWorkspace((c) => ({ ...c, workspaceArrangement: 'horizontal', updatedAt: new Date().toISOString() }))} />
          <div>
            <strong>Arrange Horizontally</strong>
            <span>Nodes will be placed side by side.</span>
          </div>
        </label>
        <label className="radio-card">
          <input type="radio" checked={arrangement === 'vertical'} onChange={() => onUpdateWorkspace((c) => ({ ...c, workspaceArrangement: 'vertical', updatedAt: new Date().toISOString() }))} />
          <div>
            <strong>Arrange Vertically</strong>
            <span>Nodes will be stacked from top to bottom.</span>
          </div>
        </label>
        <label className="radio-card">
          <input type="radio" checked={arrangement === 'automatic'} onChange={() => onUpdateWorkspace((c) => ({ ...c, workspaceArrangement: 'automatic', updatedAt: new Date().toISOString() }))} />
          <div>
            <strong>Automatic</strong>
            <span>Smart arrangement based on available space.</span>
          </div>
        </label>
      </div>
      <div className="modal-footer">
        <button className="mobile-secondary-button" onClick={onClose}>Close</button>
      </div>
    </div>
  )
}

function SelectionActionPopup({
  popup,
  bookmarked,
  availableTags,
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
  availableTags: string[]
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
  const [placement, setPlacement] = useState<SelectionPopupPlacement>('clamped')
  const [popupSize, setPopupSize] = useState({ width: 0, height: 0 })
  const swatches = ['#ff6b6b', '#2ecc71', '#5d5df6', '#ffd400', '#db38ff', '#00b8d9']
  const tags = parseTagInput(tagDraft)
  const allocatedTags = popup.tags

  useEffect(() => {
    setExpanded(false)
    setMoreOpen(false)
    setTagDraft(popup.tagDraft || popup.tags.join(', '))
  }, [popup.selection.text, popup.tagDraft, popup.tags])
  
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
      Math.abs(current.left - next.left) < 0.5 && Math.abs(current.top - next.top) < 0.5
        ? current
        : { left: next.left, top: next.top }
    )
    setPlacement(next.placement)
  }, [popupSize, popup.left, popup.top, popup.selectionRect])

  function handleClearPointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault()
    event.stopPropagation()
    onClear()
  }

  function commitPopupTags(nextTags = tags) {
    onTags(nextTags)
    setTagDraft(nextTags.join(', '))
  }

  return (
    <aside ref={popupRef} className={`mobile-selection-popup selection-action-popup ${expanded ? 'is-mobile-expanded' : 'is-mobile-compact'} is-placed-${placement}`} style={{ left: position.left, top: position.top, borderColor: `${popup.color ?? '#5d5df6'}55`, boxShadow: `0 22px 45px ${popup.color ?? '#5d5df6'}22` }}>
      <div className="selection-action-header">
        <div className="mobile-selection-actions selection-action-row">
          <button className="selection-action-pill selection-action-pill-primary" style={{ background: popup.color ?? '#5d5df6' }} type="button" onClick={onExcerpt}>Auto Excerpt</button>
          <button className="selection-action-pill" type="button" onClick={onComment}>Comment</button>
          <button className="selection-action-pill" type="button" onClick={onBookmark}>{bookmarked ? 'Remove Bookmark' : 'Bookmark'}</button>
          <button className="selection-action-pill" type="button" onClick={() => { setExpanded(true); commitPopupTags(tags) }}>Tag</button>
          <button className="selection-action-pill" type="button" onPointerDown={handleClearPointerDown}>Clear</button>
          <div className="selection-action-more">
            <button className="selection-action-pill" type="button" onClick={() => { setExpanded(true); setMoreOpen((current) => !current) }}>...</button>
            {moreOpen ? (
              <div className="selection-action-menu">
                <div className="selection-action-menu-inner">
                  <button className="selection-action-menu-item" type="button" onClick={onCopy}>Copy</button>
                  <button className="selection-action-menu-item" type="button" onClick={() => { onClearTags(); setTagDraft(''); setMoreOpen(false) }}>Clear Tags</button>
                  <button className="selection-action-menu-item" type="button" onClick={() => { commitPopupTags(Array.from(new Set([...allocatedTags, 'defined-term']))); setMoreOpen(false) }}>Add Defined Term</button>
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
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  commitPopupTags(tags)
                }
              }}
            />
          </label>
        </div>
        <div className="selection-action-tag-summary" aria-live="polite">
          <div className="selection-action-tag-summary-label">Allocated tags</div>
          {allocatedTags.length ? (
            <div className="selection-action-tag-active-list">
              {allocatedTags.map((tag) => (
                <button key={tag} type="button" className="selection-action-tag-active" style={{ background: getTagColor(tag), borderColor: getTagColor(tag) }} onClick={() => commitPopupTags(allocatedTags.filter((entry) => entry !== tag))}>
                  #{tag}<span>×</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="selection-action-tag-empty">No tags allocated</div>
          )}
          <div className="selection-action-tag-presets" aria-label="Suggested tags">
            {availableTags.map((tag) => {
              const active = allocatedTags.includes(tag)
              return (
                <button key={tag} type="button" className={`selection-action-tag-preset${active ? ' is-active' : ''}`} onClick={() => {
                  const next = active ? allocatedTags.filter((entry) => entry !== tag) : Array.from(new Set([...allocatedTags, tag]))
                  commitPopupTags(next)
                }}>
                  #{tag}
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </aside>
  )
}

const TAG_PRESETS = ['important', 'question', 'evidence', 'counterpoint', 'defined-term', 'follow-up']

function parseTagInput(value: string) {
  return Array.from(new Set(value.split(',').map((tag) => tag.trim().replace(/^#/, '')).filter(Boolean)))
}

function getTagColor(tag: string) {
  const normalized = tag.toLowerCase()
  if (normalized.includes('important')) return '#ef4444'
  if (normalized.includes('question')) return '#f59e0b'
  if (normalized.includes('evidence')) return '#5d5df6'
  if (normalized.includes('counterpoint')) return '#8b5cf6'
  if (normalized.includes('defined')) return '#0ea5e9'
  if (normalized.includes('follow')) return '#10b981'
  return '#5d5df6'
}

function cleanTagSentence(value: string) {
  return value.replace(/\s+/g, ' ').replace(/^[·\-\s]+/, '').trim()
}

type IconName = 'home' | 'back' | 'forward' | 'select' | 'pen' | 'pencil' | 'highlighter' | 'eraser' | 'undo' | 'trash' | 'close' | 'more' | 'textbox' | 'outline' | 'bookmark' | 'docs' | 'highlightView' | 'editPages'

function Icon({ name }: { name: IconName }) {
  const common = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true }
  if (name === 'home') return <svg {...common}><path d="m3 11 9-8 9 8" /><path d="M5 10v10h14V10" /><path d="M10 20v-6h4v6" /></svg>
  if (name === 'back') return <svg {...common}><path d="m15 18-6-6 6-6" /></svg>
  if (name === 'forward') return <svg {...common}><path d="m9 18 6-6-6-6" /></svg>
  if (name === 'pen') return <svg {...common}><path d="m12 20 9-9-4-4-9 9-2 6 6-2Z" /><path d="m15 8 1 1" /></svg>
  if (name === 'pencil') return <svg {...common}><path d="m18 2 4 4" /><path d="m3 21 4.5-1 12-12-3.5-3.5-12 12L3 21Z" /><path d="m14 6 4 4" /></svg>
  if (name === 'highlighter') return <svg {...common}><path d="m9 11 6 6" /><path d="m4 20 4-1 10-10-3-3L5 16l-1 4Z" /><path d="m14 5 5 5" /></svg>
  if (name === 'eraser') return <svg {...common}><path d="m7 21-4-4 11-11 7 7-8 8H7Z" /><path d="M14 21h7" /></svg>
  if (name === 'undo') return <svg {...common}><path d="M9 14 4 9l5-5" /><path d="M4 9h10a6 6 0 1 1-4.25 10.25" /></svg>
  if (name === 'trash') return <svg {...common}><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="m6 6 1 15h10l1-15" /><path d="M10 11v6" /><path d="M14 11v6" /></svg>
  if (name === 'close') return <svg {...common}><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
  if (name === 'textbox') return <svg {...common}><path d="M4 20 10 4h4l6 16" /><path d="M7 14h10" /></svg>
  if (name === 'highlightView') return <svg {...common}><path d="m7 7-2 2-2-2" /><path d="M10 8h10" /><path d="m7 17-2-2-2 2" /><path d="M10 16h10" /></svg>
  if (name === 'editPages') return <svg {...common}><rect x="4" y="4" width="6" height="6" /><rect x="14" y="4" width="6" height="6" /><rect x="4" y="14" width="6" height="6" /><rect x="14" y="14" width="6" height="6" /></svg>
  if (name === 'outline') return <svg {...common}><path d="M4 7h2" /><path d="M4 12h2" /><path d="M4 17h2" /><path d="M10 7h10" /><path d="M10 12h10" /><path d="M10 17h10" /></svg>
  if (name === 'bookmark') return <svg {...common}><path d="M6 4h12v18l-6-4-6 4V4Z" /><path d="M12 8v6" /><path d="M9 11h6" /></svg>
  if (name === 'docs') return <svg {...common}><path d="M6 3h9l3 3v15H6V3Z" /><path d="M14 3v4h4" /><path d="M9 13h6" /><path d="M12 10v6" /></svg>
  if (name === 'more') return <svg {...common}><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></svg>
  return <svg {...common}><path d="M4 4 14 20l2-7 6-2L4 4Z" /></svg>
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

function updateReadableSelectionMagnifier(
  root: HTMLElement | null,
  selectionColor: string,
  setMagnifier: (next: SourceSelectionMagnifierState | null) => void
) {
  const selection = document.getSelection()
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    setMagnifier(null)
    return
  }
  const text = selection.toString().replace(/\s+/g, ' ').trim()
  if (!text) {
    setMagnifier(null)
    return
  }
  if (!root) {
    setMagnifier(null)
    return
  }
  const range = selection.getRangeAt(0)
  const startElement = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement
  const endElement = range.endContainer instanceof Element ? range.endContainer : range.endContainer.parentElement
  const belongsToRoot = Boolean(root && ((startElement && root.contains(startElement)) || (endElement && root.contains(endElement))))
  if (!belongsToRoot || (!startElement?.closest('.mobile-readable-page') && !endElement?.closest('.mobile-readable-page'))) {
    setMagnifier(null)
    return
  }

  const selectionClientRects = Array.from(range.getClientRects()).filter((box) => box.width > 1 && box.height > 1)
  const rect = buildUnionRect(selectionClientRects) ?? range.getBoundingClientRect()
  if (!rect || rect.width <= 0 || rect.height <= 0) {
    setMagnifier(null)
    return
  }
  const rootRect = root.getBoundingClientRect()
  const tallestSelectionLine = Math.max(...selectionClientRects.map((box) => box.height), rect.height)
  const selectionLeft = selectionClientRects.length ? Math.min(...selectionClientRects.map((box) => box.left)) : rect.left
  const selectionTop = selectionClientRects.length ? Math.min(...selectionClientRects.map((box) => box.top)) : rect.top
  const selectionRight = selectionClientRects.length ? Math.max(...selectionClientRects.map((box) => box.right)) : rect.right
  const loupeWidth = Math.min(Math.max(160, root.clientWidth - 24), Math.max(180, rect.width + 52))
  const loupeMaxWidth = Math.min(Math.max(220, root.clientWidth - 24), 360)
  const loupeFontSize = Math.max(18, Math.min(30, tallestSelectionLine * 1.18))
  const loupeHeightEstimate = loupeFontSize * 2.7 + 28
  const preferredLeft = selectionLeft + (selectionRight - selectionLeft) / 2 - loupeWidth / 2
  const preferredAboveTop = selectionTop - loupeHeightEstimate - 8
  const left = Math.max(rootRect.left + 12, Math.min(rootRect.right - loupeWidth - 12, preferredLeft))
  const top = preferredAboveTop >= rootRect.top + 12
    ? preferredAboveTop
    : Math.min(rootRect.bottom - loupeHeightEstimate - 12, rect.bottom + 18)

  setMagnifier({
    text: text.length > 160 ? `${text.slice(0, 157)}...` : text,
    left,
    top: Math.max(12, top),
    selectionColor,
    width: loupeWidth,
    maxWidth: loupeMaxWidth,
    fontSize: loupeFontSize
  })
}

function SourceSelectionMagnifierLens({ magnifier }: { magnifier: SourceSelectionMagnifierState }) {
  const style = {
    left: magnifier.left,
    top: magnifier.top,
    '--selection-loupe-width': `${magnifier.width}px`,
    '--selection-loupe-max-width': `${magnifier.maxWidth}px`,
    '--selection-loupe-font-size': `${magnifier.fontSize}px`,
    borderColor: `${magnifier.selectionColor}66`,
    boxShadow: `0 16px 28px ${magnifier.selectionColor}24`
  } as CSSProperties

  return (
    <div className="document-selection-loupe" style={style}>
      <div className="document-selection-loupe-copy" style={{ color: magnifier.selectionColor }}>
        {magnifier.text}
      </div>
    </div>
  )
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

function findAnnotatedPageFromPointer(event: React.PointerEvent<HTMLElement>) {
  return findAnnotatedPage(event.target) ?? findAnnotatedPage(document.elementFromPoint(event.clientX, event.clientY))
}

