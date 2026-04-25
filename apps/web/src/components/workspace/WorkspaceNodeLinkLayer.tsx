'use client'

import { useMemo } from 'react'
import type { CanvasNode } from '@workspace/domain'
import type { WorkspaceLinkingState, WorkspaceNodeLink } from '../../lib/workspace/node-links'

interface WorkspaceNodeLinkLayerProps {
  paneWidth: number
  paneHeight: number
  nodes: CanvasNode[]
  links: WorkspaceNodeLink[]
  linkingState: WorkspaceLinkingState | null
  activeNodeId: string | null
  disabled?: boolean
  onOpenLink: (link: WorkspaceNodeLink) => void
}

interface RenderedLink {
  link: WorkspaceNodeLink
  path: string
  active: boolean
}

function buildBezierPath(fromX: number, fromY: number, toX: number, toY: number) {
  const dx = toX - fromX
  const control = Math.max(48, Math.abs(dx) * 0.35)
  const cp1x = fromX + control
  const cp2x = toX - control
  return `M ${fromX} ${fromY} C ${cp1x} ${fromY}, ${cp2x} ${toY}, ${toX} ${toY}`
}

export function WorkspaceNodeLinkLayer({
  paneWidth,
  paneHeight,
  nodes,
  links,
  linkingState,
  activeNodeId,
  disabled = false,
  onOpenLink
}: WorkspaceNodeLinkLayerProps) {
  const nodeIndex = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes])

  const renderedLinks = useMemo<RenderedLink[]>(() => {
    return links.flatMap((link) => {
      const fromNode = nodeIndex.get(link.fromNodeId)
      const toNode = nodeIndex.get(link.toNodeId)
      if (!fromNode || !toNode) {
        return []
      }

      const fromX = fromNode.x + fromNode.width
      const fromY = fromNode.y + Math.min(fromNode.height / 2, 48)
      const toX = toNode.x
      const toY = toNode.y + Math.min(toNode.height / 2, 48)

      return [
        {
          link,
          path: buildBezierPath(fromX, fromY, toX, toY),
          active: activeNodeId === link.fromNodeId || activeNodeId === link.toNodeId
        }
      ]
    })
  }, [activeNodeId, links, nodeIndex])

  const previewPath = useMemo(() => {
    if (!linkingState) {
      return null
    }

    return buildBezierPath(
      linkingState.startX,
      linkingState.startY,
      linkingState.currentX,
      linkingState.currentY
    )
  }, [linkingState])

  if (renderedLinks.length === 0 && !previewPath) {
    return null
  }

  return (
    <svg className="workspace-node-link-layer" width={paneWidth} height={paneHeight}>
      {renderedLinks.map(({ link, path, active }) => (
        <g key={link.id}>
          <path
            d={path}
            fill="none"
            stroke="#4f8cff"
            strokeWidth={active ? 3 : 2}
            strokeOpacity={active ? 0.9 : 0.6}
            vectorEffect="non-scaling-stroke"
            className="workspace-node-link-visible"
          />
          {!disabled ? (
            <path
              d={path}
              fill="none"
              stroke="transparent"
              strokeWidth={14}
              vectorEffect="non-scaling-stroke"
              className="workspace-node-link-hit"
              onPointerDown={(event) => {
                event.stopPropagation()
                onOpenLink(link)
              }}
            />
          ) : null}
        </g>
      ))}
      {previewPath ? (
        <path
          d={previewPath}
          fill="none"
          stroke="#4f8cff"
          strokeWidth={2}
          strokeOpacity={0.5}
          strokeDasharray="6 6"
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
    </svg>
  )
}
