'use client'

import { useRef, useState } from 'react'
import type { Excerpt, Note } from '@workspace/domain'
import { NoteEditor, type NoteEditorHandle } from './note-editor'

const FONT_OPTIONS = [
  { label: 'System Sans', value: '"Segoe UI", system-ui, sans-serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Courier', value: '"Courier New", monospace' },
  { label: 'Trebuchet', value: '"Trebuchet MS", sans-serif' }
]

const FONT_SIZES = ['12px', '14px', '16px', '18px', '22px', '28px']

interface NoteNodeProps {
  note: Note
  excerpts: Excerpt[]
  zoom: number
  onNoteChange: (note: Note) => void
}

type ResizeDirection =
  | 'top'
  | 'bottom'
  | 'left'
  | 'right'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'

export function NoteNode({ note, excerpts, zoom, onNoteChange }: NoteNodeProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const editorHandleRef = useRef<NoteEditorHandle | null>(null)
  const dragStateRef = useRef<{ pointerId: number; startX: number; startY: number; noteX: number; noteY: number } | null>(null)
  const resizeStateRef = useRef<{
    pointerId: number
    direction: ResizeDirection
    startX: number
    startY: number
    noteX: number
    noteY: number
    noteWidth: number
    noteHeight: number
  } | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isResizing, setIsResizing] = useState(false)
  const runToolbarAction = (event: React.MouseEvent | React.PointerEvent, action: () => void) => {
    // ProseMirror toolbars should run on mousedown/pointerdown; otherwise the editor selection collapses.
    event.preventDefault()
    event.stopPropagation()
    action()
  }

  return (
    <div
      ref={containerRef}
      className={`note-node${isDragging ? ' is-dragging' : ''}${isResizing ? ' is-resizing' : ''}`}
      style={{
        left: note.x,
        top: note.y,
        width: note.width,
        height: note.height
      }}
      onPointerDown={(event) => {
        event.stopPropagation()
      }}
      onPointerMove={(event) => {
        const drag = dragStateRef.current
        if (drag && drag.pointerId === event.pointerId) {
          onNoteChange({
            ...note,
            x: Math.max(24, drag.noteX + (event.clientX - drag.startX) / zoom),
            y: Math.max(24, drag.noteY + (event.clientY - drag.startY) / zoom),
            updatedAt: new Date().toISOString()
          })
          return
        }

        const resize = resizeStateRef.current
        if (resize && resize.pointerId === event.pointerId) {
          const dx = (event.clientX - resize.startX) / zoom
          const dy = (event.clientY - resize.startY) / zoom
          let nextWidth = resize.noteWidth
          let nextHeight = resize.noteHeight
          let nextX = resize.noteX
          let nextY = resize.noteY

          if (resize.direction.includes('right')) {
            nextWidth = Math.max(280, resize.noteWidth + dx)
          }

          if (resize.direction.includes('left')) {
            const candidateWidth = Math.max(280, resize.noteWidth - dx)
            nextWidth = candidateWidth
            nextX = resize.noteX + (resize.noteWidth - candidateWidth)
          }

          if (resize.direction.includes('bottom')) {
            nextHeight = Math.max(220, resize.noteHeight + dy)
          }

          if (resize.direction.includes('top')) {
            const candidateHeight = Math.max(220, resize.noteHeight - dy)
            nextHeight = candidateHeight
            nextY = resize.noteY + (resize.noteHeight - candidateHeight)
          }

          onNoteChange({
            ...note,
            x: nextX,
            y: nextY,
            width: nextWidth,
            height: nextHeight,
            updatedAt: new Date().toISOString()
          })
        }
      }}
      onPointerUp={(event) => {
        if (dragStateRef.current?.pointerId === event.pointerId) {
          dragStateRef.current = null
          setIsDragging(false)
        }
        if (resizeStateRef.current?.pointerId === event.pointerId) {
          resizeStateRef.current = null
          setIsResizing(false)
          document.body.classList.remove('is-resizing')
        }
      }}
      onPointerCancel={(event) => {
        if (dragStateRef.current?.pointerId === event.pointerId) {
          dragStateRef.current = null
          setIsDragging(false)
        }
        if (resizeStateRef.current?.pointerId === event.pointerId) {
          resizeStateRef.current = null
          setIsResizing(false)
          document.body.classList.remove('is-resizing')
        }
      }}
    >
      <div
        className="note-header"
        onPointerDown={(event) => {
          event.stopPropagation()
          containerRef.current?.setPointerCapture(event.pointerId)
          dragStateRef.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            noteX: note.x,
            noteY: note.y
          }
          setIsDragging(true)
        }}
      >
        <span className="split-title">NotesModule</span>
        <strong>{note.title}</strong>
      </div>
      <div
        className="note-toolbar"
        onPointerDown={(event) => {
          event.stopPropagation()
        }}
      >
        <div className="note-toolbar-group" aria-label="Formatting">
          <button
            type="button"
            className="note-toolbar-btn"
            title="Bold"
            onMouseDown={(event) => runToolbarAction(event, () => editorHandleRef.current?.toggleBold())}
          >
            <strong>B</strong>
          </button>
          <button
            type="button"
            className="note-toolbar-btn"
            title="Italic"
            onMouseDown={(event) => runToolbarAction(event, () => editorHandleRef.current?.toggleItalic())}
          >
            <em>I</em>
          </button>
          <button
            type="button"
            className="note-toolbar-btn"
            title="Underline"
            onMouseDown={(event) => runToolbarAction(event, () => editorHandleRef.current?.toggleUnderline())}
          >
            <span className="note-toolbar-underline">U</span>
          </button>
          <button
            type="button"
            className="note-toolbar-btn"
            title="Strikethrough"
            onMouseDown={(event) => runToolbarAction(event, () => editorHandleRef.current?.toggleStrikethrough())}
          >
            <span className="note-toolbar-strike">S</span>
          </button>
        </div>

        <div className="toolbar-divider" />

        <div className="note-toolbar-group" aria-label="Structure">
          <button
            type="button"
            className="note-toolbar-btn note-toolbar-btn-wide"
            title="Bullet List"
            onMouseDown={(event) => runToolbarAction(event, () => editorHandleRef.current?.toggleBulletList())}
          >
            •
          </button>
          <button
            type="button"
            className="note-toolbar-btn note-toolbar-btn-wide"
            title="Numbered List"
            onMouseDown={(event) => runToolbarAction(event, () => editorHandleRef.current?.toggleOrderedList())}
          >
            1.
          </button>
          <button
            type="button"
            className="note-toolbar-btn note-toolbar-btn-wide"
            title="Paragraph"
            onMouseDown={(event) => runToolbarAction(event, () => editorHandleRef.current?.setParagraph())}
          >
            P
          </button>
          <button
            type="button"
            className="note-toolbar-btn note-toolbar-btn-wide"
            title="Heading 1"
            onMouseDown={(event) => runToolbarAction(event, () => editorHandleRef.current?.setHeading(1))}
          >
            H1
          </button>
          <button
            type="button"
            className="note-toolbar-btn note-toolbar-btn-wide"
            title="Heading 2"
            onMouseDown={(event) => runToolbarAction(event, () => editorHandleRef.current?.setHeading(2))}
          >
            H2
          </button>
        </div>

        <div className="toolbar-divider" />

        <div className="note-toolbar-group note-toolbar-group-nowrap" aria-label="Typography">
          <select
            className="note-toolbar-select"
            defaultValue={FONT_OPTIONS[0].value}
            onChange={(event) => editorHandleRef.current?.setFontFamily(event.target.value)}
          >
            {FONT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <select
            className="note-toolbar-select note-toolbar-select-size"
            defaultValue="16px"
            onChange={(event) => editorHandleRef.current?.setFontSize(event.target.value)}
          >
            {FONT_SIZES.map((size) => (
              <option key={size} value={size}>
                {size.replace('px', '')}
              </option>
            ))}
          </select>
        </div>

        <div className="toolbar-divider" />

        <div className="note-toolbar-group" aria-label="Styling">
          <label className="note-toolbar-color-trigger" title="Text color">
            <span className="note-toolbar-color-label">A</span>
            <input
              type="color"
              defaultValue="#1f1b16"
              onChange={(event) => editorHandleRef.current?.setTextColor(event.target.value)}
            />
          </label>
          <label className="note-toolbar-color-trigger" title="Highlight color">
            <span className="note-toolbar-color-label">Hl</span>
            <input
              type="color"
              defaultValue="#fff08a"
              onChange={(event) => editorHandleRef.current?.setHighlightColor(event.target.value)}
            />
          </label>
        </div>

        <div className="toolbar-divider" />

        <div className="note-toolbar-group" aria-label="Actions">
          <button
            type="button"
            className="note-toolbar-btn note-toolbar-btn-action"
            onMouseDown={(event) => runToolbarAction(event, () => editorHandleRef.current?.undo())}
          >
            Undo
          </button>
          <button
            type="button"
            className="note-toolbar-btn note-toolbar-btn-action"
            onMouseDown={(event) => runToolbarAction(event, () => editorHandleRef.current?.redo())}
          >
            Redo
          </button>
        </div>
      </div>
      <div
        className="note-editor-shell"
        onPointerDown={(event) => {
          event.stopPropagation()
        }}
      >
        <div className="note-sidebar">
          <div className="split-title" style={{ marginBottom: 10 }}>Linked Excerpts</div>
          {excerpts.length === 0 ? (
            <div className="note-sidebar-empty">Create an excerpt to reference it here.</div>
          ) : (
            excerpts.map((excerpt) => (
              <div key={excerpt.id} className="note-sidebar-item">
                {excerpt.extractedText}
              </div>
            ))
          )}
        </div>
        <section className="note-body">
          <NoteEditor ref={editorHandleRef} note={note} onNoteChange={onNoteChange} />
        </section>
      </div>
      {(
        ['top', 'bottom', 'left', 'right', 'top-left', 'top-right', 'bottom-left', 'bottom-right'] as ResizeDirection[]
      ).map((direction) => (
        <button
          key={direction}
          type="button"
          className={`note-resize-handle note-resize-handle-${direction}`}
          aria-label={`Resize note ${direction}`}
          onPointerDown={(event) => {
            event.stopPropagation()
            containerRef.current?.setPointerCapture(event.pointerId)
            resizeStateRef.current = {
              pointerId: event.pointerId,
              direction,
              startX: event.clientX,
              startY: event.clientY,
              noteX: note.x,
              noteY: note.y,
              noteWidth: note.width,
              noteHeight: note.height
            }
            document.body.classList.add('is-resizing')
            setIsResizing(true)
          }}
        />
      ))}
    </div>
  )
}
