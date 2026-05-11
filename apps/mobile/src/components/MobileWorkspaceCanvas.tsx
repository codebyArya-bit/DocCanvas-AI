'use client'

import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import type { CanvasEdge, CanvasNode, TextStyle } from '@workspace/domain'
import type { MobileWorkspaceLink, MobileWorkspaceViewport } from '../lib/mobile-store'

interface MobileWorkspaceCanvasProps {
  documentId: string
  nodes: CanvasNode[]
  canvasEdges: CanvasEdge[]
  links: MobileWorkspaceLink[]
  viewport: MobileWorkspaceViewport & { workspaceZoom: number }
  appZoom?: number
  activeAnchorId?: string | null
  activeNodeId?: string | null
  linkLayoutKey?: string
  locked?: boolean
  onNodesChange: (nodes: CanvasNode[]) => void
  onWorkspaceGraphChange?: (nodes: CanvasNode[], canvasEdges: CanvasEdge[]) => void
  onLinksChange: (links: MobileWorkspaceLink[]) => void
  onDeleteNode?: (nodeId: string) => void
  onViewportChange: (viewport: MobileWorkspaceViewport & { workspaceZoom: number }) => void
  onActiveNodeChange: (nodeId: string | null) => void
  onOpenAnchor: (anchorId: string, nodeId?: string) => void
  onCreateNode: (kind: 'text' | 'comment') => void
}

type DragState =
  | { kind: 'node'; nodeId: string; startX: number; startY: number; nodeX: number; nodeY: number }
  | {
      kind: 'resize'
      nodeId: string
      direction: NodeResizeDirection
      startX: number
      startY: number
      nodeX: number
      nodeY: number
      width: number
      height: number
    }
  | { kind: 'pan'; startX: number; startY: number; panX: number; panY: number }

type NodeResizeDirection =
  | 'top'
  | 'bottom'
  | 'left'
  | 'right'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'

type AnchorLinkLine = {
  id: string
  path: string
  color: string
  active: boolean
  x1: number
  y1: number
  x2: number
  y2: number
}

type LinkLayerBounds = {
  left: number
  top: number
  width: number
  height: number
}

const WORKSPACE_SWATCHES = ['var(--swatch-red)', 'var(--swatch-yellow)', 'var(--swatch-cyan)', 'var(--swatch-blue)', 'var(--swatch-purple)']
const FONT_OPTIONS = [
  { label: 'System Sans', value: '"Segoe UI", system-ui, sans-serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Courier', value: '"Courier New", monospace' }
]
const PRESET_OPTIONS: Array<{ label: string; value: NonNullable<TextStyle['preset']> }> = [
  { label: 'Body', value: 'body' },
  { label: 'Heading 1', value: 'heading-1' },
  { label: 'Heading 2', value: 'heading-2' },
  { label: 'Quote', value: 'quote' }
]
const MIN_WORKSPACE_ZOOM = 0.3
const MAX_WORKSPACE_ZOOM = 3

export function parseWorkspaceToolbarTags(value: string) {
  return value.split(',').map((tag) => tag.trim()).filter(Boolean)
}

export function buildWorkspaceNodeLinkText(node: Pick<CanvasNode, 'id' | 'sourceAnchorId'>) {
  return node.sourceAnchorId ? `anchor:${node.sourceAnchorId}` : `node:${node.id}`
}

function boxesOverlap(left: Pick<CanvasNode, 'x' | 'y' | 'width' | 'height'>, right: Pick<CanvasNode, 'x' | 'y' | 'width' | 'height'>) {
  return left.x < right.x + right.width && left.x + left.width > right.x && left.y < right.y + right.height && left.y + left.height > right.y
}

export function findFirstAvailableWorkspacePosition(
  candidates: Array<Pick<CanvasNode, 'x' | 'y' | 'width' | 'height'>>,
  nodes: CanvasNode[],
  ignoreNodeId?: string
) {
  return candidates.find((candidate) => !nodes.some((node) => node.id !== ignoreNodeId && node.visible !== false && boxesOverlap(candidate, node))) ?? candidates[0]
}

