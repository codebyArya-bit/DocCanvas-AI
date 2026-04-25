'use client'

import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import type { CanvasNode } from '@workspace/domain'
import { getTextStyleCss } from './text-style'
import type { NodeResizeDirection } from './ExcerptNode'

interface CommentNodeProps {
  node: CanvasNode
  active: boolean
  autoFocusEditor?: boolean
  onSelect: () => void
  onAutoFocusApplied?: () => void
  onHandlePointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void
  onTextChange: (nextValue: string) => void
  onOpenAnchor: () => void
  onStartLink: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onStartResize: (event: ReactPointerEvent<HTMLButtonElement>, direction: NodeResizeDirection) => void
}

export function CommentNode({
  node,
  active,
  autoFocusEditor = false,
  onSelect,
  onAutoFocusApplied,
  onHandlePointerDown,
  onTextChange,
  onOpenAnchor,
  onStartLink,
  onStartResize
}: CommentNodeProps) {
  const accentColor = node.nodeColor ?? node.selectionColor ?? '#5d5df6'
  const textStyle = getTextStyleCss(node.textStyle)
  const editorRef = useRef<HTMLDivElement>(null)
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

  const focusEditor = () => {
    const editor = editorRef.current
    if (!editor) {
      return
    }

    editor.focus()

    const selection = window.getSelection()
    if (!selection) {
      return
    }

    const range = document.createRange()
    range.selectNodeContents(editor)
    range.collapse(false)
    selection.removeAllRanges()
    selection.addRange(range)
  }

  useEffect(() => {
    const editor = editorRef.current
    if (!editor) {
      return
    }

    if (editor.textContent !== (node.text ?? '')) {
      editor.textContent = node.text ?? ''
    }
  }, [node.text])

  useEffect(() => {
    if (!active || !autoFocusEditor) {
      return
    }

    const frame = requestAnimationFrame(() => {
      focusEditor()
      onAutoFocusApplied?.()
    })

    return () => {
      cancelAnimationFrame(frame)
    }
  }, [active, autoFocusEditor, onAutoFocusApplied])

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
      onPointerDown={(event) => {
        event.stopPropagation()
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
        className="workspace-comment-handle"
        onPointerDown={(event) => {
          event.stopPropagation()
          onHandlePointerDown(event)
        }}
      >
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
        data-node-editor="true"
        data-placeholder="Write your comment..."
        onPointerDown={(event) => {
          event.stopPropagation()
          onSelect()
          requestAnimationFrame(() => {
            focusEditor()
          })
        }}
        onClick={(event) => {
          event.stopPropagation()
          onSelect()
          focusEditor()
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
