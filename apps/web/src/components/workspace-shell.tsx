'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { Bookmark, CanvasEdge, CanvasNode, Excerpt, Note, PageAnchor, TextStyle } from '@workspace/domain'
import { buildBookmark, buildExcerpt, buildPageAnchor, type SelectionArtifactInput } from '../lib/excerpts/pdf-selection'
import { loadWorkspaceState, persistWorkspaceState } from '../lib/indexeddb/local-cache'
import type { PersistedPdfDocument, WorkspacePersistenceState } from '../lib/workspace/workspace-state'
import { createCanvasNode } from '../lib/workspace/canvas-node-crud'
import { buildSourceHighlightDescriptors } from '../lib/workspace/source-highlight-descriptors'
import { buildWorkspaceNodeLink, type WorkspaceNodeLink } from '../lib/workspace/node-links'
import { WorkspaceCanvas } from './workspace/WorkspaceCanvas'
import { WorkspaceTextToolbar } from './workspace/WorkspaceTextToolbar'
import { PdfViewer } from './pdf/pdf-viewer'
import { LinkLayer } from './workspace/LinkLayer'
import type { AnchorViewportMetric } from './pdf/AnchorService'

const WORKSPACE_ID = 'workspace-1'
const STANDARD_TAGS = ['important', 'question', 'evidence', 'counterpoint', 'defined-term', 'follow-up']

const seedNote: Note = {
  id: 'note-1',
  workspaceId: WORKSPACE_ID,
  title: 'Synthesis',
  excerptIds: [],
  documentIds: [],
  prosemirrorJson: { type: 'doc', content: [{ type: 'paragraph' }] },
  x: 148,
  y: 124,
  width: 420,
  height: 280,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
}

const defaultTextStyle: TextStyle = {
  preset: 'body',
  fontFamily: '"Segoe UI", system-ui, sans-serif',
  fontSize: 16,
  fontWeight: 'normal',
  fontStyle: 'normal',
  underline: false,
  strikethrough: false
}

const DEFAULT_WORKSPACE_VIEWPORT: { panX: number; panY: number; zoom: number } = {
  panX: 92,
  panY: 72,
  zoom: 1
}
type ZoomPane = 'document' | 'workspace'

function upsertById<T extends { id: string }>(items: T[], nextItem: T) {
  const existing = items.find((item) => item.id === nextItem.id)
  if (!existing) {
    return [...items, nextItem]
  }

  return items.map((item) => (item.id === nextItem.id ? nextItem : item))
}

function rectanglesOverlap(
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number }
) {
  return !(
    left.x + left.width <= right.x ||
    left.x >= right.x + right.width ||
    left.y + left.height <= right.y ||
    left.y >= right.y + right.height
  )
}

interface TagIndexEntry {
  highlights: string[]
  excerpts: string[]
  comments: string[]
  bookmarks: string[]
}

