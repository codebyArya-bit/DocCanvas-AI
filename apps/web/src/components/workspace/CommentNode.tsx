'use client'

import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import type { CanvasNode } from '@workspace/domain'
import { getTextStyleCss } from './text-style'

interface CommentNodeProps {
  node: CanvasNode
  active: boolean
  onSelect: () => void
  onHandlePointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void
  onTextChange: (nextValue: string) => void
  onOpenAnchor: () => void
  onStartLink: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onStartResize: (event: ReactPointerEvent<HTMLButtonElement>) => void
}

export function CommentNode({
  node,
  active,
  onSelect,
  onHandlePointerDown,
  onTextChange,
  onOpenAnchor,
  onStartLink,
  onStartResize
}: CommentNodeProps) {
  const accentColor = node.selectionColor ?? '#5d5df6'
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
      className={`workspace-node workspace-comment-node${active ? ' is-active' : ''}`}
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

      <div className="workspace-comment-handle" onPointerDown={onHandlePointerDown}>
        <span style={{ color: accentColor }}>{node.title ?? 'Comment'}</span>
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
        ref={editorRef}
        className="workspace-comment-input"
        contentEditable
        suppressContentEditableWarning
        style={textStyle}
        data-placeholder="Write your comment..."
        onPointerDown={(event) => {
          event.stopPropagation()
          onSelect()
        }}
        onFocus={onSelect}
        onInput={(event) => {
          onTextChange(event.currentTarget.textContent ?? '')
        }}
      />

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
