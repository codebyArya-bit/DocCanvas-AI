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
  workspacePanX: number
  workspacePanY: number
  workspaceZoom: number
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
  workspacePanX,
  workspacePanY,
  workspaceZoom,
  activeAnchorId,
  activeEdgeId
}: LinkLayerProps) {
  const lines = useMemo<LinkLine[]>(() => {
    if (!shellRect || !workspaceRect || !documentPaneRect) {
      return []
    }

    const nodeIndex = new Map(nodes.map((node) => [node.id, node]))
    const nodeArrowIndex = new Map<string, { x: number; y: number }>()

    // Prefer measuring the actual rendered arrow tip element in the DOM.
    // This stays correct through pan/zoom (CSS transforms) and when node styling changes.
    if (typeof document !== 'undefined') {
      const arrowButtons = document.querySelectorAll<HTMLElement>('[data-node-arrow-id]')
      arrowButtons.forEach((button) => {
        const nodeId = button.getAttribute('data-node-arrow-id')
        if (!nodeId) {
          return
        }
        const rect = button.getBoundingClientRect()
        // Use the outward-most point (left edge) so the curve visibly "emanates" from the projection.
        nodeArrowIndex.set(nodeId, { x: rect.left, y: rect.top + rect.height / 2 })
      })
    }

    return edges.flatMap((edge) => {
      const anchor = anchorMetrics[edge.sourceAnchorId]
      const node = nodeIndex.get(edge.targetNodeId)
      if (!anchor || !node) {
        return []
      }

      const measuredArrow = nodeArrowIndex.get(node.id) ?? null
      const nodeArrowTipVP = measuredArrow
        ? measuredArrow.x
        : workspaceRect.left + workspacePanX + node.x * workspaceZoom
      const nodeArrowMidVP = measuredArrow
        ? measuredArrow.y
        : workspaceRect.top + workspacePanY + node.y * workspaceZoom + 40 * workspaceZoom

      if (
        nodeArrowTipVP < workspaceRect.left - 28 ||
        nodeArrowTipVP > workspaceRect.right ||
        nodeArrowMidVP < workspaceRect.top ||
        nodeArrowMidVP > workspaceRect.bottom
      ) {
        return []
      }
      // Anchor endpoint comes from the real rendered page marker DOM (measured in AnchorService.measureAnchorMetric).
      const anchorMarginVP = shellRect.left + anchor.centerX
      const anchorMidVP = shellRect.top + anchor.centerY

      if (
        anchorMidVP < documentPaneRect.top + 16 ||
        anchorMidVP > documentPaneRect.bottom - 16
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
          x1: anchorMarginVP,
          y1: anchorMidVP,
          x2: nodeArrowTipVP,
          y2: nodeArrowMidVP,
          anchorDotX: anchorMarginVP,
          anchorDotY: anchorMidVP
        }
      ]
    })
  }, [
    activeAnchorId,
    activeEdgeId,
    anchorMetrics,
    documentPaneRect,
    edges,
    nodes,
    shellRect,
    workspacePanX,
    workspacePanY,
    workspaceRect,
    workspaceZoom
  ])

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
