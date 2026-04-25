'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react'
import { flushSync } from 'react-dom'
import type { CanvasNode, Excerpt, Note, PageAnchor } from '@workspace/domain'
import { deleteCanvasNode, updateCanvasNode } from '../../lib/workspace/canvas-node-crud'
import type { WorkspaceLinkingState, WorkspaceNodeLink } from '../../lib/workspace/node-links'
import type { NoteEditorHandle, NoteEditorSelectionState } from '../notes/note-editor'
import { CommentNode } from './CommentNode'
import { ExcerptNode, type NodeResizeDirection } from './ExcerptNode'
import { TextBoxNode } from './TextBoxNode'
import { WorkspaceNodeLinkLayer } from './WorkspaceNodeLinkLayer'
import { WorkspaceSelectionToolbar } from './WorkspaceSelectionToolbar'
import { NoteNode } from '../notes/note-node'
import { WorkspaceToolRail } from './WorkspaceToolRail'

const WORKSPACE_NODE_MARGIN = 8

interface WorkspaceViewportState {
  panX: number
  panY: number
  zoom: number
}

interface WorkspaceCanvasProps {
  workspaceId: string
  paneRef: RefObject<HTMLElement | null>
  canvasNodes: CanvasNode[]
  activeNodeId: string | null
  activeTextEditingNodeId: string | null
  pendingTextAutofocusNodeId: string | null
  workspaceLinks: WorkspaceNodeLink[]
  viewport: WorkspaceViewportState
  activeNote: Note | null
  noteExcerpts: Excerpt[]
  onCanvasNodesChange: Dispatch<SetStateAction<CanvasNode[]>>
  onActiveTextEditingNodeIdChange: Dispatch<SetStateAction<string | null>>
  onPendingTextAutofocusNodeIdChange: Dispatch<SetStateAction<string | null>>
  onViewportChange: Dispatch<SetStateAction<WorkspaceViewportState>>
  onNoteChange: (note: Note) => void
  onCreateWorkspaceLink: (fromNodeId: string, toNodeId: string) => void
  onOpenWorkspaceLink: (link: WorkspaceNodeLink) => void
  onDropSelection: (payload: {
    excerpt: Excerpt
    anchor: PageAnchor
    x: number
    y: number
  }) => void
  onCreateTextBox: () => void
  onOpenAnchor: (anchorId: string, preferredNodeId?: string | null) => void
  onFocusNode: (nodeId: string) => void
  onClearSelection: () => void
}

export type TextToolbarVisibilityDecision = 'selection' | 'anchor' | 'preserve' | 'close'

export function getTextToolbarVisibilityDecision(options: {
  nextHasSelection: boolean
  hasNextRect: boolean
  hasActiveRect: boolean
  hasAnchorRect: boolean
  editorStillActive: boolean
  toolbarInteracting: boolean
  selectionInProgress: boolean
}): TextToolbarVisibilityDecision {
  if (options.nextHasSelection) {
    if (options.hasNextRect) {
      return 'selection'
    }

    if (options.hasActiveRect) {
      return 'preserve'
    }
  }

  if (options.hasAnchorRect) {
    return 'anchor'
  }

  if ((options.editorStillActive || options.toolbarInteracting || options.selectionInProgress) && options.hasActiveRect) {
    return 'preserve'
  }

  return 'close'
}

function compareNodePriority(left: CanvasNode, right: CanvasNode, activeNodeId: string | null) {
  const leftPriority = left.id === activeNodeId ? 2 : left.kind === 'excerpt' ? 1 : 0
  const rightPriority = right.id === activeNodeId ? 2 : right.kind === 'excerpt' ? 1 : 0
  if (leftPriority !== rightPriority) {
    return leftPriority - rightPriority
  }

  return left.createdAt.localeCompare(right.createdAt)
}

