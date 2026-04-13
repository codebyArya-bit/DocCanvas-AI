'use client'

import type { PointerEvent as ReactPointerEvent } from 'react'
import type { CanvasNode } from '@workspace/domain'
import { getTextStyleCss } from './text-style'

interface ExcerptNodeProps {
  node: CanvasNode
  active: boolean
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void
  onOpenAnchor: () => void
  onStartLink: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onStartResize: (event: ReactPointerEvent<HTMLButtonElement>) => void
}

export function ExcerptNode({ node, active, onPointerDown, onOpenAnchor, onStartLink, onStartResize }: ExcerptNodeProps) {
  const accentColor = node.selectionColor ?? '#ffd400'
  const textStyle = getTextStyleCss(node.textStyle)

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
      onPointerDown={onPointerDown}
    >
      {/* Clickable left arrow — jumps to source sentence in the document */}
      <button
        type="button"
        className="workspace-node-anchor-arrow"
        style={{ borderRightColor: accentColor }}
        title="Jump to source in document"
        onClick={(e) => {
          e.stopPropagation()
          onOpenAnchor()
        }}
      />
      <div className="workspace-node-title">{node.title ?? 'Excerpt'}</div>
      <button
        type="button"
        className="workspace-node-link-handle"
        title="Link to another workspace node"
        onPointerDown={(event) => {
          event.stopPropagation()
          onStartLink(event)
        }}
      />
      <div className="workspace-node-copy" style={textStyle}>{node.text}</div>
      {node.tags?.length ? (
        <div className="workspace-node-tags">
          {node.tags.map((tag) => (
            <span key={tag} className="workspace-node-tag">
              {tag}
            </span>
          ))}
        </div>
      ) : null}
      <button
        type="button"
        className="workspace-node-resize-handle"
        title="Resize"
        onPointerDown={(event) => {
          event.stopPropagation()
          onStartResize(event)
        }}
      />
    </div>
  )
}
