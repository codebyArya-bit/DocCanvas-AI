'use client'

import { type PointerEvent as ReactPointerEvent } from 'react'
import type { CanvasNode } from '@workspace/domain'
import { getTextStyleCss } from './text-style'

export type NodeResizeDirection =
  | 'top'
  | 'bottom'
  | 'left'
  | 'right'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'

interface ExcerptNodeProps {
  node: CanvasNode
  active: boolean
  onHandlePointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void
  onSelect: () => void
  onOpenAnchor: () => void
  onStartLink: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onStartResize: (event: ReactPointerEvent<HTMLButtonElement>, direction: NodeResizeDirection) => void
}

export function ExcerptNode({
  node,
  active,
  onHandlePointerDown,
  onSelect,
  onOpenAnchor,
  onStartLink,
  onStartResize
}: ExcerptNodeProps) {
  const accentColor = node.nodeColor ?? node.selectionColor ?? '#ffd400'
  const textStyle = getTextStyleCss(node.textStyle)
  const resizeDirections: NodeResizeDirection[] = [
    'top',
    'bottom',
    'left',
    'right',
    'top-left',
    'top-right',
    'bottom-left',
    'bottom-right'
  ]

  return (
    <div
      className={`workspace-node workspace-excerpt-node${active ? ' is-active' : ''}`}
      data-node-id={node.id}
      style={{
        left: node.x,
        top: node.y,
        width: node.width,
        minHeight: node.height,
        borderColor: accentColor
      }}
      onPointerDown={() => {
        onSelect()
      }}
      onClick={() => {
        onSelect()
      }}
    >
      {node.sourceAnchorId ? (
        <button
          type="button"
          className="workspace-node-anchor-arrow"
          data-node-arrow-id={node.id}
          style={{ borderRightColor: accentColor }}
          title="Jump to source in document"
          onClick={(e) => {
            e.stopPropagation()
            onOpenAnchor()
          }}
        />
      ) : null}
      <div
        className="workspace-excerpt-handle"
        onPointerDown={(event) => {
          event.stopPropagation()
          onHandlePointerDown(event)
        }}
      >
        <span style={{ color: accentColor }}>{node.title ?? 'Excerpt'}</span>
        <span style={{ fontSize: 10, opacity: 0.5 }}>drag</span>
      </div>
      <button
        type="button"
        className="workspace-node-link-handle"
        title="Link to another workspace node"
        onPointerDown={(event) => {
          event.stopPropagation()
          onStartLink(event)
        }}
      />
      <div
        className="workspace-node-copy"
        style={textStyle}
        onPointerDown={(event) => {
          event.stopPropagation()
          onSelect()
        }}
      >
        {node.text}
      </div>
      {node.tags?.length ? (
        <div className="workspace-node-tags">
          {node.tags.map((tag) => (
            <span key={tag} className="workspace-node-tag">
              {tag}
            </span>
          ))}
        </div>
      ) : null}
      {resizeDirections.map((direction) => (
        <button
          key={direction}
          type="button"
          className={`workspace-node-resize-handle workspace-node-resize-${direction}`}
          title={`Resize ${direction}`}
          onPointerDown={(event) => {
            event.stopPropagation()
            onStartResize(event, direction)
          }}
        />
      ))}
    </div>
  )
}