export function WorkspaceCanvas({
  workspaceId,
  paneRef,
  canvasNodes,
  activeNodeId,
  activeTextEditingNodeId,
  pendingTextAutofocusNodeId,
  workspaceLinks,
  viewport,
  activeNote,
  noteExcerpts,
  onCanvasNodesChange,
  onActiveTextEditingNodeIdChange,
  onPendingTextAutofocusNodeIdChange,
  onViewportChange,
  onNoteChange,
  onCreateWorkspaceLink,
  onOpenWorkspaceLink,
  onDropSelection,
  onCreateTextBox,
  onOpenAnchor,
  onFocusNode,
  onClearSelection
}: WorkspaceCanvasProps) {
  const COMMENT_SNAP_THRESHOLD = 48
  const [pendingCommentAutofocusNodeId, setPendingCommentAutofocusNodeId] = useState<string | null>(null)
  const dragRef = useRef<{
    nodeId: string
    offsetX: number
    offsetY: number
  } | null>(null)
  const pressRef = useRef<{
    nodeId: string
    offsetX: number
    offsetY: number
    startClientX: number
    startClientY: number
  } | null>(null)
  const resizeRef = useRef<{
    nodeId: string
    direction: NodeResizeDirection
    startX: number
    startY: number
    startNodeX: number
    startNodeY: number
    startWidth: number
    startHeight: number
  } | null>(null)
  const panRef = useRef<{
    pointerId: number
    startClientX: number
    startClientY: number
    startPanX: number
    startPanY: number
  } | null>(null)
  const linkingRef = useRef<WorkspaceLinkingState | null>(null)
  const viewportRef = useRef(viewport)
  const viewportFrameRef = useRef<number | null>(null)
  const pendingViewportRef = useRef(viewport)
  const textEditorHandlesRef = useRef(new Map<string, NoteEditorHandle | null>())
  const activeTextEditingNodeIdRef = useRef<string | null>(null)
  const pendingTextAutofocusNodeIdRef = useRef<string | null>(null)
  const [linkingState, setLinkingState] = useState<WorkspaceLinkingState | null>(null)
  const [activeTextSelectionRect, setActiveTextSelectionRect] = useState<DOMRect | null>(null)
  const activeTextSelectionRectRef = useRef<DOMRect | null>(null)
  const isTextToolbarInteractingRef = useRef(false)
  const textEditingNodeId = activeTextEditingNodeId ?? pendingTextAutofocusNodeId

  useEffect(() => {
    viewportRef.current = viewport
    pendingViewportRef.current = viewport
  }, [viewport])

  useEffect(() => {
    activeTextEditingNodeIdRef.current = activeTextEditingNodeId
  }, [activeTextEditingNodeId, pendingTextAutofocusNodeId])

  useEffect(() => {
    pendingTextAutofocusNodeIdRef.current = pendingTextAutofocusNodeId
  }, [pendingTextAutofocusNodeId])

  useEffect(() => {
    return () => {
      if (viewportFrameRef.current !== null) {
        cancelAnimationFrame(viewportFrameRef.current)
      }
    }
  }, [])

  function clampZoom(nextZoom: number) {
    return Math.max(0.3, Math.min(3, Number(nextZoom.toFixed(2))))
  }

  function createFreeNode(kind: Exclude<CanvasNode['kind'], 'text'>) {
    const pane = paneRef.current
    const paneRect = pane?.getBoundingClientRect() ?? null
    const zoom = Math.max(0.3, viewportRef.current.zoom)

    const worldCenterX = paneRect ? (paneRect.width / 2 - viewportRef.current.panX) / zoom : 280
    const worldCenterY = paneRect ? (paneRect.height / 2 - viewportRef.current.panY) / zoom : 220

    const now = new Date().toISOString()
    const id = `canvas-${kind}-${Date.now()}`
    const node: CanvasNode = {
      id,
      workspaceId,
      kind,
      title: kind === 'comment' ? 'Workspace Card' : 'Node',
      text: '',
      x: Math.max(WORKSPACE_NODE_MARGIN, Math.round(worldCenterX - 140)),
      y: Math.max(WORKSPACE_NODE_MARGIN, Math.round(worldCenterY - 90)),
      width: 280,
      height: 140,
      visible: true,
      createdAt: now,
      updatedAt: now
    }

    onCanvasNodesChange((current) => [...current, node])
    if (kind === 'comment') {
      setPendingCommentAutofocusNodeId(id)
    }
    onFocusNode(id)
  }

  const nodeIndex = useMemo(() => new Map(canvasNodes.map((node) => [node.id, node])), [canvasNodes])
  const resolveTextToolbarFallbackRect = useCallback((nodeId: string) => {
    if (typeof document === 'undefined') {
      return null
    }

    const nodeElement = document.querySelector<HTMLElement>(`.workspace-textbox-node[data-node-id="${nodeId}"]`)
    if (!nodeElement) {
      return null
    }

    const rect = nodeElement.getBoundingClientRect()
    return new DOMRect(rect.left + rect.width / 2 - 1, rect.top, 2, Math.max(18, Math.min(rect.height, 40)))
  }, [])

  const resolveDomSelectionRect = useCallback((nodeId: string) => {
    if (typeof document === 'undefined' || typeof window === 'undefined') {
      return null
    }

    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      return null
    }

    const anchorNode = selection.anchorNode
    const focusNode = selection.focusNode
    const textboxElement = document.querySelector<HTMLElement>(`.workspace-textbox-node[data-node-id="${nodeId}"]`)
    if (!textboxElement) {
      return null
    }

    if (
      (anchorNode && !textboxElement.contains(anchorNode)) &&
      (focusNode && !textboxElement.contains(focusNode))
    ) {
      return null
    }

    const range = selection.getRangeAt(0)
    const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 || rect.height > 0)
    const rect = rects[0] ?? range.getBoundingClientRect()
    if (!rect || (!rect.width && !rect.height)) {
      return null
    }

    return new DOMRect(rect.left, rect.top, Math.max(1, rect.width), Math.max(1, rect.height))
  }, [])

  const closeTextToolbar = useCallback(() => {
    activeTextSelectionRectRef.current = null
    setActiveTextSelectionRect(null)
  }, [])

  const isTextboxEditorActive = useCallback((nodeId: string) => {
    if (typeof document === 'undefined') {
      return false
    }

    const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const activeTextbox = activeElement?.closest<HTMLElement>('.workspace-textbox-node')
    return activeTextbox?.dataset.nodeId === nodeId
  }, [])

  const doesTextboxHandleHaveFocus = useCallback((nodeId: string) => {
    const handle = textEditorHandlesRef.current.get(nodeId)
    return handle?.hasFocus() ?? false
  }, [])

  const isTextboxSelectionInProgress = useCallback((nodeId: string) => {
    const handle = textEditorHandlesRef.current.get(nodeId)
    return handle?.isSelecting() ?? false
  }, [])

  const blurFocusedTextboxEditor = useCallback((exceptNodeId?: string) => {
    if (typeof document === 'undefined') {
      return
    }

    const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const activeTextbox = activeElement?.closest<HTMLElement>('.workspace-textbox-node')
    if (!activeElement || !activeTextbox) {
      return
    }

    if (exceptNodeId && activeTextbox.dataset.nodeId === exceptNodeId) {
      return
    }

    activeElement.blur()
  }, [])

  const openTextToolbar = useCallback((rect: DOMRect) => {
    activeTextSelectionRectRef.current = rect
    setActiveTextSelectionRect(rect)
  }, [])

  const maybeClearPendingTextAutofocus = useCallback((nodeId: string, state?: NoteEditorSelectionState | null) => {
    if (pendingTextAutofocusNodeIdRef.current !== nodeId) {
      return
    }

    if (!state?.rect) {
      return
    }

    pendingTextAutofocusNodeIdRef.current = null
    onPendingTextAutofocusNodeIdChange(null)
  }, [onPendingTextAutofocusNodeIdChange])

  const syncTextToolbarForNode = useCallback((
    nodeId: string,
    state?: NoteEditorSelectionState | null
  ) => {
    const currentEditingNodeId = activeTextEditingNodeIdRef.current
    if (currentEditingNodeId !== nodeId) {
      return
    }

    const nextState = state ?? textEditorHandlesRef.current.get(nodeId)?.getSelectionState() ?? null
    const nextHasSelection = nextState?.hasSelection ?? false
    const domSelectionRect = nextHasSelection ? resolveDomSelectionRect(nodeId) : null
    const nextRect = nextState?.rect ?? domSelectionRect ?? null
    const editorStillActive = doesTextboxHandleHaveFocus(nodeId) || isTextboxEditorActive(nodeId)
    const selectionInProgress = isTextboxSelectionInProgress(nodeId)
    const awaitingAutofocus = pendingTextAutofocusNodeIdRef.current === nodeId
    const canUseFallbackRect = editorStillActive || isTextToolbarInteractingRef.current || selectionInProgress || awaitingAutofocus
    const fallbackRect = canUseFallbackRect ? resolveTextToolbarFallbackRect(nodeId) : null
    const anchorRect = nextRect ?? (nextHasSelection ? null : fallbackRect)
    const visibilityDecision = getTextToolbarVisibilityDecision({
      nextHasSelection,
      hasNextRect: Boolean(nextRect),
      hasActiveRect: Boolean(activeTextSelectionRectRef.current),
      hasAnchorRect: Boolean(anchorRect),
      editorStillActive,
      toolbarInteracting: isTextToolbarInteractingRef.current,
      selectionInProgress
    })

    if (visibilityDecision === 'selection' && nextRect) {
      openTextToolbar(nextRect)
      return
    }

    if (visibilityDecision === 'anchor' && anchorRect) {
      openTextToolbar(anchorRect)
      return
    }

    if (visibilityDecision === 'preserve') {
      return
    }

    closeTextToolbar()
  }, [closeTextToolbar, doesTextboxHandleHaveFocus, isTextboxEditorActive, isTextboxSelectionInProgress, openTextToolbar, resolveDomSelectionRect, resolveTextToolbarFallbackRect])

  const scheduleTextToolbarRefresh = useCallback((nodeId: string) => {
    requestAnimationFrame(() => {
      if (activeTextEditingNodeIdRef.current !== nodeId) {
        return
      }

      syncTextToolbarForNode(nodeId)

      requestAnimationFrame(() => {
        if (activeTextEditingNodeIdRef.current !== nodeId) {
          return
        }

        const selectionState = textEditorHandlesRef.current.get(nodeId)?.getSelectionState() ?? null
        maybeClearPendingTextAutofocus(nodeId, selectionState)
        syncTextToolbarForNode(nodeId, selectionState)
      })
    })
  }, [maybeClearPendingTextAutofocus, syncTextToolbarForNode])

  const clearDocumentSelection = useCallback(() => {
    if (typeof document === 'undefined') {
      return
    }

    document.getSelection()?.removeAllRanges()
  }, [])

  const beginTextEditing = useCallback((nodeId: string) => {
    if (activeTextEditingNodeIdRef.current === nodeId && isTextboxSelectionInProgress(nodeId)) {
      return
    }

    clearDocumentSelection()
    blurFocusedTextboxEditor(nodeId)
    pendingTextAutofocusNodeIdRef.current = nodeId
    activeTextEditingNodeIdRef.current = nodeId
    closeTextToolbar()
    flushSync(() => {
      onPendingTextAutofocusNodeIdChange(nodeId)
      onActiveTextEditingNodeIdChange(nodeId)
      onFocusNode(nodeId)
    })
    const handle = textEditorHandlesRef.current.get(nodeId)
    if (handle) {
      handle.focus()
      const selectionState = handle.getSelectionState()
      maybeClearPendingTextAutofocus(nodeId, selectionState)
      syncTextToolbarForNode(nodeId, selectionState)
      scheduleTextToolbarRefresh(nodeId)
      return
    }

    scheduleTextToolbarRefresh(nodeId)
  }, [
    blurFocusedTextboxEditor,
    clearDocumentSelection,
    closeTextToolbar,
    maybeClearPendingTextAutofocus,
    onActiveTextEditingNodeIdChange,
    onFocusNode,
    onPendingTextAutofocusNodeIdChange,
    scheduleTextToolbarRefresh,
    syncTextToolbarForNode,
    isTextboxSelectionInProgress
  ])

  const updateTextSelection = useCallback((nodeId: string, state: NoteEditorSelectionState) => {
    maybeClearPendingTextAutofocus(nodeId, state)
    syncTextToolbarForNode(nodeId, state)
  }, [maybeClearPendingTextAutofocus, syncTextToolbarForNode])

  const stopTextEditing = useCallback(() => {
    const currentNodeId = activeTextEditingNodeIdRef.current
    if (currentNodeId && isTextboxSelectionInProgress(currentNodeId)) {
      return
    }

    pendingTextAutofocusNodeIdRef.current = null
    activeTextEditingNodeIdRef.current = null
    isTextToolbarInteractingRef.current = false
    onPendingTextAutofocusNodeIdChange(null)
    onActiveTextEditingNodeIdChange(null)
    closeTextToolbar()
    clearDocumentSelection()
    blurFocusedTextboxEditor()
  }, [
    blurFocusedTextboxEditor,
    clearDocumentSelection,
    closeTextToolbar,
    isTextboxSelectionInProgress,
    onActiveTextEditingNodeIdChange,
    onPendingTextAutofocusNodeIdChange
  ])

  const registerTextEditorHandle = useCallback((nodeId: string, handle: NoteEditorHandle | null) => {
    const existingHandle = textEditorHandlesRef.current.get(nodeId) ?? null
    if (existingHandle === handle) {
      return
    }

    if (handle) {
      textEditorHandlesRef.current.set(nodeId, handle)
      const shouldAutofocus =
        pendingTextAutofocusNodeIdRef.current === nodeId ||
        activeTextEditingNodeIdRef.current === nodeId
      if (shouldAutofocus) {
        activeTextEditingNodeIdRef.current = nodeId
        onActiveTextEditingNodeIdChange(nodeId)
        handle.focus()
        const selectionState = handle.getSelectionState()
        maybeClearPendingTextAutofocus(nodeId, selectionState)
        syncTextToolbarForNode(nodeId, selectionState)
        scheduleTextToolbarRefresh(nodeId)
      }
      return
    }

    if (!existingHandle) {
      return
    }

    textEditorHandlesRef.current.delete(nodeId)
    if (activeTextEditingNodeIdRef.current === nodeId) {
      closeTextToolbar()
    }
  }, [
    closeTextToolbar,
    maybeClearPendingTextAutofocus,
    onActiveTextEditingNodeIdChange,
    scheduleTextToolbarRefresh,
    syncTextToolbarForNode
  ])

  useEffect(() => {
    if (!pendingTextAutofocusNodeId || activeTextEditingNodeId !== pendingTextAutofocusNodeId) {
      return
    }

    const handle = textEditorHandlesRef.current.get(pendingTextAutofocusNodeId)
    if (!handle) {
      return
    }

    handle.focus()
    const selectionState = handle.getSelectionState()
    maybeClearPendingTextAutofocus(pendingTextAutofocusNodeId, selectionState)
    syncTextToolbarForNode(pendingTextAutofocusNodeId, selectionState)
    scheduleTextToolbarRefresh(pendingTextAutofocusNodeId)
  }, [
    activeTextEditingNodeId,
    maybeClearPendingTextAutofocus,
    pendingTextAutofocusNodeId,
    scheduleTextToolbarRefresh,
    syncTextToolbarForNode
  ])

  const refreshOpenTextToolbarPositions = useCallback(() => {
    const nodeId = activeTextEditingNodeIdRef.current
    if (!nodeId) {
      closeTextToolbar()
      return
    }

    syncTextToolbarForNode(nodeId)
  }, [closeTextToolbar, syncTextToolbarForNode])

  useEffect(() => {
    if (!textEditingNodeId) {
      return
    }

    const refresh = () => {
      requestAnimationFrame(() => {
        refreshOpenTextToolbarPositions()
      })
    }

    refresh()
    window.addEventListener('resize', refresh)
    window.addEventListener('scroll', refresh, true)
    return () => {
      window.removeEventListener('resize', refresh)
      window.removeEventListener('scroll', refresh, true)
    }
  }, [refreshOpenTextToolbarPositions, textEditingNodeId, viewport.panX, viewport.panY, viewport.zoom])

  useEffect(() => {
    if (!textEditingNodeId) {
      return
    }

    if (nodeIndex.has(textEditingNodeId)) {
      return
    }

    if (pendingTextAutofocusNodeIdRef.current === textEditingNodeId) {
      return
    }

    stopTextEditing()
  }, [nodeIndex, stopTextEditing, textEditingNodeId])

  const orderedNodes = useMemo(() => {
    return [...canvasNodes].sort((left, right) => compareNodePriority(left, right, activeNodeId))
  }, [activeNodeId, canvasNodes])

  useEffect(() => {
    if (!pendingCommentAutofocusNodeId) {
      return
    }

    const nodeStillExists = canvasNodes.some((node) => node.id === pendingCommentAutofocusNodeId)
    if (!nodeStillExists) {
      setPendingCommentAutofocusNodeId(null)
    }
  }, [canvasNodes, pendingCommentAutofocusNodeId])

  const paneRect = paneRef.current?.getBoundingClientRect()
  const paneSize = useMemo(
    () => ({
      width: paneRect?.width ?? 0,
      height: paneRect?.height ?? 0
    }),
    [paneRect?.height, paneRect?.width]
  )
  const worldBounds = useMemo(() => {
    const visibleWorldWidth = paneSize.width / Math.max(0.3, viewport.zoom)
    const visibleWorldHeight = paneSize.height / Math.max(0.3, viewport.zoom)
    const nodeExtentX = canvasNodes.reduce((max, node) => Math.max(max, node.x + node.width), 0)
    const nodeExtentY = canvasNodes.reduce((max, node) => Math.max(max, node.y + node.height), 0)
    const noteExtentX = activeNote ? activeNote.x + activeNote.width : 0
    const noteExtentY = activeNote ? activeNote.y + activeNote.height : 0
    const previewExtentX = linkingState ? Math.max(linkingState.startX, linkingState.currentX) : 0
    const previewExtentY = linkingState ? Math.max(linkingState.startY, linkingState.currentY) : 0

    return {
      width: Math.max(2200, visibleWorldWidth + 240, nodeExtentX + 120, noteExtentX + 120, previewExtentX + 120),
      height: Math.max(1800, visibleWorldHeight + 200, nodeExtentY + 120, noteExtentY + 120, previewExtentY + 120)
    }
  }, [activeNote, canvasNodes, linkingState, paneSize.height, paneSize.width, viewport.zoom])

  const clampViewport = useCallback(
    (next: WorkspaceViewportState): WorkspaceViewportState => {
      const pane = paneRef.current
      const paneRect = pane?.getBoundingClientRect() ?? null
      const zoom = clampZoom(next.zoom)
      if (!paneRect) {
        return {
          ...next,
          zoom
        }
      }

      const scaledWidth = worldBounds.width * zoom
      const scaledHeight = worldBounds.height * zoom
      const minPanX = Math.min(WORKSPACE_NODE_MARGIN, paneRect.width - scaledWidth - WORKSPACE_NODE_MARGIN)
      const minPanY = Math.min(WORKSPACE_NODE_MARGIN, paneRect.height - scaledHeight - WORKSPACE_NODE_MARGIN)
      const maxPanX = WORKSPACE_NODE_MARGIN
      const maxPanY = WORKSPACE_NODE_MARGIN

      return {
        zoom,
        panX: Math.min(maxPanX, Math.max(minPanX, next.panX)),
        panY: Math.min(maxPanY, Math.max(minPanY, next.panY))
      }
    },
    [paneRef, worldBounds.height, worldBounds.width]
  )

  const commitViewport = useCallback((next: WorkspaceViewportState) => {
    const clampedNext = clampViewport(next)
    viewportRef.current = clampedNext
    pendingViewportRef.current = clampedNext
    if (viewportFrameRef.current !== null) {
      return
    }

    viewportFrameRef.current = requestAnimationFrame(() => {
      viewportFrameRef.current = null
      onViewportChange(pendingViewportRef.current)
    })
  }, [clampViewport, onViewportChange])

  const getVisibleWorkspaceBounds = useCallback((paneRect: DOMRect, zoom: number) => {
    const left = Math.max(WORKSPACE_NODE_MARGIN, (-viewportRef.current.panX + WORKSPACE_NODE_MARGIN) / zoom)
    const top = Math.max(WORKSPACE_NODE_MARGIN, (-viewportRef.current.panY + WORKSPACE_NODE_MARGIN) / zoom)
    const right = Math.max(left, (paneRect.width - viewportRef.current.panX - WORKSPACE_NODE_MARGIN) / zoom)
    const bottom = Math.max(top, (paneRect.height - viewportRef.current.panY - WORKSPACE_NODE_MARGIN) / zoom)

    return { left, top, right, bottom }
  }, [])

  useEffect(() => {
    const getDragBounds = () => {
      const pane = paneRef.current
      const paneRect = pane?.getBoundingClientRect() ?? null
      const zoom = Math.max(0.3, viewportRef.current.zoom)
      const visibleWorldWidth = (paneRect?.width ?? 0) / zoom
      const visibleWorldHeight = (paneRect?.height ?? 0) / zoom
      const nodeExtentX = canvasNodes.reduce((max, entry) => Math.max(max, entry.x + entry.width), 0)
      const nodeExtentY = canvasNodes.reduce((max, entry) => Math.max(max, entry.y + entry.height), 0)
      const noteExtentX = activeNote ? activeNote.x + activeNote.width : 0
      const noteExtentY = activeNote ? activeNote.y + activeNote.height : 0
      const previewExtentX = linkingState ? Math.max(linkingState.startX, linkingState.currentX) : 0
      const previewExtentY = linkingState ? Math.max(linkingState.startY, linkingState.currentY) : 0

      return {
        width: Math.max(2200, visibleWorldWidth + 240, nodeExtentX + 120, noteExtentX + 120, previewExtentX + 120),
        height: Math.max(1800, visibleWorldHeight + 200, nodeExtentY + 120, noteExtentY + 120, previewExtentY + 120)
      }
    }

    function handlePointerMove(event: PointerEvent) {
      const panning = panRef.current
      if (panning && panning.pointerId === event.pointerId) {
        commitViewport({
          ...viewportRef.current,
          panX: panning.startPanX + (event.clientX - panning.startClientX),
          panY: panning.startPanY + (event.clientY - panning.startClientY)
        })
        return
      }

      const drag = dragRef.current
      const pane = paneRef.current
      if (!pane) {
        return
      }

      const paneRect = pane.getBoundingClientRect()
      const zoom = Math.max(0.3, viewportRef.current.zoom)
      const linking = linkingRef.current
      if (linking) {
        const nextLinking = {
          ...linking,
          currentX: (event.clientX - paneRect.left - viewportRef.current.panX) / zoom,
          currentY: (event.clientY - paneRect.top - viewportRef.current.panY) / zoom
        }
        linkingRef.current = nextLinking
        setLinkingState(nextLinking)
        return
      }

      const resize = resizeRef.current
      if (resize) {
        const node = nodeIndex.get(resize.nodeId)
        if (!node) {
          return
        }
        if (node.kind === 'text' && activeTextEditingNodeIdRef.current === node.id) {
          return
        }

        const isRichTextNode = node.kind === 'comment' || node.kind === 'text'
        const minWidth = isRichTextNode ? 240 : 220
        const minHeight = isRichTextNode ? 120 : 110
        const dx = (event.clientX - resize.startX) / zoom
        const dy = (event.clientY - resize.startY) / zoom
        const direction = resize.direction
        let nextWidth = resize.startWidth
        let nextHeight = resize.startHeight
        let nextX = resize.startNodeX
        let nextY = resize.startNodeY
        const visibleBounds = getVisibleWorkspaceBounds(paneRect, zoom)

        if (direction.includes('right')) {
          nextWidth = Math.min(3200, Math.max(minWidth, resize.startWidth + dx))
        }

        if (direction.includes('left')) {
          const candidateWidth = Math.min(3200, Math.max(minWidth, resize.startWidth - dx))
          nextWidth = candidateWidth
          nextX = resize.startNodeX + (resize.startWidth - candidateWidth)
        }

        if (direction.includes('bottom')) {
          nextHeight = Math.min(2400, Math.max(minHeight, resize.startHeight + dy))
        }

        if (direction.includes('top')) {
          const candidateHeight = Math.min(2400, Math.max(minHeight, resize.startHeight - dy))
          nextHeight = candidateHeight
          nextY = resize.startNodeY + (resize.startHeight - candidateHeight)
        }

        nextX = Math.max(visibleBounds.left, nextX)
        nextY = Math.max(visibleBounds.top, nextY)
        nextWidth = Math.min(nextWidth, Math.max(minWidth, visibleBounds.right - nextX))
        nextHeight = Math.min(nextHeight, Math.max(minHeight, visibleBounds.bottom - nextY))

        onCanvasNodesChange((current) =>
          current.map((entry) =>
            entry.id === resize.nodeId
              ? {
                  ...entry,
                  x: nextX,
                  y: nextY,
                  width: nextWidth,
                  height: nextHeight,
                  updatedAt: new Date().toISOString()
                }
              : entry
          )
        )
        return
      }

      const press = pressRef.current
      if (!drag && press) {
        const deltaX = event.clientX - press.startClientX
        const deltaY = event.clientY - press.startClientY
        if (Math.hypot(deltaX, deltaY) > 5) {
          dragRef.current = {
            nodeId: press.nodeId,
            offsetX: press.offsetX,
            offsetY: press.offsetY
          }
          pressRef.current = null
        }
      }

      const activeDrag = dragRef.current
      if (!activeDrag) {
        return
      }

      const node = nodeIndex.get(activeDrag.nodeId)
      if (!node) {
        return
      }
      // Use the ref (not state) so we see the synchronous update from stopTextEditing()
      if (node.kind === 'text' && activeTextEditingNodeIdRef.current === node.id) {
        dragRef.current = null
        return
      }

      const unclampedX = (event.clientX - paneRect.left - viewportRef.current.panX) / zoom - activeDrag.offsetX
      const unclampedY = (event.clientY - paneRect.top - viewportRef.current.panY) / zoom - activeDrag.offsetY
      const dragBounds = getDragBounds()
      const visibleBounds = getVisibleWorkspaceBounds(paneRect, zoom)
      const minX = visibleBounds.left
      const minY = visibleBounds.top
      const maxX = Math.min(
        Math.max(minX, dragBounds.width - node.width - WORKSPACE_NODE_MARGIN),
        Math.max(minX, visibleBounds.right - node.width)
      )
      const maxY = Math.min(
        Math.max(minY, dragBounds.height - node.height - WORKSPACE_NODE_MARGIN),
        Math.max(minY, visibleBounds.bottom - node.height)
      )
      const nextX = Math.min(maxX, Math.max(minX, unclampedX))
      const nextY = Math.min(maxY, Math.max(minY, unclampedY))

      const relatedExcerpt =
        node.kind === 'comment' && node.excerptId
          ? Array.from(nodeIndex.values()).find((entry) => entry.kind === 'excerpt' && entry.excerptId === node.excerptId)
          : null
      const snappedX =
        relatedExcerpt && Math.abs(nextX - (relatedExcerpt.x + relatedExcerpt.width + 24)) < COMMENT_SNAP_THRESHOLD
          ? relatedExcerpt.x + relatedExcerpt.width + 24
          : nextX
      const snappedY =
        relatedExcerpt && Math.abs(nextY - relatedExcerpt.y) < COMMENT_SNAP_THRESHOLD ? relatedExcerpt.y : nextY

      onCanvasNodesChange((current) =>
        current.map((entry) =>
          entry.id === activeDrag.nodeId
            ? {
                ...entry,
                x: snappedX,
                y: snappedY,
                updatedAt: new Date().toISOString()
              }
            : entry
        )
      )
    }

    function handlePointerUp(event: PointerEvent) {
      const linking = linkingRef.current
      if (linking) {
        const target = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null
        const targetNodeId = target?.closest<HTMLElement>('.workspace-node')?.dataset.nodeId ?? null
        if (targetNodeId && targetNodeId !== linking.fromNodeId) {
          onCreateWorkspaceLink(linking.fromNodeId, targetNodeId)
        }
        linkingRef.current = null
        setLinkingState(null)
      }
      resizeRef.current = null
      dragRef.current = null
      pressRef.current = null
      document.body.classList.remove('is-resizing')
      if (panRef.current?.pointerId === event.pointerId) {
        panRef.current = null
      }
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [activeNote, activeTextEditingNodeId, canvasNodes, commitViewport, getVisibleWorkspaceBounds, linkingState, nodeIndex, onCanvasNodesChange, onCreateWorkspaceLink, onViewportChange, paneRef])

  useEffect(() => {
    const clamped = clampViewport(viewport)
    if (
      clamped.zoom !== viewport.zoom ||
      clamped.panX !== viewport.panX ||
      clamped.panY !== viewport.panY
    ) {
      commitViewport(clamped)
    }
  }, [clampViewport, commitViewport, viewport])

  useEffect(() => {
    activeTextSelectionRectRef.current = activeTextSelectionRect
  }, [activeTextSelectionRect])

  const zoomWorkspaceOut = useCallback(() => {
    commitViewport({
      ...viewportRef.current,
      zoom: clampZoom(viewportRef.current.zoom - 0.1)
    })
  }, [commitViewport])

  const zoomWorkspaceIn = useCallback(() => {
    commitViewport({
      ...viewportRef.current,
      zoom: clampZoom(viewportRef.current.zoom + 0.1)
    })
  }, [commitViewport])

  return (
    <div
      className="workspace-canvas-shell"
      onPointerDown={(event) => {
        const target = event.target as HTMLElement | null
        if (
          target?.closest('.workspace-textbox-editor') ||
          target?.closest('.workspace-textbox-toolbar') ||
          target?.closest('.workspace-tool-rail') ||
          target?.closest('.workspace-tool-btn')
        ) {
          return
        }

        if (target?.closest('.note-node')) {
          stopTextEditing()
          return
        }

        if (!target?.closest('.workspace-node') && !target?.closest('.note-node')) {
          onClearSelection()
          stopTextEditing()
        }

        if (
          event.button !== 0 ||
          target?.closest('.workspace-node') ||
          target?.closest('.workspace-node-link-layer') ||
          target?.closest('.note-node')
        ) {
          return
        }

        panRef.current = {
          pointerId: event.pointerId,
          startClientX: event.clientX,
          startClientY: event.clientY,
          startPanX: viewportRef.current.panX,
          startPanY: viewportRef.current.panY
        }
      }}
      onWheel={(event) => {
        if (!event.ctrlKey) {
          return
        }

        event.preventDefault()
        const paneRect = paneRef.current?.getBoundingClientRect()
        if (!paneRect) {
          return
        }

        const current = viewportRef.current
        const pointerX = event.clientX - paneRect.left
        const pointerY = event.clientY - paneRect.top
        const worldX = (pointerX - current.panX) / current.zoom
        const worldY = (pointerY - current.panY) / current.zoom
        const nextZoom = Math.min(3, Math.max(0.3, current.zoom * Math.exp(-event.deltaY * 0.0012)))

        commitViewport({
          zoom: nextZoom,
          panX: pointerX - worldX * nextZoom,
          panY: pointerY - worldY * nextZoom
        })
      }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault()
        const raw = event.dataTransfer.getData('application/vnd.document-intelligence.excerpt')
        if (!raw) {
          return
        }

        const payload = JSON.parse(raw) as { excerpt: Excerpt; anchor: PageAnchor }
        const paneRect = paneRef.current?.getBoundingClientRect()
        const x = paneRect ? (event.clientX - paneRect.left - viewportRef.current.panX) / viewportRef.current.zoom : 120
        const y = paneRect ? (event.clientY - paneRect.top - viewportRef.current.panY) / viewportRef.current.zoom : 120
        onDropSelection({ ...payload, x, y })
      }}
    >
      <div className="workspace-canvas-titlebar">
        <div className="split-title workspace-canvas-title">Workspace</div>
        <div className="workspace-canvas-zoom-controls" aria-label="Workspace zoom controls">
          <button
            type="button"
            className="workspace-canvas-zoom-button"
            aria-label="Zoom out workspace"
            title="Zoom out workspace"
            onPointerDown={(event) => {
              event.preventDefault()
              event.stopPropagation()
            }}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              zoomWorkspaceOut()
            }}
          >
            −
          </button>
          <button
            type="button"
            className="workspace-canvas-zoom-button"
            aria-label="Zoom in workspace"
            title="Zoom in workspace"
            onPointerDown={(event) => {
              event.preventDefault()
              event.stopPropagation()
            }}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              zoomWorkspaceIn()
            }}
          >
            +
          </button>
        </div>
      </div>
      <div className="workspace-canvas-viewport">
        <div
          className="workspace-canvas-surface"
          style={{
            width: worldBounds.width,
            height: worldBounds.height,
            transform: `translate(${viewport.panX}px, ${viewport.panY}px) scale(${viewport.zoom})`
          }}
        >
          <WorkspaceNodeLinkLayer
            paneWidth={worldBounds.width}
            paneHeight={worldBounds.height}
            nodes={canvasNodes}
            links={workspaceLinks}
            linkingState={linkingState}
            activeNodeId={activeNodeId}
            disabled={Boolean(textEditingNodeId)}
            onOpenLink={onOpenWorkspaceLink}
          />
          {activeNote ? (
            <NoteNode
              note={activeNote}
              excerpts={noteExcerpts}
              zoom={viewport.zoom}
              onNoteChange={onNoteChange}
            />
          ) : null}
          {orderedNodes.map((node) =>
            node.kind === 'comment' ? (
              <CommentNode
                key={node.id}
                node={node}
                active={activeNodeId === node.id}
                autoFocusEditor={pendingCommentAutofocusNodeId === node.id && activeNodeId === node.id}
                onAutoFocusApplied={() => {
                  setPendingCommentAutofocusNodeId((current) => (current === node.id ? null : current))
                }}
                onSelect={() => {
                  stopTextEditing()
                  onFocusNode(node.id)
                  if (node.sourceAnchorId) {
                    onOpenAnchor(node.sourceAnchorId, node.id)
                  }
                }}
                onHandlePointerDown={(event) => {
                  event.preventDefault()
                  stopTextEditing()
                  onFocusNode(node.id)
                  if (node.sourceAnchorId) {
                    onOpenAnchor(node.sourceAnchorId, node.id)
                  }
                  dragRef.current = {
                    nodeId: node.id,
                    offsetX: (event.clientX - (paneRef.current?.getBoundingClientRect().left ?? 0) - viewportRef.current.panX) / viewportRef.current.zoom - node.x,
                    offsetY: (event.clientY - (paneRef.current?.getBoundingClientRect().top ?? 0) - viewportRef.current.panY) / viewportRef.current.zoom - node.y
                  }
                }}
                onTextChange={(nextValue) =>
                  onCanvasNodesChange((current) =>
                    current.map((entry) =>
                      entry.id === node.id
                        ? {
                            ...entry,
                            text: nextValue,
                            updatedAt: new Date().toISOString()
                          }
                        : entry
                    )
                  )
                }
                onOpenAnchor={() => {
                  stopTextEditing()
                  onFocusNode(node.id)
                  if (node.sourceAnchorId) {
                    onOpenAnchor(node.sourceAnchorId, node.id)
                  }
                }}
                onStartLink={(event) => {
                  stopTextEditing()
                  const startX = node.x + node.width
                  const startY = node.y + Math.min(node.height / 2, 48)
                  const paneRect = paneRef.current?.getBoundingClientRect()
                  const currentX = paneRect ? (event.clientX - paneRect.left - viewportRef.current.panX) / viewportRef.current.zoom : startX
                  const currentY = paneRect ? (event.clientY - paneRect.top - viewportRef.current.panY) / viewportRef.current.zoom : startY
                  const nextState = { fromNodeId: node.id, startX, startY, currentX, currentY }
                  linkingRef.current = nextState
                  setLinkingState(nextState)
                  onFocusNode(node.id)
                }}
                onStartResize={(event, direction) => {
                  stopTextEditing()
                  resizeRef.current = {
                    nodeId: node.id,
                    direction,
                    startX: event.clientX,
                    startY: event.clientY,
                    startNodeX: node.x,
                    startNodeY: node.y,
                    startWidth: node.width,
                    startHeight: node.height
                  }
                  document.body.classList.add('is-resizing')
                  onFocusNode(node.id)
                }}
              />
            ) : node.kind === 'text' ? (
              <TextBoxNode
                key={node.id}
                node={node}
                active={activeNodeId === node.id}
                isEditing={textEditingNodeId === node.id}
                onSelect={() => {
                  if (textEditingNodeId !== node.id) {
                    stopTextEditing()
                  }
                  onFocusNode(node.id)
                }}
                onEditorHandleChange={(handle) => {
                  registerTextEditorHandle(node.id, handle)
                }}
                onSelectionChange={(state) => {
                  updateTextSelection(node.id, state)
                }}
                onEnterEdit={() => {
                  beginTextEditing(node.id)
                }}
                onExitEdit={() => {
                  if (textEditingNodeId === node.id) {
                    stopTextEditing()
                  }
                }}
                onDelete={() => {
                  if (textEditingNodeId === node.id) {
                    stopTextEditing()
                  }
                  onCanvasNodesChange((current) => {
                    const result = deleteCanvasNode(current, node.id)
                    if (!result.ok) {
                      console.error('[WorkspaceCanvas] failed to delete canvas node', { nodeId: node.id }, result.error)
                      return current
                    }
                    return result.value
                  })
                }}
                onHandlePointerDown={(event) => {
                  // Exit edit mode synchronously via ref so the pointermove guard
                  // sees a cleared editing node id immediately.
                  stopTextEditing()
                  event.preventDefault()
                  onFocusNode(node.id)
                  const paneRect = paneRef.current?.getBoundingClientRect()
                  dragRef.current = {
                    nodeId: node.id,
                    offsetX:
                      (event.clientX - (paneRect?.left ?? 0) - viewportRef.current.panX) /
                        viewportRef.current.zoom -
                      node.x,
                    offsetY:
                      (event.clientY - (paneRect?.top ?? 0) - viewportRef.current.panY) /
                        viewportRef.current.zoom -
                      node.y
                  }
                }}
                onChange={(patch) => {
                  onCanvasNodesChange((current) => {
                    const result = updateCanvasNode(current, node.id, patch)
                    if (!result.ok) {
                      console.error('[WorkspaceCanvas] failed to update canvas node', { nodeId: node.id, patch }, result.error)
                      return current
                    }
                    return result.value
                  })
                  requestAnimationFrame(() => {
                    refreshOpenTextToolbarPositions()
                  })
                }}
                onStartResize={(event, direction) => {
                  stopTextEditing()
                  resizeRef.current = {
                    nodeId: node.id,
                    direction,
                    startX: event.clientX,
                    startY: event.clientY,
                    startNodeX: node.x,
                    startNodeY: node.y,
                    startWidth: node.width,
                    startHeight: node.height
                  }
                  document.body.classList.add('is-resizing')
                  onFocusNode(node.id)
                }}
              />
            ) : (
              <ExcerptNode
                key={node.id}
                node={node}
                active={activeNodeId === node.id}
                onHandlePointerDown={(event) => {
                  stopTextEditing()
                  onFocusNode(node.id)
                  if (node.sourceAnchorId) {
                    onOpenAnchor(node.sourceAnchorId, node.id)
                  }
                  pressRef.current = {
                    nodeId: node.id,
                    offsetX: (event.clientX - (paneRef.current?.getBoundingClientRect().left ?? 0) - viewportRef.current.panX) / viewportRef.current.zoom - node.x,
                    offsetY: (event.clientY - (paneRef.current?.getBoundingClientRect().top ?? 0) - viewportRef.current.panY) / viewportRef.current.zoom - node.y,
                    startClientX: event.clientX,
                    startClientY: event.clientY
                  }
                }}
                onSelect={() => {
                  stopTextEditing()
                  onFocusNode(node.id)
                  if (node.sourceAnchorId) {
                    onOpenAnchor(node.sourceAnchorId, node.id)
                  }
                }}
                onOpenAnchor={() => {
                  stopTextEditing()
                  onFocusNode(node.id)
                  if (node.sourceAnchorId) {
                    onOpenAnchor(node.sourceAnchorId, node.id)
                  }
                }}
                onStartLink={(event) => {
                  stopTextEditing()
                  const startX = node.x + node.width
                  const startY = node.y + Math.min(node.height / 2, 48)
                  const paneRect = paneRef.current?.getBoundingClientRect()
                  const currentX = paneRect ? (event.clientX - paneRect.left - viewportRef.current.panX) / viewportRef.current.zoom : startX
                  const currentY = paneRect ? (event.clientY - paneRect.top - viewportRef.current.panY) / viewportRef.current.zoom : startY
                  const nextState = { fromNodeId: node.id, startX, startY, currentX, currentY }
                  linkingRef.current = nextState
                  setLinkingState(nextState)
                  onFocusNode(node.id)
                }}
                onStartResize={(event, direction) => {
                  stopTextEditing()
                  resizeRef.current = {
                    nodeId: node.id,
                    direction,
                    startX: event.clientX,
                    startY: event.clientY,
                    startNodeX: node.x,
                    startNodeY: node.y,
                    startWidth: node.width,
                    startHeight: node.height
                  }
                  document.body.classList.add('is-resizing')
                  onFocusNode(node.id)
                }}
              />
            )
          )}
        </div>
      </div>
      {(() => {
        if (!activeTextEditingNodeId) {
          return null
        }

        const toolbarRect = activeTextSelectionRect ?? resolveTextToolbarFallbackRect(activeTextEditingNodeId)
        if (!toolbarRect) {
          return null
        }

        return (
          <WorkspaceSelectionToolbar
            editor={textEditorHandlesRef.current.get(activeTextEditingNodeId) ?? null}
            nodeId={activeTextEditingNodeId}
            left={toolbarRect.left + toolbarRect.width / 2}
            top={toolbarRect.top}
            onInteractionChange={(active) => {
              isTextToolbarInteractingRef.current = active
              if (active && activeTextEditingNodeIdRef.current) {
                syncTextToolbarForNode(activeTextEditingNodeIdRef.current)
                return
              }

              requestAnimationFrame(() => {
                const nodeId = activeTextEditingNodeIdRef.current
                if (!nodeId) {
                  closeTextToolbar()
                  return
                }

                // Ending toolbar interaction should only refresh visibility. External clicks and
                // explicit canvas actions already own the decision to leave text-edit mode.
                syncTextToolbarForNode(nodeId)
              })
            }}
          />
        )
      })()}
      <WorkspaceToolRail
        ctx={{
          onCreateTextBox,
          onCreateAddWorkspace: () => createFreeNode('comment')
        }}
      />
    </div>
  )
}
