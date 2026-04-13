'use client'

import { useMemo } from 'react'
import type { CanvasEdge, CanvasNode } from '@workspace/domain'
import type { AnchorViewportMetric } from '../pdf/AnchorService'

interface LinkLayerProps {
  shellRect: DOMRect | null
  workspaceRect: DOMRect | null
  documentPaneRect: DOMRect | null
  anchorMetrics: Record<string, AnchorViewportMetric>
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  activeAnchorId: string | null
  activeEdgeId: string | null
}

interface LinkLine {
  id: string
  sourceAnchorId: string
  targetNodeId: string
  active: boolean
  color: string
  kind: 'auto' | 'manual'
  controlBias: number
  x1: number
  y1: number
  x2: number
  y2: number
  anchorDotX: number
  anchorDotY: number
}

export function LinkLayer({
  shellRect,
  workspaceRect,
  documentPaneRect,
  anchorMetrics,
  nodes,
  edges,
  activeAnchorId,
  activeEdgeId
}: LinkLayerProps) {
  const lines = useMemo<LinkLine[]>(() => {
    if (!shellRect || !workspaceRect || !documentPaneRect) {
      return []
    }

    const nodeIndex = new Map(nodes.map((node) => [node.id, node]))

    return edges.flatMap((edge) => {
      const anchor = anchorMetrics[edge.sourceAnchorId]
      const node = nodeIndex.get(edge.targetNodeId)
      if (!anchor || !node) {
        return []
      }

      const cardTopVP = workspaceRect.top + node.y
      const cardMidVP = cardTopVP + Math.min(node.height / 2, 48)
      const arrowTipVP = workspaceRect.left + node.x - 20

      if (
        arrowTipVP < workspaceRect.left - 28 ||
        arrowTipVP > workspaceRect.right ||
        cardMidVP < workspaceRect.top ||
        cardMidVP > workspaceRect.bottom
      ) {
        return []
      }
      const anchorRect =
        anchor.rects.reduce<typeof anchor.rects[number] | null>((best, rect) => {
          if (!best) {
            return rect
          }

          const bestMidVP = shellRect.top + best.y + best.height / 2
          const rectMidVP = shellRect.top + rect.y + rect.height / 2
          return Math.abs(rectMidVP - cardMidVP) < Math.abs(bestMidVP - cardMidVP) ? rect : best
        }, null) ?? { x: anchor.x, y: anchor.y, width: anchor.width, height: anchor.height }

      const anchorRightVP = shellRect.left + anchorRect.x + anchorRect.width
      const anchorMidVP = shellRect.top + anchorRect.y + anchorRect.height / 2

      if (
        anchorMidVP < documentPaneRect.top + 16 ||
        anchorMidVP > documentPaneRect.bottom - 16 ||
        anchorRightVP < documentPaneRect.left + 16 ||
        anchorRightVP > documentPaneRect.right - 16
      ) {
        return []
      }

      return [
        {
          id: edge.id,
          sourceAnchorId: edge.sourceAnchorId,
          targetNodeId: edge.targetNodeId,
          active: activeEdgeId === edge.id || activeAnchorId === edge.sourceAnchorId,
          color: edge.color ?? node.selectionColor ?? '#5d5df6',
          kind: edge.kind ?? 'auto',
          controlBias: edge.controlBias ?? 0.42,
          x1: anchorRightVP,
          y1: anchorMidVP,
          x2: arrowTipVP,
          y2: cardMidVP,
          anchorDotX: anchorRightVP,
          anchorDotY: anchorMidVP
        }
      ]
    })
  }, [activeAnchorId, activeEdgeId, anchorMetrics, documentPaneRect, edges, nodes, shellRect, workspaceRect])

  if (!shellRect || lines.length === 0) {
    return null
  }

  return (
    <svg
      className="workspace-link-layer"
      width={typeof window !== 'undefined' ? window.innerWidth : 1920}
      height={typeof window !== 'undefined' ? window.innerHeight : 1080}
      style={{ overflow: 'visible' }}
    >
      <defs>
        {lines.map((line) => (
          <marker
            key={`arrow-${line.id}`}
            id={`arrowhead-${line.id}`}
            markerWidth="8"
            markerHeight="8"
            refX="4"
            refY="4"
            orient="auto"
          >
            <path d="M 0 0 L 8 4 L 0 8 Z" fill={line.active ? line.color : `${line.color}99`} />
          </marker>
        ))}
        <filter id="glow" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="3" result="coloredBlur" />
          <feMerge>
            <feMergeNode in="coloredBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {lines.map((line) => {
        const dx = line.x2 - line.x1
        const cp1x = line.x1 + Math.max(60, Math.abs(dx) * line.controlBias)
        const cp1y = line.y1
        const cp2x = line.x2 - Math.max(60, Math.abs(dx) * line.controlBias)
        const cp2y = line.y2
        const path = `M ${line.x2} ${line.y2} C ${cp2x} ${cp2y}, ${cp1x} ${cp1y}, ${line.x1} ${line.y1}`

        return (
          <g key={line.id}>
            <path
              d={path}
              fill="none"
              stroke={line.color}
              strokeWidth={line.active ? 5 : 3}
              strokeOpacity={line.active ? 0.18 : 0.08}
              strokeLinecap="round"
              filter="url(#glow)"
            />
            <path
              d={path}
              fill="none"
              stroke={line.color}
              strokeWidth={line.active ? 2.5 : 1.8}
              strokeOpacity={line.active ? 0.92 : 0.48}
              strokeDasharray={line.kind === 'manual' ? 'none' : line.active ? 'none' : '6 4'}
              strokeLinecap="round"
              markerEnd={`url(#arrowhead-${line.id})`}
              className="workspace-link-path-visible"
            />
            <circle
              cx={line.x2}
              cy={line.y2}
              r={line.active ? 4.5 : 3}
              fill={line.color}
              fillOpacity={line.active ? 0.9 : 0.45}
            />
            <circle
              cx={line.anchorDotX}
              cy={line.anchorDotY}
              r={line.active ? 5 : 3.4}
              fill={line.color}
              fillOpacity={line.active ? 0.92 : 0.55}
            />
          </g>
        )
      })}
    </svg>
  )
}