export function buildLinkedCommentNodeAndEdge(sourceNode: CanvasNode, nodes: CanvasNode[]) {
  if (!sourceNode.sourceAnchorId) return null
  const now = new Date().toISOString()
  const siblingCount = nodes.filter((node) => node.kind === 'comment' && node.sourceAnchorId === sourceNode.sourceAnchorId).length
  const nodeId = `comment-node-${sourceNode.sourceAnchorId}-${Date.now()}-${siblingCount + 1}`
  const relatedExcerptNode = nodes.find((node) => node.kind === 'excerpt' && node.excerptId === sourceNode.excerptId) ?? sourceNode
  const baseNode: CanvasNode = {
    id: nodeId,
    workspaceId: sourceNode.workspaceId,
    kind: 'comment',
    excerptId: sourceNode.excerptId,
    documentId: sourceNode.documentId,
    sourceAnchorId: sourceNode.sourceAnchorId,
    selectionColor: sourceNode.selectionColor,
    nodeColor: undefined,
    title: 'Comment',
    text: '',
    tags: sourceNode.tags,
    textStyle: sourceNode.textStyle,
    x: relatedExcerptNode.x + relatedExcerptNode.width + 28,
    y: relatedExcerptNode.y,
    width: 300,
    height: 156,
    visible: true,
    createdAt: now,
    updatedAt: now
  }
  const candidateBoxes = [
    { x: relatedExcerptNode.x + relatedExcerptNode.width + 28, y: relatedExcerptNode.y, width: baseNode.width, height: baseNode.height },
    { x: relatedExcerptNode.x - baseNode.width - 28, y: relatedExcerptNode.y, width: baseNode.width, height: baseNode.height },
    { x: relatedExcerptNode.x + relatedExcerptNode.width + 28, y: relatedExcerptNode.y + baseNode.height + 18, width: baseNode.width, height: baseNode.height },
    { x: relatedExcerptNode.x - baseNode.width - 28, y: relatedExcerptNode.y + baseNode.height + 18, width: baseNode.width, height: baseNode.height },
    { x: sourceNode.x + sourceNode.width + 28, y: sourceNode.y + siblingCount * 24, width: baseNode.width, height: baseNode.height }
  ]
  const position = findFirstAvailableWorkspacePosition(candidateBoxes, nodes, nodeId)
  const node = { ...baseNode, x: position.x, y: position.y }
  const edge: CanvasEdge = {
    id: `edge-${sourceNode.sourceAnchorId}-${node.id}`,
    workspaceId: sourceNode.workspaceId,
    sourceAnchorId: sourceNode.sourceAnchorId,
    targetNodeId: node.id,
    kind: 'auto',
    color: sourceNode.selectionColor,
    createdAt: now,
    updatedAt: now
  }
  return { node, edge }
}

