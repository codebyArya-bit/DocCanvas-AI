'use client'

import { useEffect, useMemo, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react'
import type { CanvasNode, Excerpt, PageAnchor } from '@workspace/domain'
import type { WorkspaceLinkingState, WorkspaceNodeLink } from '../../lib/workspace/node-links'
import { CommentNode } from './CommentNode'
import { ExcerptNode } from './ExcerptNode'
import { WorkspaceNodeLinkLayer } from './WorkspaceNodeLinkLayer'

interface WorkspaceCanvasProps {
  paneRef: RefObject<HTMLElement | null>
  canvasNodes: CanvasNode[]
  activeNodeId: string | null
  workspaceLinks: WorkspaceNodeLink[]
  onCanvasNodesChange: Dispatch<SetStateAction<CanvasNode[]>>
  onCreateWorkspaceLink: (fromNodeId: string, toNodeId: string) => void
  onOpenWorkspaceLink: (link: WorkspaceNodeLink) => void
  onDropSelection: (payload: {
    excerpt: Excerpt
    anchor: PageAnchor
    x: number
    y: number
  }) => void
  onOpenAnchor: (anchorId: string, preferredNodeId?: string | null) => void
  onFocusNode: (nodeId: string) => void
  onClearSelection: () => void
}

export function WorkspaceCanvas({
  paneRef,
  canvasNodes,
  activeNodeId,
  workspaceLinks,
  onCanvasNodesChange,
  onCreateWorkspaceLink,
  onOpenWorkspaceLink,
  onDropSelection,
  onOpenAnchor,
  onFocusNode,
  onClearSelection
}: WorkspaceCanvasProps) {
  const COMMENT_SNAP_THRESHOLD = 48
  const dragRef = useRef<{
    nodeId: string
    offsetX: number
    offsetY: number
  } | null>(null)
  const resizeRef = useRef<{
    nodeId: string
    startX: number
    startY: number
    startWidth: number
    startHeight: number
  } | null>(null)
  const linkingRef = useRef<WorkspaceLinkingState | null>(null)
  const [linkingState, setLinkingState] = useState<WorkspaceLinkingState | null>(null)

  const nodeIndex = useMemo(() => new Map(canvasNodes.map((node) => [node.id, node])), [canvasNodes])
  const orderedNodes = useMemo(() => {
    if (!activeNodeId) {
      return canvasNodes
    }

    const inactiveNodes = canvasNodes.filter((node) => node.id !== activeNodeId)
    const activeNode = canvasNodes.find((node) => node.id === activeNodeId)
    return activeNode ? [...inactiveNodes, activeNode] : canvasNodes
  }, [activeNodeId, canvasNodes])

  useEffect(() => {
    function handlePointerMove(event: PointerEvent) {
      const drag = dragRef.current
      const pane = paneRef.current
      if (!pane) {
        return
      }

      const paneRect = pane.getBoundingClientRect()
      const linking = linkingRef.current
      if (linking) {
        const nextLinking = {
          ...linking,
          currentX: event.clientX - paneRect.left,
          currentY: event.clientY - paneRect.top
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

        const minWidth = node.kind === 'comment' ? 240 : 220
        const minHeight = node.kind === 'comment' ? 120 : 110
        const nextWidth = Math.min(
          paneRect.width - node.x - 24,
          Math.max(minWidth, resize.startWidth + (event.clientX - resize.startX))
        )
        const nextHeight = Math.min(
          paneRect.height - node.y - 24,
          Math.max(minHeight, resize.startHeight + (event.clientY - resize.startY))
        )

        onCanvasNodesChange((current) =>
          current.map((entry) =>
            entry.id === resize.nodeId
              ? {
                  ...entry,
                  width: nextWidth,
                  height: nextHeight,
                  updatedAt: new Date().toISOString()
                }
              : entry
          )
        )
        return
      }

      if (!drag) {
        return
      }

      const node = nodeIndex.get(drag.nodeId)
      if (!node) {
        return
      }

      const nextX = Math.min(
        paneRect.width - node.width - 24,
        Math.max(24, event.clientX - paneRect.left - drag.offsetX)
      )
      const nextY = Math.min(
        paneRect.height - node.height - 24,
        Math.max(24, event.clientY - paneRect.top - drag.offsetY)
      )

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
          entry.id === drag.nodeId
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
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [nodeIndex, onCanvasNodesChange, onCreateWorkspaceLink, paneRef])

  const paneRect = paneRef.current?.getBoundingClientRect()
  const paneSize = useMemo(
    () => ({
      width: paneRect?.width ?? 0,
      height: paneRect?.height ?? 0
    }),
    [paneRect?.height, paneRect?.width]
  )

  return (
    <div
      className="workspace-canvas-shell"
      onPointerDown={(event) => {
        const target = event.target as HTMLElement | null
        if (!target?.closest('.workspace-node')) {
          onClearSelection()
        }
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
        const x = paneRect ? event.clientX - paneRect.left : 120
        const y = paneRect ? event.clientY - paneRect.top : 120
        onDropSelection({ ...payload, x, y })
      }}
    >
      <div className="split-title workspace-canvas-title">Workspace</div>
      <WorkspaceNodeLinkLayer
        paneWidth={paneSize.width}
        paneHeight={paneSize.height}
        nodes={canvasNodes}
        links={workspaceLinks}
        linkingState={linkingState}
        activeNodeId={activeNodeId}
        onOpenLink={onOpenWorkspaceLink}
      />
      {orderedNodes.map((node) =>
        node.kind === 'comment' ? (
          <CommentNode
            key={node.id}
            node={node}
            active={activeNodeId === node.id}
            onSelect={() => {
              onFocusNode(node.id)
              if (node.sourceAnchorId) {
                onOpenAnchor(node.sourceAnchorId, node.id)
              }
            }}
            onHandlePointerDown={(event) => {
              event.preventDefault()
              onFocusNode(node.id)
              if (node.sourceAnchorId) {
                onOpenAnchor(node.sourceAnchorId, node.id)
              }
              dragRef.current = {
                nodeId: node.id,
                offsetX: event.clientX - (paneRef.current?.getBoundingClientRect().left ?? 0) - node.x,
                offsetY: event.clientY - (paneRef.current?.getBoundingClientRect().top ?? 0) - node.y
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
              onFocusNode(node.id)
              if (node.sourceAnchorId) {
                onOpenAnchor(node.sourceAnchorId, node.id)
              }
            }}
            onStartLink={(event) => {
              const paneRect = paneRef.current?.getBoundingClientRect()
              const startX = node.x + node.width
              const startY = node.y + Math.min(node.height / 2, 48)
              const currentX = paneRect ? event.clientX - paneRect.left : startX
              const currentY = paneRect ? event.clientY - paneRect.top : startY
              const nextState = { fromNodeId: node.id, startX, startY, currentX, currentY }
              linkingRef.current = nextState
              setLinkingState(nextState)
              onFocusNode(node.id)
            }}
            onStartResize={(event) => {
              resizeRef.current = {
                nodeId: node.id,
                startX: event.clientX,
                startY: event.clientY,
                startWidth: node.width,
                startHeight: node.height
              }
              onFocusNode(node.id)
            }}
          />
        ) : (
          <ExcerptNode
            key={node.id}
            node={node}
            active={activeNodeId === node.id}
            onPointerDown={(event) => {
              event.preventDefault()
              onFocusNode(node.id)
              if (node.sourceAnchorId) {
                onOpenAnchor(node.sourceAnchorId, node.id)
              }
              dragRef.current = {
                nodeId: node.id,
                offsetX: event.clientX - (paneRef.current?.getBoundingClientRect().left ?? 0) - node.x,
                offsetY: event.clientY - (paneRef.current?.getBoundingClientRect().top ?? 0) - node.y
              }
            }}
            onOpenAnchor={() => {
              onFocusNode(node.id)
              if (node.sourceAnchorId) {
                onOpenAnchor(node.sourceAnchorId, node.id)
              }
            }}
            onStartLink={(event) => {
              const paneRect = paneRef.current?.getBoundingClientRect()
              const startX = node.x + node.width
              const startY = node.y + Math.min(node.height / 2, 48)
              const currentX = paneRect ? event.clientX - paneRect.left : startX
              const currentY = paneRect ? event.clientY - paneRect.top : startY
              const nextState = { fromNodeId: node.id, startX, startY, currentX, currentY }
              linkingRef.current = nextState
              setLinkingState(nextState)
              onFocusNode(node.id)
            }}
            onStartResize={(event) => {
              resizeRef.current = {
                nodeId: node.id,
                startX: event.clientX,
                startY: event.clientY,
                startWidth: node.width,
                startHeight: node.height
              }
              onFocusNode(node.id)
            }}
          />
        )
      )}
    </div>
  )
}