export function WorkspaceShell() {
  const shellRef = useRef<HTMLElement | null>(null)
  const workspacePaneRef = useRef<HTMLElement | null>(null)
  const documentPaneRef = useRef<HTMLElement | null>(null)
  const splitResizeRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const activeZoomPaneRef = useRef<ZoomPane>('workspace')
  const [documentState, setDocumentState] = useState<PersistedPdfDocument | null>(null)
  const [anchors, setAnchors] = useState<PageAnchor[]>([])
  const [excerpts, setExcerpts] = useState<Excerpt[]>([])
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([])
  const [canvasNodes, setCanvasNodes] = useState<CanvasNode[]>([])
  const [canvasEdges, setCanvasEdges] = useState<CanvasEdge[]>([])
  const [workspaceLinks, setWorkspaceLinks] = useState<WorkspaceNodeLink[]>([])
  const [anchorMetrics, setAnchorMetrics] = useState<Record<string, AnchorViewportMetric>>({})
  const [activeAnchorId, setActiveAnchorId] = useState<string | null>(null)
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null)
  const [activeTextEditingNodeId, setActiveTextEditingNodeId] = useState<string | null>(null)
  const [pendingTextAutofocusNodeId, setPendingTextAutofocusNodeId] = useState<string | null>(null)
  const [activeNote, setActiveNote] = useState<Note>(seedNote)
  const [hydrated, setHydrated] = useState(false)
  const [shellRect, setShellRect] = useState<DOMRect | null>(null)
  const [workspaceRect, setWorkspaceRect] = useState<DOMRect | null>(null)
  const [documentPaneRect, setDocumentPaneRect] = useState<DOMRect | null>(null)
  const [activeEdgeId, setActiveEdgeId] = useState<string | null>(null)
  const [notesOpen, setNotesOpen] = useState(false)
  const [activeAnchorJumpKey, setActiveAnchorJumpKey] = useState(0)
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const [documentPaneWidth, setDocumentPaneWidth] = useState(540)
  const [workspaceViewport, setWorkspaceViewport] = useState(DEFAULT_WORKSPACE_VIEWPORT)
  const [pageZoom, setPageZoom] = useState(1)
  const [appZoom, setAppZoom] = useState(1)

  const excerptIndex = useMemo(() => new Map(excerpts.map((excerpt) => [excerpt.id, excerpt])), [excerpts])

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem('workspace:workspaceZoom')
      const parsed = stored ? Number(stored) : 1
      if (Number.isFinite(parsed) && parsed > 0) {
        setWorkspaceViewport((current) => ({
          ...current,
          zoom: Math.max(0.3, Math.min(3, parsed))
        }))
      }
    } catch {}

    let isMounted = true
    void loadWorkspaceState<WorkspacePersistenceState>(WORKSPACE_ID).then((state) => {
      if (!isMounted) {
        return
      }

      if (state) {
        setDocumentState(state.document)
        setAnchors(state.anchors)
        setExcerpts(state.excerpts)
        setBookmarks(state.bookmarks)
        setCanvasNodes(state.canvasNodes.map((node) => ({ ...node, visible: node.visible ?? true })))
        setCanvasEdges(state.canvasEdges ?? [])
        setWorkspaceLinks(state.workspaceLinks ?? [])
        setActiveAnchorId(state.activeAnchorId)
        setActiveNote(
          state.activeNote
            ? {
                ...seedNote,
                ...state.activeNote
              }
            : seedNote
        )
      }

      setHydrated(true)
    })

    return () => {
      isMounted = false
    }
  }, [])

  useEffect(() => {
    try {
      window.localStorage.setItem('workspace:workspaceZoom', String(workspaceViewport.zoom))
    } catch {}
  }, [workspaceViewport.zoom])

  const clampWorkspaceZoom = useCallback((nextZoom: number) => Math.max(0.3, Math.min(3, Number(nextZoom.toFixed(2)))), [])
  const updateWorkspaceZoom = useCallback(
    (targetZoom: number) => {
      const zoomFocusCandidates = canvasNodes.filter(
        (node) => node.visible !== false && (node.kind === 'excerpt' || node.kind === 'comment')
      )
      const zoomFocusNode =
        zoomFocusCandidates.find((node) => node.id === activeNodeId) ??
        [...zoomFocusCandidates].sort((left, right) => left.y - right.y || left.x - right.x || left.createdAt.localeCompare(right.createdAt))[0] ??
        null

      setWorkspaceViewport((current) => {
        const nextZoom = clampWorkspaceZoom(targetZoom)
        if (!workspaceRect) {
          return { ...current, zoom: nextZoom }
        }

        const centerX = workspaceRect.width / 2
        const targetScreenY = Math.min(workspaceRect.height / 2, Math.max(140, workspaceRect.height * 0.32))
        const worldCenterX = zoomFocusNode ? zoomFocusNode.x + zoomFocusNode.width / 2 : (centerX - current.panX) / current.zoom
        const worldCenterY = zoomFocusNode ? zoomFocusNode.y + Math.min(zoomFocusNode.height / 2, 72) : (targetScreenY - current.panY) / current.zoom

        return {
          zoom: nextZoom,
          panX: centerX - worldCenterX * nextZoom,
          panY: targetScreenY - worldCenterY * nextZoom
        }
      })
    },
    [activeNodeId, canvasNodes, clampWorkspaceZoom, workspaceRect]
  )
  const workspaceZoomOut = useCallback(() => updateWorkspaceZoom(workspaceViewport.zoom - 0.1), [updateWorkspaceZoom, workspaceViewport.zoom])
  const workspaceZoomIn = useCallback(() => updateWorkspaceZoom(workspaceViewport.zoom + 0.1), [updateWorkspaceZoom, workspaceViewport.zoom])
  const workspaceZoomReset = useCallback(() => setWorkspaceViewport(DEFAULT_WORKSPACE_VIEWPORT), [])
  const clampAppZoom = useCallback((nextZoom: number) => Math.max(0.75, Math.min(1.5, Number(nextZoom.toFixed(2)))), [])
  const appZoomOut = useCallback(() => setAppZoom((current) => clampAppZoom(current - 0.1)), [clampAppZoom])
  const appZoomIn = useCallback(() => setAppZoom((current) => clampAppZoom(current + 0.1)), [clampAppZoom])
  const appZoomReset = useCallback(() => setAppZoom(1), [])
  const clampPageZoom = useCallback((nextZoom: number) => Math.max(0.6, Math.min(3, Number(nextZoom.toFixed(2)))), [])
  const pageZoomOut = useCallback(() => setPageZoom((current) => clampPageZoom(current - 0.1)), [clampPageZoom])
  const pageZoomIn = useCallback(() => setPageZoom((current) => clampPageZoom(current + 0.1)), [clampPageZoom])
  const pageZoomReset = useCallback(() => setPageZoom(1), [])
  const markZoomPane = useCallback((pane: ZoomPane) => {
    activeZoomPaneRef.current = pane
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey) {
        return
      }

      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"], .ProseMirror')) {
        return
      }

      const key = event.key
      if (key !== '+' && key !== '=' && key !== '-' && key !== '0') {
        return
      }

      event.preventDefault()
      if (activeZoomPaneRef.current === 'document') {
        if (key === '+' || key === '=') pageZoomIn()
        if (key === '-') pageZoomOut()
        if (key === '0') pageZoomReset()
        return
      }

      if (key === '+' || key === '=') workspaceZoomIn()
      if (key === '-') workspaceZoomOut()
      if (key === '0') workspaceZoomReset()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [pageZoomIn, pageZoomOut, pageZoomReset, workspaceZoomIn, workspaceZoomOut, workspaceZoomReset])

  useEffect(() => {
    if (!hydrated) {
      return
    }

    void persistWorkspaceState<WorkspacePersistenceState>(WORKSPACE_ID, {
      document: documentState,
      anchors,
      excerpts,
      bookmarks,
      canvasNodes,
      canvasEdges,
      workspaceLinks,
      activeAnchorId,
      activeNote
    }).catch((error) => {
      console.error('Failed to persist workspace state', error)
    })
  }, [activeAnchorId, activeNote, anchors, bookmarks, canvasEdges, canvasNodes, documentState, excerpts, hydrated, workspaceLinks])

  useEffect(() => {
    const measure = () => {
      setShellRect(shellRef.current?.getBoundingClientRect() ?? null)
      setWorkspaceRect(workspacePaneRef.current?.getBoundingClientRect() ?? null)
      setDocumentPaneRect(documentPaneRef.current?.getBoundingClientRect() ?? null)
    }

    const resizeObserver =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            measure()
          })
        : null

    measure()
    window.addEventListener('resize', measure)
    if (resizeObserver) {
      if (shellRef.current) {
        resizeObserver.observe(shellRef.current)
      }
      if (workspacePaneRef.current) {
        resizeObserver.observe(workspacePaneRef.current)
      }
      if (documentPaneRef.current) {
        resizeObserver.observe(documentPaneRef.current)
      }
    }

    return () => {
      window.removeEventListener('resize', measure)
      resizeObserver?.disconnect()
    }
  }, [])

  useEffect(() => {
    function handlePointerMove(event: PointerEvent) {
      const resize = splitResizeRef.current
      const shell = shellRef.current
      if (!resize || !shell) {
        return
      }

      const shellRect = shell.getBoundingClientRect()
      const availableWidth = Math.max(880, shellRect.width - 48)
      const nextWidth = resize.startWidth + (event.clientX - resize.startX)
      setDocumentPaneWidth(Math.min(availableWidth - 320, Math.max(360, nextWidth)))
    }

    function stopResize() {
      splitResizeRef.current = null
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', stopResize)
    window.addEventListener('pointercancel', stopResize)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', stopResize)
      window.removeEventListener('pointercancel', stopResize)
    }
  }, [])

  function resolveWorkspaceRow(viewportRatio: number, nodeHeight: number) {
    const paneHeight = workspacePaneRef.current?.getBoundingClientRect().height ?? 720
    const clampedRatio = Math.max(0.04, Math.min(0.94, viewportRatio))
    return Math.round(24 + clampedRatio * Math.max(0, paneHeight - nodeHeight - 48))
  }

  function findFreeWorkspacePosition(
    preferred: { x: number; y: number; width: number; height: number },
    existingNodes: CanvasNode[],
    ignoreNodeId?: string
  ) {
    const verticalStep = preferred.height + 18
    const clampedX = Math.max(24, preferred.x)
    let candidateY = Math.max(24, preferred.y)
    let attempts = 0

    while (attempts < 64) {
      const overlaps = existingNodes.some((node) => {
        if (node.id === ignoreNodeId) {
          return false
        }

        return rectanglesOverlap(
          {
            x: clampedX,
            y: candidateY,
            width: preferred.width,
            height: preferred.height
          },
          node
        )
      })

      if (!overlaps) {
        return { x: clampedX, y: candidateY }
      }

      candidateY += verticalStep
      attempts += 1
    }

    return { x: clampedX, y: candidateY }
  }

  function findFirstAvailableWorkspacePosition(
    candidates: Array<{ x: number; y: number; width: number; height: number }>,
    existingNodes: CanvasNode[],
    ignoreNodeId?: string
  ) {
    for (const candidate of candidates) {
      const position = findFreeWorkspacePosition(candidate, existingNodes, ignoreNodeId)
      const overlaps = existingNodes.some((node) => {
        if (node.id === ignoreNodeId) {
          return false
        }

        return rectanglesOverlap(
          {
            x: position.x,
            y: position.y,
            width: candidate.width,
            height: candidate.height
          },
          node
        )
      })

      if (!overlaps) {
        return position
      }
    }

    return findFreeWorkspacePosition(candidates[0], existingNodes, ignoreNodeId)
  }

  function upsertAnchorAndExcerpt(input: SelectionArtifactInput) {
    const anchor = buildPageAnchor(input)
    const excerpt = buildExcerpt(input)

    setAnchors((current) => upsertById(current, anchor))
    setExcerpts((current) => upsertById(current, excerpt))

    return { anchor, excerpt }
  }

  function upsertAnchorForBookmark(input: SelectionArtifactInput) {
    const nextAnchor = {
      ...buildPageAnchor(input),
      selectionColor: undefined
    }

    setAnchors((current) => {
      const existingAnchor = current.find((anchor) => anchor.id === nextAnchor.id)
      const bookmarkAnchor = existingAnchor
        ? {
            ...nextAnchor,
            selectionColor: existingAnchor.selectionColor,
            tags: nextAnchor.tags?.length ? nextAnchor.tags : existingAnchor.tags
          }
        : nextAnchor

      return upsertById(current, bookmarkAnchor)
    })

    return nextAnchor
  }

  function ensureEdge(
    anchorId: string,
    nodeId: string,
    label?: string,
    kind: 'auto' | 'manual' = 'auto',
    color?: string
  ) {
    const now = new Date().toISOString()
    const edge: CanvasEdge = {
      id: `edge-${anchorId}-${nodeId}`,
      workspaceId: WORKSPACE_ID,
      sourceNodeId: nodeId,
      sourceAnchorId: anchorId,
      targetNodeId: nodeId,
      kind,
      color,
      controlBias: 0.42,
      label,
      createdAt: now,
      updatedAt: now
    }

    setCanvasEdges((current) => upsertById(current, edge))
  }

  function createExcerptNode(excerpt: Excerpt, anchor: PageAnchor, viewportRatio: number, x?: number, y?: number) {
    const now = new Date().toISOString()
    const nodeId = `canvas-excerpt-${excerpt.id}`
    const baseNode: CanvasNode = {
      id: nodeId,
      workspaceId: WORKSPACE_ID,
      kind: 'excerpt',
      excerptId: excerpt.id,
      documentId: excerpt.documentId,
      sourceAnchorId: anchor.id,
      selectionColor: excerpt.selectionColor,
      title: `Excerpt · Page ${anchor.pageNumber}`,
      text: excerpt.extractedText,
      tags: excerpt.tags,
      textStyle: defaultTextStyle,
      x: x ?? 128,
      y: y ?? resolveWorkspaceRow(viewportRatio, 140),
      width: 280,
      height: 140,
      visible: true,
      createdAt: now,
      updatedAt: now
    }

    setCanvasNodes((current) => {
      const position = findFreeWorkspacePosition(
        {
          x: baseNode.x,
          y: baseNode.y,
          width: baseNode.width,
          height: baseNode.height
        },
        current,
        nodeId
      )
      return upsertById(current, {
        ...baseNode,
        x: position.x,
        y: position.y
      })
    })
    ensureEdge(anchor.id, nodeId, 'excerpt', 'auto', excerpt.selectionColor)
    focusBoth(anchor.id, nodeId)
  }

  function createCommentNode(excerpt: Excerpt, anchor: PageAnchor, viewportRatio: number) {
    const now = new Date().toISOString()
    const nodeId = `canvas-comment-${anchor.id}`
    const relatedExcerptNode =
      canvasNodes.find((node) => node.kind === 'excerpt' && node.excerptId === excerpt.id) ?? null
    const baseNode: CanvasNode = {
      id: nodeId,
      workspaceId: WORKSPACE_ID,
      kind: 'comment',
      excerptId: excerpt.id,
      documentId: excerpt.documentId,
      sourceAnchorId: anchor.id,
      selectionColor: excerpt.selectionColor,
      title: 'Comment',
      text: '',
      tags: excerpt.tags,
      textStyle: defaultTextStyle,
      x: relatedExcerptNode ? relatedExcerptNode.x + relatedExcerptNode.width + 28 : 36,
      y: relatedExcerptNode ? relatedExcerptNode.y : resolveWorkspaceRow(viewportRatio, 184),
      width: 300,
      height: 156,
      visible: true,
      createdAt: now,
      updatedAt: now
    }

    setCanvasNodes((current) => {
      const excerptNode =
        current.find((node) => node.kind === 'excerpt' && node.excerptId === excerpt.id) ?? relatedExcerptNode
      const candidateBoxes = excerptNode
        ? [
            {
              x: excerptNode.x + excerptNode.width + 28,
              y: excerptNode.y,
              width: baseNode.width,
              height: baseNode.height
            },
            {
              x: excerptNode.x - baseNode.width - 28,
              y: excerptNode.y,
              width: baseNode.width,
              height: baseNode.height
            },
            {
              x: excerptNode.x + excerptNode.width + 28,
              y: excerptNode.y + baseNode.height + 18,
              width: baseNode.width,
              height: baseNode.height
            },
            {
              x: excerptNode.x - baseNode.width - 28,
              y: excerptNode.y + baseNode.height + 18,
              width: baseNode.width,
              height: baseNode.height
            },
            {
              x: baseNode.x,
              y: baseNode.y,
              width: baseNode.width,
              height: baseNode.height
            }
          ]
        : [
            {
              x: baseNode.x,
              y: baseNode.y,
              width: baseNode.width,
              height: baseNode.height
            }
          ]
      const position = findFirstAvailableWorkspacePosition(candidateBoxes, current, nodeId)

      return upsertById(current, {
        ...baseNode,
        x: position.x,
        y: position.y
      })
    })
    ensureEdge(anchor.id, nodeId, 'comment', 'auto', excerpt.selectionColor)
    focusBoth(anchor.id, nodeId)
  }

  const createTextBoxNode = useCallback(() => {
    const paneRect = workspacePaneRef.current?.getBoundingClientRect() ?? null
    const zoom = Math.max(0.3, workspaceViewport.zoom)
    const worldCenterX = paneRect ? (paneRect.width / 2 - workspaceViewport.panX) / zoom : 280
    const worldCenterY = paneRect ? (paneRect.height / 2 - workspaceViewport.panY) / zoom : 220
    const now = new Date().toISOString()
    const nodeId = `canvas-text-${Date.now()}`
    const node: CanvasNode = {
      id: nodeId,
      workspaceId: WORKSPACE_ID,
      kind: 'text',
      title: 'Text',
      text: '',
      x: Math.max(8, Math.round(worldCenterX - 140)),
      y: Math.max(8, Math.round(worldCenterY - 90)),
      width: 280,
      height: 140,
      visible: true,
      createdAt: now,
      updatedAt: now
    }

    setCanvasNodes((current) => {
      const result = createCanvasNode(current, node)
      if (!result.ok) {
        console.error('[WorkspaceShell] failed to create text canvas node', { nodeId }, result.error)
        return current
      }
      return result.value
    })
    setActiveAnchorId(null)
    setActiveEdgeId(null)
    setActiveNodeId(nodeId)
    setActiveTextEditingNodeId(nodeId)
    setPendingTextAutofocusNodeId(nodeId)
  }, [workspaceViewport.panX, workspaceViewport.panY, workspaceViewport.zoom])

  function focusBoth(anchorId: string | null, nodeId: string | null, edgeId?: string | null) {
    setActiveAnchorId(anchorId)
    setActiveNodeId(nodeId)
    if (!nodeId) {
      setActiveTextEditingNodeId(null)
      setPendingTextAutofocusNodeId(null)
    }
    setActiveEdgeId(edgeId ?? (anchorId && nodeId ? `edge-${anchorId}-${nodeId}` : null))
    if (anchorId) {
      setActiveAnchorJumpKey((current) => current + 1)
    }
  }

  function tagSelection(selection: SelectionArtifactInput, tags: string[]) {
    const anchor = buildPageAnchor({ ...selection, tags })
    const normalizedTags = tags.map((tag) => tag.trim()).filter(Boolean)
    const hasRelatedArtifacts =
      excerpts.some((excerpt) => excerpt.anchorId === anchor.id) ||
      bookmarks.some((bookmark) => bookmark.sourceAnchorId === anchor.id) ||
      canvasNodes.some((node) => node.sourceAnchorId === anchor.id)
    setAnchors((current) => {
      const existing = current.find((item) => item.id === anchor.id)
      // If the user cleared tags on a tag-only highlight (no excerpt/bookmark/node), remove the anchor entirely
      // so the PDF highlight disappears.
      if (existing && normalizedTags.length === 0 && !hasRelatedArtifacts && !existing.selectionColor) {
        return current.filter((item) => item.id !== anchor.id)
      }
      if (!existing) {
        if (normalizedTags.length === 0) {
          return current
        }

        // Tag-only highlights should not create a persistent "color highlight".
        // We still render while tags exist (via anchor.tags), but when tags are removed,
        // the highlight disappears because selectionColor is unset.
        return [
          ...current,
          {
            ...anchor,
            selectionColor: undefined,
            tags: normalizedTags
          }
        ]
      }

      return current.map((item) =>
        item.id === anchor.id
          ? {
              ...item,
              tags: normalizedTags,
              updatedAt: new Date().toISOString()
            }
          : item
      )
    })

    setExcerpts((current) =>
      current.map((excerpt) =>
        excerpt.anchorId === anchor.id
          ? {
              ...excerpt,
              tags: normalizedTags,
              updatedAt: new Date().toISOString()
            }
          : excerpt
      )
    )
    setBookmarks((current) =>
      current.map((bookmark) =>
        bookmark.sourceAnchorId === anchor.id
          ? {
              ...bookmark,
              tags: normalizedTags,
              updatedAt: new Date().toISOString()
            }
          : bookmark
      )
    )
    setCanvasNodes((current) =>
      current.map((node) =>
        node.sourceAnchorId === anchor.id
          ? {
              ...node,
              tags: normalizedTags,
              updatedAt: new Date().toISOString()
            }
          : node
      )
    )
  }

  function recolorSelection(selection: SelectionArtifactInput) {
    const anchor = buildPageAnchor(selection)
    const anchorId = anchor.id
    const now = new Date().toISOString()

    setAnchors((current) => {
      const existing = current.find((item) => item.id === anchorId)
      if (!existing) {
        return [...current, anchor]
      }

      return current.map((item) =>
        item.id === anchorId
          ? {
              ...item,
              selectionColor: selection.selectionColor,
              updatedAt: now
            }
          : item
      )
    })

    setExcerpts((current) =>
      current.map((excerpt) =>
        excerpt.anchorId === anchorId
          ? {
              ...excerpt,
              selectionColor: selection.selectionColor,
              updatedAt: now
            }
          : excerpt
      )
    )
    setBookmarks((current) =>
      current.map((bookmark) =>
        bookmark.sourceAnchorId === anchorId
          ? {
              ...bookmark,
              selectionColor: selection.selectionColor,
              updatedAt: now
            }
          : bookmark
      )
    )
    setCanvasNodes((current) =>
      current.map((node) =>
        node.sourceAnchorId === anchorId
          ? {
              ...node,
              selectionColor: selection.selectionColor,
              updatedAt: now
            }
          : node
      )
    )
    setCanvasEdges((current) =>
      current.map((edge) =>
        edge.sourceAnchorId === anchorId
          ? {
              ...edge,
              color: selection.selectionColor,
              updatedAt: now
            }
          : edge
      )
    )
  }


  function removeCanvasNodesById(nodeIds: string[]) {
    const nodeIdsToRemove = new Set(nodeIds)
    if (nodeIdsToRemove.size === 0) {
      return
    }

    const nodesToRemove = canvasNodes.filter((entry) => nodeIdsToRemove.has(entry.id))
    if (nodesToRemove.length === 0) {
      return
    }

    const anchorIdsToConsider = new Set(
      nodesToRemove.map((node) => node.sourceAnchorId).filter((anchorId): anchorId is string => Boolean(anchorId))
    )
    const excerptIdsToConsider = new Set(nodesToRemove.map((node) => node.excerptId).filter(Boolean) as string[])
    const remainingNodes = canvasNodes.filter((entry) => !nodeIdsToRemove.has(entry.id))
    const remainingEdges = canvasEdges.filter((edge) => !nodeIdsToRemove.has(edge.targetNodeId))
    const remainingWorkspaceLinks = workspaceLinks.filter(
      (link) => !nodeIdsToRemove.has(link.fromNodeId) && !nodeIdsToRemove.has(link.toNodeId)
    )

    const excerptIdsToRemove = new Set<string>()
    excerptIdsToConsider.forEach((excerptId) => {
      if (!remainingNodes.some((entry) => entry.excerptId === excerptId)) {
        excerptIdsToRemove.add(excerptId)
      }
    })

    const remainingExcerpts = excerptIdsToRemove.size
      ? excerpts.filter((excerpt) => !excerptIdsToRemove.has(excerpt.id))
      : excerpts

    const anchorIdsToRemove = new Set<string>()
    const anchorIdsToFade = new Set<string>()
    anchorIdsToConsider.forEach((anchorId) => {
      const anchor = anchors.find((entry) => entry.id === anchorId)
      if (!anchor) {
        return
      }

      const hasRemainingNodes = remainingNodes.some((entry) => entry.sourceAnchorId === anchorId)
      const hasRemainingBookmark = bookmarks.some((bookmark) => bookmark.sourceAnchorId === anchorId)
      const hasRemainingExcerpt = remainingExcerpts.some((excerpt) => excerpt.anchorId === anchorId)
      const hasTags = (anchor.tags?.length ?? 0) > 0

      if (!hasRemainingNodes && !hasRemainingBookmark && !hasRemainingExcerpt && !hasTags) {
        anchorIdsToRemove.add(anchorId)
        return
      }

      if (!hasRemainingNodes && !hasRemainingExcerpt && anchor.selectionColor) {
        anchorIdsToFade.add(anchorId)
      }
    })

    const remainingAnchors =
      anchorIdsToRemove.size || anchorIdsToFade.size
        ? anchors
            .filter((anchor) => !anchorIdsToRemove.has(anchor.id))
            .map((anchor) =>
              anchorIdsToFade.has(anchor.id)
                ? {
                    ...anchor,
                    selectionColor: undefined,
                    updatedAt: new Date().toISOString()
                  }
                : anchor
            )
        : anchors

    setCanvasNodes(remainingNodes)
    setCanvasEdges(remainingEdges)
    setWorkspaceLinks(remainingWorkspaceLinks)
    if (excerptIdsToRemove.size) {
      setExcerpts(remainingExcerpts)
    }
    if (anchorIdsToRemove.size || anchorIdsToFade.size) {
      setAnchors(remainingAnchors)
    }

    setActiveNodeId((current) => (current && nodeIdsToRemove.has(current) ? null : current))
    setActiveTextEditingNodeId((current) => (current && nodeIdsToRemove.has(current) ? null : current))
    setPendingTextAutofocusNodeId((current) => (current && nodeIdsToRemove.has(current) ? null : current))
    setActiveAnchorId((current) => {
      if (!current || !anchorIdsToConsider.has(current)) {
        return current
      }
      return remainingAnchors.some((anchor) => anchor.id === current && anchor.selectionColor) ? current : null
    })
    setActiveEdgeId((current) => {
      if (!current) {
        return current
      }
      return remainingEdges.some((edge) => edge.id === current) ? current : null
    })
  }

  function removeExcerptByAnchorId(anchorId: string) {
    const nodeIdsToRemove = canvasNodes
      .filter((entry) => entry.sourceAnchorId === anchorId)
      .map((node) => node.id)

    removeCanvasNodesById(nodeIdsToRemove)
  }

  function normalizeSelectionText(input: string) {
    return input.replace(/\s+/g, ' ').trim().toLowerCase()
  }

  function clearHighlightsByAnchorIds(anchorIds: string[]) {
    const idsToClear = new Set(anchorIds)
    if (idsToClear.size === 0) {
      return
    }

    setAnchors((current) =>
      current.flatMap((anchor) => {
        if (!idsToClear.has(anchor.id)) {
          return [anchor]
        }

        const hasRelatedArtifacts =
          excerpts.some((excerpt) => excerpt.anchorId === anchor.id) ||
          bookmarks.some((bookmark) => bookmark.sourceAnchorId === anchor.id) ||
          canvasNodes.some((node) => node.sourceAnchorId === anchor.id)
        const hasTags = (anchor.tags?.length ?? 0) > 0

        if (!hasRelatedArtifacts && !hasTags) {
          return []
        }

        return [
          {
            ...anchor,
            selectionColor: undefined,
            updatedAt: new Date().toISOString()
          }
        ]
      })
    )
  }

  function removeHighlightBySelectionIdentity(selection: SelectionArtifactInput, fallbackAnchorId: string) {
    const normalizedText = normalizeSelectionText(selection.text)
    const matches = anchors.filter((anchor) => {
      if (anchor.documentId !== selection.documentId) return false
      if (anchor.pageNumber !== selection.pageNumber) return false
      if ((anchor.startSpanIndex ?? null) !== (selection.startSpanIndex ?? null)) return false
      if ((anchor.startOffset ?? null) !== (selection.startOffset ?? null)) return false
      if ((anchor.endSpanIndex ?? null) !== (selection.endSpanIndex ?? null)) return false
      if ((anchor.endOffset ?? null) !== (selection.endOffset ?? null)) return false
      return normalizeSelectionText(anchor.textQuote) === normalizedText
    })

    const ids = new Set<string>([fallbackAnchorId, ...matches.map((a) => a.id)])
    clearHighlightsByAnchorIds(Array.from(ids))
  }

  const clearFocusAll = () => {
    focusBoth(null, null, null)
  }

  const visibleCanvasNodes = useMemo(
    () => canvasNodes.filter((node) => node.visible !== false),
    [canvasNodes]
  )

  const tagIndex = useMemo(() => {
    const index = new Map<string, TagIndexEntry>()

    const add = (tag: string, bucket: keyof TagIndexEntry, id: string) => {
      const normalized = tag.trim()
      if (!normalized) {
        return
      }

      const entry = index.get(normalized) ?? {
        highlights: [],
        excerpts: [],
        comments: [],
        bookmarks: []
      }

      if (!entry[bucket].includes(id)) {
        entry[bucket].push(id)
      }
      index.set(normalized, entry)
    }

    anchors.forEach((anchor) => (anchor.tags ?? []).forEach((tag) => add(tag, 'highlights', anchor.id)))
    excerpts.forEach((excerpt) => (excerpt.tags ?? []).forEach((tag) => add(tag, 'excerpts', excerpt.id)))
    bookmarks.forEach((bookmark) => (bookmark.tags ?? []).forEach((tag) => add(tag, 'bookmarks', bookmark.id)))
    canvasNodes.forEach((node) =>
      (node.tags ?? []).forEach((tag) => add(tag, node.kind === 'comment' ? 'comments' : 'excerpts', node.id))
    )

    return index
  }, [anchors, bookmarks, canvasNodes, excerpts])

  const activeTagEntry = activeTag ? tagIndex.get(activeTag) ?? null : null
  const filteredAnchorIds = useMemo(() => {
    const ids = new Set(activeTagEntry?.highlights ?? [])
    ;(activeTagEntry?.excerpts ?? []).forEach((excerptId) => {
      const anchorId = excerpts.find((excerpt) => excerpt.id === excerptId)?.anchorId
      if (anchorId) {
        ids.add(anchorId)
      }
    })
    ;(activeTagEntry?.bookmarks ?? []).forEach((bookmarkId) => {
      const anchorId = bookmarks.find((bookmark) => bookmark.id === bookmarkId)?.sourceAnchorId
      if (anchorId) {
        ids.add(anchorId)
      }
    })
    ;(activeTagEntry?.comments ?? []).forEach((nodeId) => {
      const anchorId = canvasNodes.find((node) => node.id === nodeId)?.sourceAnchorId
      if (anchorId) {
        ids.add(anchorId)
      }
    })
    return ids
  }, [activeTagEntry, bookmarks, canvasNodes, excerpts])
  const filteredExcerptIds = useMemo(
    () => new Set(activeTagEntry?.excerpts ?? []),
    [activeTagEntry]
  )
  const filteredCommentIds = useMemo(
    () => new Set(activeTagEntry?.comments ?? []),
    [activeTagEntry]
  )
  const filteredBookmarkIds = useMemo(
    () => new Set(activeTagEntry?.bookmarks ?? []),
    [activeTagEntry]
  )

  const resolveAnchorMarkerColor = useCallback(
    (anchorId: string) => {
      return (
        anchors.find((anchor) => anchor.id === anchorId)?.selectionColor ??
        excerpts.find((excerpt) => excerpt.anchorId === anchorId)?.selectionColor ??
        bookmarks.find((bookmark) => bookmark.sourceAnchorId === anchorId)?.selectionColor ??
        '#5d5df6'
      )
    },
    [anchors, bookmarks, excerpts]
  )

  const highlightedAnchors = useMemo(
    () =>
      buildSourceHighlightDescriptors({
        anchors,
        excerpts,
        bookmarks,
        canvasNodes,
        activeTag,
        filteredAnchorIds
      }),
    [activeTag, anchors, bookmarks, canvasNodes, excerpts, filteredAnchorIds]
  )

  const anchorNodeIds = useMemo(() => {
    const grouped = new Map<string, string[]>()
    canvasNodes.forEach((node) => {
      if (!node.sourceAnchorId) {
        return
      }

      const bucket = grouped.get(node.sourceAnchorId) ?? []
      bucket.push(node.id)
      grouped.set(node.sourceAnchorId, bucket)
    })
    return grouped
  }, [canvasNodes])
  const resolvePreferredNodeIdForAnchor = useMemo(() => {
    return (anchorId: string, explicitNodeId?: string | null) => {
      const nodeIds = anchorNodeIds.get(anchorId) ?? []
      if (explicitNodeId && nodeIds.includes(explicitNodeId)) {
        return explicitNodeId
      }

      if (activeNodeId && nodeIds.includes(activeNodeId)) {
        return activeNodeId
      }

      if (nodeIds.length === 1) {
        return nodeIds[0]
      }

      return null
    }
  }, [activeNodeId, anchorNodeIds])

  const filteredWorkspaceNodes = useMemo(() => {
    if (!activeTag) {
      return visibleCanvasNodes
    }

    return visibleCanvasNodes.filter((node) => {
      if (node.kind === 'comment') {
        return filteredCommentIds.has(node.id)
      }
      return filteredExcerptIds.has(node.id)
    })
  }, [activeTag, filteredCommentIds, filteredExcerptIds, visibleCanvasNodes])

  const filteredExcerptNodes = useMemo(
    () => filteredWorkspaceNodes.filter((node) => node.kind === 'excerpt' && node.sourceAnchorId),
    [filteredWorkspaceNodes]
  )

  const filteredBookmarks = useMemo(() => {
    if (!activeTag) {
      return bookmarks
    }
    return bookmarks.filter((bookmark) => filteredBookmarkIds.has(bookmark.id))
  }, [activeTag, bookmarks, filteredBookmarkIds])

  useEffect(() => {
    if (!activeNodeId) {
      return
    }

    if (filteredWorkspaceNodes.some((node) => node.id === activeNodeId)) {
      return
    }

    setActiveTextEditingNodeId((current) => (current === activeNodeId ? null : current))
    setPendingTextAutofocusNodeId((current) => (current === activeNodeId ? null : current))
    setActiveNodeId(null)
  }, [activeNodeId, filteredWorkspaceNodes])

  const activeWorkspaceTextToolbarNode = useMemo(() => {
    if (!activeNodeId || activeTextEditingNodeId) {
      return null
    }

    const node = filteredWorkspaceNodes.find((entry) => entry.id === activeNodeId) ?? null
    if (!node || (node.kind !== 'excerpt' && node.kind !== 'comment')) {
      return null
    }

    return node
  }, [activeNodeId, activeTextEditingNodeId, filteredWorkspaceNodes])

  const workspaceTextToolbarPosition = useMemo(() => {
    const node = activeWorkspaceTextToolbarNode
    const pane = workspaceRect
    if (!node || !pane) {
      return null
    }

    const left = Math.max(18, Math.min(pane.width - 36, node.x * workspaceViewport.zoom + workspaceViewport.panX + 24))
    const top = Math.max(18, node.y * workspaceViewport.zoom + workspaceViewport.panY - 84)

    return { left, top }
  }, [activeWorkspaceTextToolbarNode, workspaceRect, workspaceViewport.panX, workspaceViewport.panY, workspaceViewport.zoom])

  const updateActiveToolbarNode = useCallback((updater: (node: CanvasNode) => CanvasNode) => {
    if (!activeWorkspaceTextToolbarNode) {
      return
    }

    setCanvasNodes((current) =>
      current.map((entry) => (entry.id === activeWorkspaceTextToolbarNode.id ? updater(entry) : entry))
    )
  }, [activeWorkspaceTextToolbarNode])

  const removeActiveToolbarNode = useCallback(() => {
    const node = activeWorkspaceTextToolbarNode
    if (!node) {
      return
    }

    removeCanvasNodesById([node.id])
    focusBoth(node.sourceAnchorId ?? null, null, null)
  }, [activeWorkspaceTextToolbarNode])

  const copyActiveToolbarNode = useCallback(async () => {
    const node = activeWorkspaceTextToolbarNode
    if (!node || typeof navigator === 'undefined' || !navigator.clipboard) {
      return
    }

    try {
      await navigator.clipboard.writeText(node.text ?? '')
    } catch (error) {
      console.error('[WorkspaceShell] failed to copy workspace node text', { nodeId: node.id }, error)
    }
  }, [activeWorkspaceTextToolbarNode])

  const copyActiveToolbarNodeLink = useCallback(async () => {
    const node = activeWorkspaceTextToolbarNode
    if (!node || typeof navigator === 'undefined' || !navigator.clipboard) {
      return
    }

    const linkTarget = node.sourceAnchorId ? `anchor:${node.sourceAnchorId}` : `node:${node.id}`
    try {
      await navigator.clipboard.writeText(linkTarget)
    } catch (error) {
      console.error('[WorkspaceShell] failed to copy workspace node link', { nodeId: node.id, linkTarget }, error)
    }
  }, [activeWorkspaceTextToolbarNode])

  const cutActiveToolbarNode = useCallback(async () => {
    await copyActiveToolbarNode()
    removeActiveToolbarNode()
  }, [copyActiveToolbarNode, removeActiveToolbarNode])

  const promoteActiveToolbarNodeToChild = useCallback(() => {
    const node = activeWorkspaceTextToolbarNode
    if (!node) {
      return
    }

    updateActiveToolbarNode((entry) => ({
      ...entry,
      tags: Array.from(new Set([...(entry.tags ?? []), 'child-workspace'])),
      updatedAt: new Date().toISOString()
    }))
  }, [activeWorkspaceTextToolbarNode, updateActiveToolbarNode])

  const commentFromActiveToolbarNode = useCallback(() => {
    const node = activeWorkspaceTextToolbarNode
    if (!node?.sourceAnchorId) {
      return
    }

    const excerpt =
      excerpts.find((entry) => entry.id === node.excerptId) ??
      excerpts.find((entry) => entry.anchorId === node.sourceAnchorId)
    const anchor = anchors.find((entry) => entry.id === node.sourceAnchorId)
    if (!excerpt || !anchor) {
      return
    }

    const viewportRatio = workspaceRect
      ? Math.max(0.04, Math.min(0.94, (node.y * workspaceViewport.zoom + workspaceViewport.panY) / Math.max(1, workspaceRect.height)))
      : 0.28
    createCommentNode(excerpt, anchor, viewportRatio)
  }, [activeWorkspaceTextToolbarNode, anchors, excerpts, workspaceRect, workspaceViewport.panY, workspaceViewport.zoom])

  const editActiveToolbarNode = useCallback(() => {
    const node = activeWorkspaceTextToolbarNode
    if (!node) {
      return
    }

    focusBoth(node.sourceAnchorId ?? null, node.id)
    if (node.kind !== 'comment') {
      return
    }

    requestAnimationFrame(() => {
      const editor = document.querySelector<HTMLElement>(`.workspace-comment-node[data-node-id="${node.id}"] [data-node-editor="true"]`)
      editor?.focus()
    })
  }, [activeWorkspaceTextToolbarNode])

  return (
    <main
      ref={shellRef}
      className="workspace-shell"
      style={{
        '--document-pane-width': `${documentPaneWidth}px`,
        width: `calc(100vw / ${appZoom})`,
        height: `calc(100dvh / ${appZoom})`,
        minHeight: `calc(100dvh / ${appZoom})`,
        maxHeight: `calc(100dvh / ${appZoom})`,
        transform: `scale(${appZoom})`,
        transformOrigin: 'top left'
      } as CSSProperties & Record<'--document-pane-width', string>}
    >
      <header className="workspace-header">
        <div>
          <div className="split-title">Document Intelligence Workspace</div>
          <strong>Selection → action popup → workspace node → linked navigation</strong>
        </div>
        <div className="workspace-header-actions">
          <div className="workspace-zoom-controls" aria-label="Whole page zoom controls">
            <button
              className="document-button workspace-zoom-button"
              type="button"
              aria-label="Zoom out whole page"
              onClick={appZoomOut}
              title="Zoom out the whole page"
            >
              -
            </button>
            <button
              className="document-button workspace-zoom-button workspace-zoom-reset"
              type="button"
              aria-label="Reset whole page zoom"
              onClick={appZoomReset}
              title="Reset whole page zoom"
            >
              {Math.round(appZoom * 100)}%
            </button>
            <button
              className="document-button workspace-zoom-button"
              type="button"
              aria-label="Zoom in whole page"
              onClick={appZoomIn}
              title="Zoom in the whole page"
            >
              +
            </button>
          </div>
          <button
            className="document-button"
            type="button"
            onClick={() => setNotesOpen((current) => !current)}
          >
            {notesOpen ? 'Hide Notes' : 'Notes'}
          </button>
          <div className="split-title">PDF.js • draggable workspace • SVG link layer</div>
        </div>
      </header>

      <section
        ref={documentPaneRef}
        className="workspace-panel document-pane"
        onPointerEnter={() => markZoomPane('document')}
        onPointerDownCapture={() => markZoomPane('document')}
        onFocusCapture={() => markZoomPane('document')}
      >
        <PdfViewer
          shellRef={shellRef}
          workspaceId={WORKSPACE_ID}
          documentState={documentState}
          anchors={anchors}
          highlightedAnchors={highlightedAnchors}
          bookmarks={filteredBookmarks}
          linkedNodes={filteredWorkspaceNodes
            .map((n) => ({
              id: n.id,
              sourceAnchorId: n.sourceAnchorId!,
              title: n.title ?? (n.kind === 'comment' ? 'Comment' : 'Excerpt'),
              text: n.text ?? '',
              selectionColor: n.selectionColor ?? '#ffd400',
              tags: n.tags ?? []
            }))}
          activeTag={activeTag}
          pageZoom={pageZoom}
          availableTags={Array.from(new Set([...STANDARD_TAGS, ...tagIndex.keys()])).sort((left, right) => left.localeCompare(right))}
          onPageZoomChange={(nextZoom) => setPageZoom(clampPageZoom(nextZoom))}
          onToggleTag={(tag) => setActiveTag((current) => (current === tag ? null : tag))}
          onClearTagFilter={() => setActiveTag(null)}
          activeSourceFocus={
            activeAnchorId
              ? {
                  anchorId: activeAnchorId,
                  selectionColor: resolveAnchorMarkerColor(activeAnchorId),
                  jumpKey: activeAnchorJumpKey
                }
              : null
          }
          onDocumentImported={(nextDocument) => {
            setDocumentState(nextDocument)
            setAnchors([])
            setExcerpts([])
            setBookmarks([])
            setCanvasNodes([])
            setCanvasEdges([])
            setActiveAnchorId(null)
            setActiveNodeId(null)
            setActiveTextEditingNodeId(null)
            setPendingTextAutofocusNodeId(null)
          }}
          onAutoExcerpt={({ selection, viewportRatio }) => {
            const { anchor, excerpt } = upsertAnchorAndExcerpt(selection)
            createExcerptNode(excerpt, anchor, viewportRatio)
          }}
          onComment={({ selection, viewportRatio }) => {
            const { anchor, excerpt } = upsertAnchorAndExcerpt(selection)
            createCommentNode(excerpt, anchor, viewportRatio)
          }}
          onBookmark={(selection) => {
            const anchor = buildPageAnchor(selection)
            const isAlreadyBookmarked = bookmarks.some((bookmark) => bookmark.sourceAnchorId === anchor.id)
            if (isAlreadyBookmarked) {
              setBookmarks((current) => current.filter((bookmark) => bookmark.sourceAnchorId !== anchor.id))
              if (activeAnchorId === anchor.id) {
                setActiveAnchorId(null)
              }
              return
            }

            const nextOrder =
              bookmarks.reduce((max, bookmark) => Math.max(max, bookmark.documentOrder), 0) + 1
            const bookmark = buildBookmark(selection, nextOrder)
            const bookmarkAnchor = upsertAnchorForBookmark(selection)
            setBookmarks((current) => upsertById(current, bookmark))
            setActiveAnchorId(bookmarkAnchor.id)
            const linkedNodeId = resolvePreferredNodeIdForAnchor(bookmarkAnchor.id)
            setActiveNodeId(linkedNodeId)
          }}
          onRemoveExcerpt={(anchorId) => {
            removeExcerptByAnchorId(anchorId)
          }}
          onRemoveHighlight={({ anchorId, selection }) => {
            removeHighlightBySelectionIdentity(selection, anchorId)
          }}
          onTag={tagSelection}
          onSelectionChange={recolorSelection}
          onOpenAnchor={(anchorId) => {
            focusBoth(anchorId, resolvePreferredNodeIdForAnchor(anchorId))
          }}
          onAnchorMetricsChange={setAnchorMetrics}
          onClearFocus={clearFocusAll}
        />
      </section>

      <div
        className="workspace-divider"
        onPointerDown={(event) => {
          event.preventDefault()
          splitResizeRef.current = {
            startX: event.clientX,
            startWidth: documentPaneWidth
          }
        }}
      />

      <section
        ref={workspacePaneRef}
        className="workspace-panel workspace-pane"
        onPointerEnter={() => markZoomPane('workspace')}
        onFocusCapture={() => markZoomPane('workspace')}
        onPointerDownCapture={(event) => {
          markZoomPane('workspace')
          const target = event.target
          if (!(target instanceof HTMLElement)) {
            return
          }

          if (
            target.closest('.workspace-text-toolbar') ||
            target.closest('.workspace-textbox-toolbar') ||
            target.closest('[data-node-editor="true"]') ||
            target.closest('[contenteditable="true"]') ||
            target.closest('button, input, textarea, select, option, [role="textbox"]')
          ) {
            return
          }

          const nodeElement = target.closest<HTMLElement>('.workspace-node')
          if (!nodeElement) {
            return
          }

          const nodeId = nodeElement.dataset.nodeId
          if (!nodeId) {
            return
          }

          const node = canvasNodes.find((entry) => entry.id === nodeId)
          if (!node || node.kind === 'text') {
            return
          }

          focusBoth(node.sourceAnchorId ?? null, node.id)
        }}
      >
        <WorkspaceCanvas
          workspaceId={WORKSPACE_ID}
          paneRef={workspacePaneRef}
          canvasNodes={filteredWorkspaceNodes}
          activeNodeId={activeNodeId}
          activeTextEditingNodeId={activeTextEditingNodeId}
          pendingTextAutofocusNodeId={pendingTextAutofocusNodeId}
          workspaceLinks={workspaceLinks}
          viewport={workspaceViewport}
          activeNote={notesOpen ? activeNote : null}
          noteExcerpts={Array.from(excerptIndex.values())}
          onCanvasNodesChange={setCanvasNodes}
          onActiveTextEditingNodeIdChange={setActiveTextEditingNodeId}
          onPendingTextAutofocusNodeIdChange={setPendingTextAutofocusNodeId}
          onViewportChange={setWorkspaceViewport}
          onNoteChange={setActiveNote}
          onCreateWorkspaceLink={(fromNodeId, toNodeId) => {
            setWorkspaceLinks((current) => {
              if (current.some((link) => link.fromNodeId === fromNodeId && link.toNodeId === toNodeId)) {
                return current
              }

              return [...current, buildWorkspaceNodeLink(fromNodeId, toNodeId)]
            })
          }}
          onOpenWorkspaceLink={(link) => {
            setActiveNodeId(link.toNodeId)
          }}
          onDropSelection={({ excerpt, anchor, x, y }) => {
            setAnchors((current) => upsertById(current, anchor))
            setExcerpts((current) => upsertById(current, excerpt))
            createExcerptNode(excerpt, anchor, y / Math.max(1, workspaceRect?.height ?? 720), x, y)
          }}
          onCreateTextBox={createTextBoxNode}
          onOpenAnchor={(anchorId, preferredNodeId) => {
            focusBoth(anchorId, resolvePreferredNodeIdForAnchor(anchorId, preferredNodeId))
          }}
          onFocusNode={(nodeId) => {
            setActiveNodeId(nodeId)
          }}
          onClearSelection={() => {
            focusBoth(null, null, null)
          }}
        />

        {activeWorkspaceTextToolbarNode && workspaceTextToolbarPosition ? (
          <WorkspaceTextToolbar
            node={activeWorkspaceTextToolbarNode}
            left={workspaceTextToolbarPosition.left}
            top={workspaceTextToolbarPosition.top}
            onStyleChange={(stylePatch) => {
              updateActiveToolbarNode((entry) => ({
                ...entry,
                textStyle: {
                  ...(entry.textStyle ?? defaultTextStyle),
                  ...stylePatch
                },
                updatedAt: new Date().toISOString()
              }))
            }}
            onColorChange={(color) => {
              updateActiveToolbarNode((entry) => ({
                ...entry,
                nodeColor: color,
                updatedAt: new Date().toISOString()
              }))
            }}
            onCopy={() => {
              void copyActiveToolbarNode()
            }}
            onCut={() => {
              void cutActiveToolbarNode()
            }}
            onCopyLink={() => {
              void copyActiveToolbarNodeLink()
            }}
            onDelete={removeActiveToolbarNode}
            onPromoteChild={promoteActiveToolbarNodeToChild}
            onComment={commentFromActiveToolbarNode}
            onEdit={editActiveToolbarNode}
            onTagsChange={(tags) => {
              updateActiveToolbarNode((entry) => ({
                ...entry,
                tags,
                updatedAt: new Date().toISOString()
              }))
            }}
          />
        ) : null}

      </section>

      <LinkLayer
        shellRect={shellRect}
        workspaceRect={workspaceRect}
        documentPaneRect={documentPaneRect}
        anchorMetrics={anchorMetrics}
        nodes={canvasNodes}
        edges={canvasEdges}
        workspacePanX={workspaceViewport.panX}
        workspacePanY={workspaceViewport.panY}
        workspaceZoom={workspaceViewport.zoom}
        activeAnchorId={activeAnchorId}
        activeEdgeId={activeEdgeId}
      />
    </main>
  )
}
