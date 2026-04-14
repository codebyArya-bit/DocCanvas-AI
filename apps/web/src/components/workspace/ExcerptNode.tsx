'use client'

import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import type { CanvasNode } from '@workspace/domain'
import { getTextStyleCss } from './text-style'

interface ExcerptNodeProps {
  node: CanvasNode
  active: boolean
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void
  onSelect: () => void
  onTextChange: (nextValue: string) => void
  onOpenAnchor: () => void
  onStartLink: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onStartResize: (event: ReactPointerEvent<HTMLButtonElement>) => void
}

export function ExcerptNode({
  node,
  active,
  onPointerDown,
  onSelect,
  onTextChange,
  onOpenAnchor,
  onStartLink,
  onStartResize
}: ExcerptNodeProps) {
  const accentColor = node.selectionColor ?? '#ffd400'
  const textStyle = getTextStyleCss(node.textStyle)
  const editorRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const editor = editorRef.current
    if (!editor) {
      return
    }

    if (editor.textContent !== (node.text ?? '')) {
      editor.textContent = node.text ?? ''
    }
  }, [node.text])

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
      onClick={() => {
        onSelect()
      }}
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
      <div
        ref={editorRef}
        className="workspace-node-copy"
        contentEditable
        suppressContentEditableWarning
        style={textStyle}
        data-node-editor="true"
        onPointerDown={(event) => {
          event.stopPropagation()
          onSelect()
        }}
        onFocus={(event) => {
          event.stopPropagation()
          onSelect()
        }}
        onInput={(event) => {
          onTextChange(event.currentTarget.textContent ?? '')
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
