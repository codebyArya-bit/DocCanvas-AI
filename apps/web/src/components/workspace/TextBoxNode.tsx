'use client'

import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { CanvasNode, Note } from '@workspace/domain'
import { NoteEditor, type NoteEditorHandle, type NoteEditorSelectionState } from '../notes/note-editor'
import type { NodeResizeDirection } from './ExcerptNode'

const EMPTY_DOC = {
  type: 'doc',
  content: [{ type: 'paragraph' }]
} as const

interface TextBoxNodeProps {
  node: CanvasNode
  active: boolean
  isEditing: boolean
  onSelect: () => void
  onEnterEdit: () => void
  onExitEdit: () => void
  onDelete: () => void
  onHandlePointerDown: (event: React.PointerEvent<HTMLDivElement>) => void
  onChange: (patch: Partial<CanvasNode>) => void
  onStartResize: (event: React.PointerEvent<HTMLButtonElement>, direction: NodeResizeDirection) => void
  onEditorHandleChange: (handle: NoteEditorHandle | null) => void
  onSelectionChange: (state: NoteEditorSelectionState) => void
}

export function TextBoxNode({
  node,
  active,
  isEditing,
  onSelect,
  onEnterEdit,
  onExitEdit,
  onDelete,
  onHandlePointerDown,
  onChange,
  onStartResize,
  onEditorHandleChange,
  onSelectionChange
}: TextBoxNodeProps) {
  const accentColor = node.nodeColor ?? node.selectionColor ?? '#5d5df6'
  const rootRef = useRef<HTMLDivElement | null>(null)
  const editorHandleRef = useRef<NoteEditorHandle | null>(null)
  const onEditorHandleChangeRef = useRef(onEditorHandleChange)

  useEffect(() => {
    onEditorHandleChangeRef.current = onEditorHandleChange
  }, [onEditorHandleChange])

  const shouldRecoverEditorSession = useCallback(() => {
    if (!isEditing) {
      return true
    }

    return !editorHandleRef.current?.hasFocus()
  }, [isEditing])

  const runToolbarAction = (event: React.MouseEvent | React.PointerEvent, action: () => void) => {
    event.preventDefault()
    event.stopPropagation()
    action()
  }

  const syncTextboxFocusState = useCallback(() => {
    onSelect()
    if (shouldRecoverEditorSession()) {
      onEnterEdit()
    }
  }, [onEnterEdit, onSelect, shouldRecoverEditorSession])

  const noteLike = useMemo<Note>(() => {
    const now = node.updatedAt || new Date().toISOString()
    return {
      id: node.id,
      workspaceId: node.workspaceId,
      title: node.title ?? 'Text',
      excerptIds: [],
      documentIds: [],
      prosemirrorJson: node.prosemirrorJson ?? EMPTY_DOC,
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
      createdAt: node.createdAt || now,
      updatedAt: now
    }
  }, [node])

  const handleEditorRef = useCallback((handle: NoteEditorHandle | null) => {
    if (editorHandleRef.current === handle) {
      return
    }

    editorHandleRef.current = handle
    onEditorHandleChangeRef.current(handle)
  }, [])

  useEffect(() => {
    if (!isEditing) {
      return
    }

    editorHandleRef.current?.focus()
  }, [isEditing])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!active) {
        return
      }

      if (event.key === 'Escape' && isEditing) {
        event.preventDefault()
        onExitEdit()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [active, isEditing, onExitEdit])

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
      ref={rootRef}
      className={`workspace-node workspace-textbox-node${active ? ' is-active' : ''}${isEditing ? ' is-editing' : ''}`}
      data-node-id={node.id}
      data-is-editing={isEditing ? 'true' : undefined}
      style={{
        left: node.x,
        top: node.y,
        width: node.width,
        minHeight: node.height,
        borderColor: accentColor
      }}
      onPointerDown={(event) => {
        // Let the editor area handle its own pointer events
        const target = event.target as HTMLElement | null
        if (target?.closest('.workspace-textbox-editor, .workspace-textbox-toolbar')) {
          return
        }
        onSelect()
      }}
      onDoubleClick={(event) => {
        event.stopPropagation()
        onEnterEdit()
      }}
    >
      {/* ── Drag handle: fires even while editing so parent can exit edit mode and start drag ── */}
      <div
        className="workspace-textbox-handle"
        onPointerDown={(event) => {
          // Do NOT call event.stopPropagation() here when editing so the
          // parent canvas pointerdown listener can also react, but we still
          // call onHandlePointerDown which handles the drag setup + exit-edit.
          event.preventDefault()
          onHandlePointerDown(event)
        }}
      >
        <span style={{ color: accentColor }}>{node.title ?? 'Text box'}</span>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 10, opacity: 0.5 }}>drag</span>
          <button
            type="button"
            className="note-toolbar-btn note-toolbar-btn-action"
            title="Delete text box"
            onPointerDown={(event) => {
              event.stopPropagation()
              runToolbarAction(event, onDelete)
            }}
            onMouseDown={(event) => {
              event.stopPropagation()
              runToolbarAction(event, onDelete)
            }}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
            }}
          >
            Delete
          </button>
        </div>
      </div>

      {/* ── Editor area: let ProseMirror handle its own pointer/mouse events; only intercept at bubble phase ── */}
      <div
        className="workspace-textbox-editor"
        onPointerDown={(event) => {
          event.stopPropagation()
          syncTextboxFocusState()
        }}
        onClick={(event) => {
          event.stopPropagation()
          syncTextboxFocusState()
        }}
        onDoubleClick={(event) => {
          event.stopPropagation()
          syncTextboxFocusState()
        }}
      >
        <NoteEditor
          ref={handleEditorRef}
          note={noteLike}
          onNoteChange={(next) => {
            onChange({
              prosemirrorJson: next.prosemirrorJson,
              updatedAt: new Date().toISOString()
            })
          }}
          onSelectionChange={onSelectionChange}
        />
      </div>

      {!isEditing
        ? resizeDirections.map((direction) => (
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
          ))
        : null}
    </div>
  )
}