export function MobileWorkspaceCanvas({
  documentId,
  nodes,
  canvasEdges,
  links,
  viewport,
  appZoom = 1,
  activeAnchorId,
  activeNodeId,
  linkLayoutKey,
  locked = false,
  onNodesChange,
  onWorkspaceGraphChange,
  onLinksChange,
  onDeleteNode,
  onViewportChange,
  onActiveNodeChange,
  onOpenAnchor,
  onCreateNode
}: MobileWorkspaceCanvasProps) {
  const [dragging, setDragging] = useState<DragState | null>(null)
  const [linkingFrom, setLinkingFrom] = useState<string | null>(null)
  const [anchorLines, setAnchorLines] = useState<AnchorLinkLine[]>([])
  const [linkLayerBounds, setLinkLayerBounds] = useState<LinkLayerBounds>({ left: 0, top: 0, width: 0, height: 0 })
  const [toolbarToolsOpen, setToolbarToolsOpen] = useState(false)
  const [tagsDraft, setTagsDraft] = useState('')
  const surfaceRef = useRef<HTMLDivElement | null>(null)
  const documentNodes = useMemo(() => nodes.filter((node) => node.documentId === documentId && node.visible !== false), [documentId, nodes])
  const activeNode = documentNodes.find((node) => node.id === activeNodeId) ?? null
  const resizeDirections: NodeResizeDirection[] = ['top', 'bottom', 'left', 'right', 'top-left', 'top-right', 'bottom-left', 'bottom-right']
  const activeTextStyle = activeNode?.textStyle ?? {}
  const activeFontSize = activeTextStyle.fontSize ?? 16
  const parsedToolbarTags = useMemo(() => parseWorkspaceToolbarTags(tagsDraft), [tagsDraft])
  const [toolbarNodeId, setToolbarNodeId] = useState<string | null>(null)
  const [toolbarStatus, setToolbarStatus] = useState('')

  async function writeClipboard(text: string, fallbackMessage = 'Clipboard blocked') {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
        setToolbarStatus('Copied')
        return true
      }
    } catch {}

    try {
      const textArea = document.createElement('textarea')
      textArea.value = text
      textArea.setAttribute('readonly', '')
      textArea.style.position = 'fixed'
      textArea.style.left = '-9999px'
      document.body.appendChild(textArea)
      textArea.select()
      const copied = document.execCommand('copy')
      document.body.removeChild(textArea)
      setToolbarStatus(copied ? 'Copied' : fallbackMessage)
      return copied
    } catch {
      setToolbarStatus(fallbackMessage)
      return false
    }
  }

  function updateNode(nodeId: string, patch: Partial<CanvasNode>) {
    onNodesChange(nodes.map((node) => (node.id === nodeId ? { ...node, ...patch, updatedAt: new Date().toISOString() } : node)))
  }

  function removeNode(nodeId: string) {
    if (onDeleteNode) {
      onDeleteNode(nodeId)
      return
    }
    onNodesChange(nodes.filter((node) => node.id !== nodeId))
    onLinksChange(links.filter((link) => link.fromNodeId !== nodeId && link.toNodeId !== nodeId))
    if (activeNodeId === nodeId) onActiveNodeChange(null)
    if (toolbarNodeId === nodeId) setToolbarNodeId(null)
  }

  function bindToolbarAction(action?: () => void | Promise<unknown>) {
    return {
      onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
        event.preventDefault()
        event.stopPropagation()
      },
      onMouseDown: (event: ReactMouseEvent<HTMLElement>) => {
        event.preventDefault()
        event.stopPropagation()
      },
      onClick: (event: ReactMouseEvent<HTMLElement>) => {
        event.preventDefault()
        event.stopPropagation()
        void action?.()
      }
    }
  }

  function bindToolbarInput() {
    return {
      onPointerDown: (event: ReactPointerEvent<HTMLElement>) => event.stopPropagation(),
      onMouseDown: (event: ReactMouseEvent<HTMLElement>) => event.stopPropagation(),
      onClick: (event: ReactMouseEvent<HTMLElement>) => event.stopPropagation()
    }
  }

  function setViewportZoom(nextZoom: number) {
    const nextWorkspaceZoom = Math.max(MIN_WORKSPACE_ZOOM, Math.min(MAX_WORKSPACE_ZOOM, Number(nextZoom.toFixed(2))))
    const zoomFocusCandidates = documentNodes.filter((node) => node.kind === 'excerpt' || node.kind === 'comment')
    const zoomFocusNode =
      zoomFocusCandidates.find((node) => node.id === activeNodeId) ??
      [...zoomFocusCandidates].sort((left, right) => left.y - right.y || left.x - right.x || left.createdAt.localeCompare(right.createdAt))[0] ??
      null
    const rect = surfaceRef.current?.getBoundingClientRect()
    if (!rect) {
      onViewportChange({ ...viewport, workspaceZoom: nextWorkspaceZoom })
      return
    }
    const centerX = rect.width / Math.max(appZoom || 1, 0.1) / 2
    const targetScreenY = Math.min(rect.height / Math.max(appZoom || 1, 0.1) / 2, Math.max(140, rect.height * 0.32 / Math.max(appZoom || 1, 0.1)))
    const currentZoom = Math.max(viewport.workspaceZoom, MIN_WORKSPACE_ZOOM)
    const worldCenterX = zoomFocusNode ? zoomFocusNode.x + zoomFocusNode.width / 2 : (centerX - viewport.panX) / currentZoom
    const worldCenterY = zoomFocusNode ? zoomFocusNode.y + Math.min(zoomFocusNode.height / 2, 72) : (targetScreenY - viewport.panY) / currentZoom
    onViewportChange({
      ...viewport,
      workspaceZoom: nextWorkspaceZoom,
      panX: centerX - worldCenterX * nextWorkspaceZoom,
      panY: targetScreenY - worldCenterY * nextWorkspaceZoom
    })
  }

  function focusActiveNodeEditor() {
    if (!activeNodeId) return
    requestAnimationFrame(() => {
      surfaceRef.current?.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(activeNodeId)}"] [data-node-editor="true"]`)?.focus()
    })
  }

  function updateActiveTags(value: string | string[]) {
    if (!activeNode) return
    const tags = Array.isArray(value) ? value : value.split(',').map((tag) => tag.trim()).filter(Boolean)
    updateNode(activeNode.id, { tags })
    setTagsDraft(tags.join(', '))
  }

  function updateActiveStyle(style: Partial<TextStyle>) {
    if (!activeNode) return
    updateNode(activeNode.id, { textStyle: { ...(activeNode.textStyle ?? {}), ...style } })
  }

  function copyNodeLink(node: CanvasNode) {
    void writeClipboard(buildWorkspaceNodeLinkText(node))
  }

  function focusNodeEditor(nodeId: string) {
    requestAnimationFrame(() => {
      surfaceRef.current?.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(nodeId)}"] [data-node-editor="true"]`)?.focus()
    })
  }

  function createOrFocusLinkedComment() {
    if (!activeNode) {
      return
    }
    
    if (activeNode.sourceAnchorId) {
      const linkedComment = buildLinkedCommentNodeAndEdge(activeNode, nodes)
      
      if (!linkedComment) {
        return
      }
      
      const { node: commentNode, edge } = linkedComment
      
      if (onWorkspaceGraphChange) {
        onWorkspaceGraphChange([...nodes, commentNode], [...canvasEdges, edge])
      } else {
        onNodesChange([...nodes, commentNode])
      }
      
      onActiveNodeChange(commentNode.id)
      setToolbarNodeId(commentNode.id)
      focusNodeEditor(commentNode.id)
      return
    }

    if (activeNode.kind === 'comment') {
      focusActiveNodeEditor()
      return
    }

    updateNode(activeNode.id, { kind: 'comment', title: activeNode.title ?? 'Comment', excerptId: undefined, nodeColor: undefined })
    focusActiveNodeEditor()
  }

  function nodeAccentColor(node: CanvasNode) {
    const nodeColor = node.nodeColor?.trim().toLowerCase()
    if (nodeColor && !['#fff', '#ffffff', 'white', 'rgb(255, 255, 255)'].includes(nodeColor)) {
      return node.nodeColor
    }
    return node.selectionColor ?? '#5d5df6'
  }

  function visualNodeKind(node: CanvasNode) {
    if (node.kind === 'comment') {
      return 'comment'
    }
    if (node.kind === 'excerpt' || node.excerptId || node.id.startsWith('excerpt-node-') || node.id.startsWith('canvas-excerpt-')) {
      return 'excerpt'
    }
    return 'textbox'
  }

  function commitLink(toNodeId: string) {
    if (!linkingFrom || linkingFrom === toNodeId) {
      setLinkingFrom(null)
      return
    }
    if (links.some((link) => link.fromNodeId === linkingFrom && link.toNodeId === toNodeId)) {
      setLinkingFrom(null)
      return
    }
    onLinksChange([
      ...links,
      {
        id: `mobile-link-${linkingFrom}-${toNodeId}-${Date.now()}`,
        fromNodeId: linkingFrom,
        toNodeId,
        type: 'reference',
        createdAt: new Date().toISOString()
      }
    ])
    setLinkingFrom(null)
  }

  function buildBezierPath(fromX: number, fromY: number, toX: number, toY: number) {
    const dx = toX - fromX
    const control = Math.max(48, Math.abs(dx) * 0.35)
    return `M ${fromX} ${fromY} C ${fromX + control} ${fromY}, ${toX - control} ${toY}, ${toX} ${toY}`
  }

  function buildScreenBezierPath(fromX: number, fromY: number, toX: number, toY: number) {
    const dx = toX - fromX
    const control = Math.max(60, Math.abs(dx) * 0.42)
    return `M ${fromX} ${fromY} C ${fromX + control} ${fromY}, ${toX - control} ${toY}, ${toX} ${toY}`
  }

  function screenToWorld(clientX: number, clientY: number) {
    const rect = surfaceRef.current?.getBoundingClientRect()
    return {
      x: (clientX - (rect?.left ?? 0) - viewport.panX) / viewport.workspaceZoom,
      y: (clientY - (rect?.top ?? 0) - viewport.panY) / viewport.workspaceZoom
    }
  }

  function resizeNodePatch(dragging: Extract<DragState, { kind: 'resize' }>, clientX: number, clientY: number): Partial<CanvasNode> {
    const dx = (clientX - dragging.startX) / viewport.workspaceZoom
    const dy = (clientY - dragging.startY) / viewport.workspaceZoom
    const minWidth = 180
    const minHeight = 110
    let x = dragging.nodeX
    let y = dragging.nodeY
    let width = dragging.width
    let height = dragging.height

    if (dragging.direction.includes('right')) {
      width = Math.max(minWidth, dragging.width + dx)
    }
    if (dragging.direction.includes('bottom')) {
      height = Math.max(minHeight, dragging.height + dy)
    }
    if (dragging.direction.includes('left')) {
      width = Math.max(minWidth, dragging.width - dx)
      x = dragging.nodeX + dragging.width - width
    }
    if (dragging.direction.includes('top')) {
      height = Math.max(minHeight, dragging.height - dy)
      y = dragging.nodeY + dragging.height - height
    }

    return { x: Math.max(12, x), y: Math.max(12, y), width, height }
  }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setToolbarNodeId(null)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  useEffect(() => {
    const measure = () => {
      const surface = surfaceRef.current
      if (!surface) return
      const surfaceRect = surface.getBoundingClientRect()
      const scale = appZoom || 1
      
      const shell = document.querySelector<HTMLElement>('.mobile-viewer-body')
      const shellRect = shell?.getBoundingClientRect() ?? surfaceRect
      const viewerRect = surface.closest<HTMLElement>('.mobile-viewer')?.getBoundingClientRect()
      setLinkLayerBounds({
        left: viewerRect ? (shellRect.left - viewerRect.left) / scale : shellRect.left,
        top: viewerRect ? (shellRect.top - viewerRect.top) / scale : shellRect.top,
        width: shellRect.width / scale,
        height: shellRect.height / scale
      })
      
      const nextLines = canvasEdges.flatMap((edge) => {
        const node = documentNodes.find((entry) => entry.id === edge.targetNodeId)
        if (!node || typeof document === 'undefined') return []
        const anchor = document.querySelector<HTMLElement>(`button.page-anchor-indicator-right[data-anchor-id="${CSS.escape(edge.sourceAnchorId)}"]`) ?? document.querySelector<HTMLElement>(`[data-anchor-id="${CSS.escape(edge.sourceAnchorId)}"]`)
        const arrow = document.querySelector<HTMLElement>(`button.workspace-node-anchor-arrow[data-node-arrow-id="${CSS.escape(edge.targetNodeId)}"]`)
        if (!anchor || !arrow) return []
        const anchorRect = anchor.getBoundingClientRect()
        const arrowRect = arrow.getBoundingClientRect()
        if (anchorRect.width <= 0 || anchorRect.height <= 0 || arrowRect.width <= 0 || arrowRect.height <= 0) return []
        
        const x1 = anchorRect.left + anchorRect.width / 2
        const y1 = anchorRect.top + anchorRect.height / 2
        const x2 = arrowRect.left
        const y2 = arrowRect.top + arrowRect.height / 2
        
        if (
          x1 < shellRect.left || x1 > shellRect.right || y1 < shellRect.top || y1 > shellRect.bottom ||
          x2 < shellRect.left || x2 > shellRect.right || y2 < shellRect.top || y2 > shellRect.bottom
        ) {
          return []
        }

        const color = edge.color ?? node.selectionColor ?? '#5d5df6'
        const sourceX = (x1 - shellRect.left) / scale
        const sourceY = (y1 - shellRect.top) / scale
        const arrowX = (x2 - shellRect.left) / scale
        const arrowY = (y2 - shellRect.top) / scale
        return [
          {
            id: edge.id,
            path: buildScreenBezierPath(sourceX, sourceY, arrowX, arrowY),
            color,
            active: activeAnchorId === edge.sourceAnchorId || activeNodeId === edge.targetNodeId,
            x1: sourceX,
            y1: sourceY,
            x2: arrowX,
            y2: arrowY
          }
        ]
      })
      setAnchorLines(nextLines)
    }

    const frame = requestAnimationFrame(measure)
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [activeAnchorId, activeNodeId, appZoom, canvasEdges, documentNodes, linkLayoutKey, viewport])

  useEffect(() => {
    setTagsDraft((activeNode?.tags ?? []).join(', '))
    setToolbarToolsOpen(false)
  }, [activeNode?.id, activeNode?.tags])

  useEffect(() => {
    if (toolbarNodeId && !documentNodes.some((node) => node.id === toolbarNodeId)) {
      setToolbarNodeId(null)
    }
  }, [documentNodes, toolbarNodeId])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setToolbarNodeId(null)
        setToolbarToolsOpen(false)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  return (
    <section
      ref={surfaceRef}
      className={`mobile-workspace-canvas${locked ? ' is-locked' : ''}`}
      onPointerDown={(event) => {
        if (locked || event.target !== event.currentTarget) return
        setDragging({ kind: 'pan', startX: event.clientX, startY: event.clientY, panX: viewport.panX, panY: viewport.panY })
        setToolbarNodeId(null)
      }}
      onPointerMove={(event) => {
        if (!dragging || locked) return
        event.currentTarget.setPointerCapture(event.pointerId)
        if (dragging.kind === 'pan') {
          onViewportChange({ ...viewport, panX: dragging.panX + event.clientX - dragging.startX, panY: dragging.panY + event.clientY - dragging.startY })
          return
        }
        if (dragging.kind === 'resize') {
          updateNode(dragging.nodeId, resizeNodePatch(dragging, event.clientX, event.clientY))
          return
        }
        const next = screenToWorld(event.clientX, event.clientY)
        const start = screenToWorld(dragging.startX, dragging.startY)
        updateNode(dragging.nodeId, {
          x: Math.max(12, dragging.nodeX + next.x - start.x),
          y: Math.max(12, dragging.nodeY + next.y - start.y)
        })
      }}
      onPointerUp={() => setDragging(null)}
      onPointerCancel={() => setDragging(null)}
      onWheel={(event) => {
        if (!event.ctrlKey && !event.metaKey) return
        event.preventDefault()
        setViewportZoom(viewport.workspaceZoom * Math.exp(-event.deltaY * 0.001))
      }}
    >
      <div className="mobile-canvas-zoom-level" aria-label="Mobile Canvas Zoom Level">
        <button type="button" onClick={() => setViewportZoom(viewport.workspaceZoom - 0.1)}>-</button>
        <span>{Math.round(viewport.workspaceZoom * 100)}%</span>
        <button type="button" onClick={() => setViewportZoom(viewport.workspaceZoom + 0.1)}>+</button>
      </div>
      <div className="workspace-tool-rail" aria-label="Workspace tools">
        <button type="button" className="workspace-tool-btn" aria-label="Draw Textbox in Workspace" onClick={() => onCreateNode('text')}>
          <span className="workspace-tool-icon" aria-hidden="true">AB+</span>
        </button>
        <button type="button" className="workspace-tool-btn" aria-label="Add Workspace Card" onClick={() => onCreateNode('comment')}>
          <span className="workspace-tool-icon" aria-hidden="true">+</span>
        </button>
      </div>
      {activeNode && toolbarNodeId === activeNode.id ? (
        <div
          className="mobile-node-toolbar mobile-workspace-text-toolbar workspace-text-toolbar"
          style={{ top: Math.max(12, activeNode.y * viewport.workspaceZoom + viewport.panY - 68), left: Math.max(12, activeNode.x * viewport.workspaceZoom + viewport.panX), position: 'absolute', zIndex: 100 }}
          onPointerDown={(event) => event.stopPropagation()}
          onPointerUp={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="workspace-text-toolbar-actions">
            <button type="button" className="note-toolbar-btn note-toolbar-btn-action" {...bindToolbarAction(createOrFocusLinkedComment)}>Comment</button>
            <button type="button" className="note-toolbar-btn note-toolbar-btn-action" {...bindToolbarAction(focusActiveNodeEditor)}>Edit</button>
            <button type="button" className="note-toolbar-btn note-toolbar-btn-action" {...bindToolbarAction(() => writeClipboard(activeNode.text ?? ''))}>Copy</button>
            <button type="button" className="note-toolbar-btn note-toolbar-btn-action" {...bindToolbarAction(async () => { if (await writeClipboard(activeNode.text ?? '')) removeNode(activeNode.id) })}>Cut</button>
            <button type="button" className="note-toolbar-btn note-toolbar-btn-action" {...bindToolbarAction(() => copyNodeLink(activeNode))}>Copy Link</button>
            <button type="button" className="note-toolbar-btn note-toolbar-btn-action" disabled title="Child workspaces are not available in mobile V1" {...bindToolbarAction()}>To Child Workspace</button>
            <button type="button" className="note-toolbar-btn note-toolbar-btn-action" {...bindToolbarAction(() => removeNode(activeNode.id))}>Delete</button>
            <div className="workspace-text-toolbar-tag-wrap">
              <button type="button" className="note-toolbar-btn note-toolbar-btn-action" {...bindToolbarAction(() => {
                const nextTags = parsedToolbarTags.length ? parsedToolbarTags : activeNode.tags?.length ? activeNode.tags : ['tag']
                updateActiveTags(nextTags)
              })}>Tags</button>
              <input
                {...bindToolbarInput()}
                placeholder={(activeNode.tags ?? []).join(', ') || 'tags'}
                value={tagsDraft}
                onChange={(event) => setTagsDraft(event.target.value)}
                onBlur={() => updateActiveTags(parsedToolbarTags)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    updateActiveTags(parsedToolbarTags)
                  }
                }}
              />
            </div>
          </div>
          <span className="mobile-toolbar-status" aria-live="polite">{toolbarStatus}</span>
          <div className="workspace-text-toolbar-tools">
            {WORKSPACE_SWATCHES.map((color) => (
              <button key={color} className="workspace-text-toolbar-swatch" style={{ background: color }} type="button" {...bindToolbarAction(() => updateNode(activeNode.id, { nodeColor: color }))} />
            ))}
            <button className="workspace-text-toolbar-swatch workspace-text-toolbar-swatch-gradient" type="button" {...bindToolbarAction(() => updateNode(activeNode.id, { nodeColor: '#7c5cff' }))} />
            <button className={`workspace-text-toolbar-icon${activeTextStyle.strikethrough ? ' is-active' : ''}`} type="button" {...bindToolbarAction(() => updateActiveStyle({ strikethrough: !activeTextStyle.strikethrough }))}>/</button>
            <div className="workspace-text-toolbar-texttool">
              <button
                className={`workspace-text-toolbar-icon${toolbarToolsOpen ? ' is-active' : ''}`}
                type="button"
                onPointerDown={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                }}
                onMouseDown={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                }}
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  setToolbarToolsOpen((current) => !current)
                }}
              >
                Tt
              </button>
              {toolbarToolsOpen ? (
                <div className="workspace-text-toolbar-popover">
                  <label>
                    <span>Style</span>
                    <select className="note-toolbar-select" value={activeTextStyle.preset ?? 'body'} {...bindToolbarInput()} onChange={(event) => updateActiveStyle({ preset: event.target.value as TextStyle['preset'] })}>
                      {PRESET_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  </label>
                  <label>
                    <span>Font</span>
                    <select className="note-toolbar-select" value={activeTextStyle.fontFamily ?? FONT_OPTIONS[0].value} {...bindToolbarInput()} onChange={(event) => updateActiveStyle({ fontFamily: event.target.value })}>
                      {FONT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  </label>
                  <div className="workspace-text-toolbar-formatting">
                    <button type="button" className={`note-toolbar-btn${activeTextStyle.fontWeight === 'bold' ? ' is-active' : ''}`} {...bindToolbarAction(() => updateActiveStyle({ fontWeight: activeTextStyle.fontWeight === 'bold' ? 'normal' : 'bold' }))}>B</button>
                    <button type="button" className={`note-toolbar-btn${activeTextStyle.underline ? ' is-active' : ''}`} {...bindToolbarAction(() => updateActiveStyle({ underline: !activeTextStyle.underline }))}>U</button>
                    <button type="button" className={`note-toolbar-btn${activeTextStyle.fontStyle === 'italic' ? ' is-active' : ''}`} {...bindToolbarAction(() => updateActiveStyle({ fontStyle: activeTextStyle.fontStyle === 'italic' ? 'normal' : 'italic' }))}>I</button>
                    <button type="button" className={`note-toolbar-btn${activeTextStyle.strikethrough ? ' is-active' : ''}`} {...bindToolbarAction(() => updateActiveStyle({ strikethrough: !activeTextStyle.strikethrough }))}>S</button>
                  </div>
                  <div className="workspace-text-toolbar-size">
                    <button type="button" className="note-toolbar-btn" {...bindToolbarAction(() => updateActiveStyle({ fontSize: Math.max(10, activeFontSize - 1) }))}>-</button>
                    <span>{activeFontSize}</span>
                    <button type="button" className="note-toolbar-btn" {...bindToolbarAction(() => updateActiveStyle({ fontSize: Math.min(40, activeFontSize + 1) }))}>+</button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
      <div
        className="mobile-canvas-grid"
        onPointerDown={() => {
          onActiveNodeChange(null)
          setToolbarNodeId(null)
        }}
      />
      <svg
        className="mobile-anchor-link-layer workspace-link-layer"
        width={linkLayerBounds.width}
        height={linkLayerBounds.height}
        style={{
          left: linkLayerBounds.left,
          top: linkLayerBounds.top,
          width: linkLayerBounds.width,
          height: linkLayerBounds.height
        }}
        aria-hidden="true"
      >
        <defs>
          {anchorLines.map((line) => (
            <marker
              key={`arrow-${line.id}`}
              id={`mobile-arrowhead-${line.id}`}
              markerWidth="8"
              markerHeight="8"
              refX="4"
              refY="4"
              orient="auto"
            >
              <path d="M 0 0 L 8 4 L 0 8 Z" fill={line.active ? line.color : `${line.color}99`} />
            </marker>
          ))}
          <filter id="mobile-link-glow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="3" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {anchorLines.map((line) => (
          <g key={line.id}>
            <path d={line.path} fill="none" stroke={line.color} strokeWidth={line.active ? 5 : 3} strokeOpacity={line.active ? 0.18 : 0.08} strokeLinecap="round" filter="url(#mobile-link-glow)" />
            <path d={line.path} fill="none" stroke={line.color} strokeWidth={line.active ? 2.5 : 1.8} strokeOpacity={line.active ? 0.92 : 0.48} strokeDasharray={line.active ? 'none' : '6 4'} strokeLinecap="round" markerEnd={`url(#mobile-arrowhead-${line.id})`} className="workspace-link-path-visible" />
            <circle cx={line.x2} cy={line.y2} r={line.active ? 4.5 : 3} fill={line.color} fillOpacity={line.active ? 0.9 : 0.45} />
            <circle cx={line.x1} cy={line.y1} r={line.active ? 5 : 3.4} fill={line.color} fillOpacity={line.active ? 0.92 : 0.55} />
          </g>
        ))}
      </svg>
      <svg className="mobile-workspace-link-layer workspace-node-link-layer" aria-hidden="true">
        {links.map((link) => {
          const from = documentNodes.find((node) => node.id === link.fromNodeId)
          const to = documentNodes.find((node) => node.id === link.toNodeId)
          if (!from || !to) return null
          const x1 = from.x + from.width
          const y1 = from.y + Math.min(from.height / 2, 48)
          const x2 = to.x
          const y2 = to.y + Math.min(to.height / 2, 48)
          const path = buildBezierPath(
            x1 * viewport.workspaceZoom + viewport.panX,
            y1 * viewport.workspaceZoom + viewport.panY,
            x2 * viewport.workspaceZoom + viewport.panX,
            y2 * viewport.workspaceZoom + viewport.panY
          )
          const active = activeNodeId === link.fromNodeId || activeNodeId === link.toNodeId
          return (
            <path key={link.id} d={path} className="workspace-node-link-visible" strokeWidth={active ? 3 : 2} strokeOpacity={active ? 0.9 : 0.6} />
          )
        })}
      </svg>
      <div className="mobile-canvas-surface" style={{ transform: `translate(${viewport.panX}px, ${viewport.panY}px) scale(${viewport.workspaceZoom})` }}>
        {documentNodes.length ? (
          documentNodes.map((node) => {
            const accentColor = nodeAccentColor(node)
            const visualKind = visualNodeKind(node)
            return (
            <article
              key={node.id}
              className={`mobile-canvas-node workspace-node workspace-${visualKind}-node${activeNodeId === node.id ? ' is-active' : ''}`}
              data-node-id={node.id}
              style={{
                left: node.x,
                top: node.y,
                width: node.width,
                minHeight: node.height,
                borderColor: accentColor,
                background: visualKind === 'comment' ? undefined : node.nodeColor
              }}
              onPointerDown={(event) => {
                event.stopPropagation()
                if (linkingFrom) commitLink(node.id)
                onActiveNodeChange(node.id)
                if (visualKind === 'excerpt' || visualKind === 'comment' || visualKind === 'textbox') {
                  setToolbarNodeId(node.id)
                }
              }}
            >
              {node.sourceAnchorId ? (
                <button
                  type="button"
                  className="workspace-node-anchor-arrow"
                  data-node-arrow-id={node.id}
                  title="Jump to source in document"
                  style={{ borderRightColor: accentColor }}
                  onClick={(event) => {
                    event.stopPropagation()
                    if (node.sourceAnchorId) onOpenAnchor(node.sourceAnchorId, node.id)
                  }}
                />
              ) : null}
              <div
                className={`mobile-node-handle workspace-${visualKind}-handle`}
                onPointerDown={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  if (locked) return
                  onActiveNodeChange(node.id)
                  if (visualKind === 'excerpt' || visualKind === 'comment' || visualKind === 'textbox') {
                    setToolbarNodeId(node.id)
                  }
                  setDragging({ kind: 'node', nodeId: node.id, startX: event.clientX, startY: event.clientY, nodeX: node.x, nodeY: node.y })
                }}
              >
                <span style={{ color: accentColor }}>{node.title ?? 'Workspace note'}</span>
                <span style={{ fontSize: 10, opacity: 0.5 }}>drag</span>
              </div>
              <button
                type="button"
                className="workspace-node-link-handle"
                title="Link to another workspace node"
                onPointerDown={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  if (!locked) setLinkingFrom(node.id)
                }}
              />
              {visualKind === 'excerpt' ? (
                <div
                  className="workspace-node-copy"
                  style={styleToCss(node.textStyle)}
                  onPointerDown={(event) => {
                    event.stopPropagation()
                    onActiveNodeChange(node.id)
                    setToolbarNodeId(node.id)
                  }}
                >
                  {node.text}
                </div>
              ) : visualKind === 'comment' ? (
                <div
                  className="workspace-comment-input"
                  contentEditable
                  suppressContentEditableWarning
                  data-node-editor="true"
                  data-placeholder="Write your comment..."
                  style={styleToCss(node.textStyle)}
                  onPointerDown={(event) => {
                    event.stopPropagation()
                    onActiveNodeChange(node.id)
                    setToolbarNodeId(node.id)
                  }}
                  onClick={(event) => {
                    event.stopPropagation()
                    onActiveNodeChange(node.id)
                    setToolbarNodeId(node.id)
                  }}
                  onInput={(event) => updateNode(node.id, { text: event.currentTarget.textContent ?? '' })}
                >
                  {node.text ?? ''}
                </div>
              ) : (
                <textarea
                  className="workspace-node-copy"
                  data-node-editor="true"
                  value={node.text ?? ''}
                  aria-label={node.title ?? 'Workspace note'}
                  style={styleToCss(node.textStyle)}
                  onPointerDown={(event) => event.stopPropagation()}
                  onChange={(event) => updateNode(node.id, { text: event.target.value })}
                />
              )}
              {node.tags?.length ? (
                <div className="workspace-node-tags">
                  {node.tags.map((tag) => (
                    <span key={tag} className="workspace-node-tag">{tag}</span>
                  ))}
                </div>
              ) : null}
              {resizeDirections.map((direction) => (
                <button
                  key={direction}
                  className={`workspace-node-resize-handle workspace-node-resize-${direction}`}
                  type="button"
                  aria-label={`Resize ${direction}`}
                  onPointerDown={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    if (locked) return
                    setDragging({
                      kind: 'resize',
                      nodeId: node.id,
                      direction,
                      startX: event.clientX,
                      startY: event.clientY,
                      nodeX: node.x,
                      nodeY: node.y,
                      width: node.width,
                      height: node.height
                    })
                  }}
                />
              ))}
              <button
                className="mobile-node-resize"
                type="button"
                aria-label="Resize node"
                onPointerDown={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  if (locked) return
                  setDragging({ kind: 'resize', nodeId: node.id, direction: 'bottom-right', startX: event.clientX, startY: event.clientY, nodeX: node.x, nodeY: node.y, width: node.width, height: node.height })
                }}
              />
            </article>
          )})
        ) : (
          <div className="mobile-canvas-empty">Create a workspace node or make an excerpt from selected source text.</div>
        )}
      </div>
    </section>
  )
}

function styleToCss(style?: TextStyle): React.CSSProperties {
  return {
    fontFamily: style?.fontFamily,
    fontSize: style?.fontSize,
    fontWeight: style?.fontWeight,
    fontStyle: style?.fontStyle,
    textDecoration: [style?.underline ? 'underline' : '', style?.strikethrough ? 'line-through' : ''].filter(Boolean).join(' ') || undefined
  }
}
