'use client'

import { useEffect, useRef } from 'react'
import type { Excerpt, Note } from '@workspace/domain'
import { history } from 'prosemirror-history'
import { keymap } from 'prosemirror-keymap'
import { Schema } from 'prosemirror-model'
import { EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: {
      group: 'block',
      content: 'text*',
      toDOM: () => ['p', 0],
      parseDOM: [{ tag: 'p' }]
    },
    text: { group: 'inline' }
  }
})

interface NoteEditorProps {
  note: Note
  excerpts: Excerpt[]
  onNoteChange: (note: Note) => void
}

export function NoteEditor({ note, excerpts, onNoteChange }: NoteEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)

  useEffect(() => {
    if (!editorRef.current) {
      return
    }

    const state = EditorState.create({
      schema,
      plugins: [
        history(),
        keymap({
          'Mod-s': () => {
            onNoteChange({ ...note, updatedAt: new Date().toISOString() })
            return true
          }
        })
      ]
    })

    const view = new EditorView(editorRef.current, {
      state,
      dispatchTransaction(transaction) {
        const nextState = view.state.apply(transaction)
        view.updateState(nextState)
        onNoteChange({
          ...note,
          updatedAt: new Date().toISOString(),
          prosemirrorJson: nextState.doc.toJSON()
        })
      }
    })

    viewRef.current = view
    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [note.id])

  return (
    <div className="note-editor-root">
      <aside className="note-sidebar">
        <div className="split-title" style={{ marginBottom: 10 }}>NotesModule • ProseMirror</div>
        <h3 style={{ marginTop: 0 }}>{note.title}</h3>
        <div style={{ color: 'var(--muted)', fontSize: 14, lineHeight: 1.5 }}>
          Link notes to excerpts and documents by persisting `excerptIds` and `documentIds` alongside ProseMirror JSON.
        </div>
        <div style={{ marginTop: 18 }}>
          <strong>Available excerpts</strong>
          {excerpts.map((excerpt) => (
            <div key={excerpt.id} style={{ marginTop: 10, fontSize: 13 }}>
              {excerpt.extractedText}
            </div>
          ))}
        </div>
      </aside>
      <section className="note-body">
        <div ref={editorRef} />
      </section>
    </div>
  )
}
