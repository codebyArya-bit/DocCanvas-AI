'use client'

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef
} from 'react'
import type { Note } from '@workspace/domain'
import { undo, redo, history } from 'prosemirror-history'
import { keymap } from 'prosemirror-keymap'
import { Mark, Node as ProseMirrorNode, Schema } from 'prosemirror-model'
import { EditorState, TextSelection, type Command } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { baseKeymap, setBlockType, toggleMark } from 'prosemirror-commands'
import { schema as basicSchema } from 'prosemirror-schema-basic'
import { addListNodes, liftListItem, wrapInList } from 'prosemirror-schema-list'

const noteSchema = new Schema({
  nodes: addListNodes(basicSchema.spec.nodes, 'paragraph block*', 'block'),
  marks: basicSchema.spec.marks.append({
    underline: {
      parseDOM: [{ tag: 'u' }, { style: 'text-decoration', getAttrs: (value) => (String(value).includes('underline') ? null : false) }],
      toDOM: () => ['u', 0]
    },
    strikethrough: {
      parseDOM: [
        { tag: 's' },
        { tag: 'strike' },
        { style: 'text-decoration', getAttrs: (value) => (String(value).includes('line-through') ? null : false) }
      ],
      toDOM: () => ['s', 0]
    },
    textColor: {
      attrs: { color: { default: '#1f1b16' } },
      parseDOM: [
        {
          style: 'color',
          getAttrs: (value) => ({ color: String(value) })
        }
      ],
      toDOM: (mark) => ['span', { style: `color: ${mark.attrs.color}` }, 0]
    },
    textHighlight: {
      attrs: { color: { default: '#fff08a' } },
      parseDOM: [
        {
          style: 'background-color',
          getAttrs: (value) => ({ color: String(value) })
        }
      ],
      toDOM: (mark) => ['span', { style: `background-color: ${mark.attrs.color}` }, 0]
    },
    fontFamily: {
      attrs: { font: { default: '"Segoe UI", system-ui, sans-serif' } },
      parseDOM: [
        {
          style: 'font-family',
          getAttrs: (value) => ({ font: String(value) })
        }
      ],
      toDOM: (mark) => ['span', { style: `font-family: ${mark.attrs.font}` }, 0]
    },
    fontSize: {
      attrs: { size: { default: '16px' } },
      parseDOM: [
        {
          style: 'font-size',
          getAttrs: (value) => ({ size: String(value) })
        }
      ],
      toDOM: (mark) => ['span', { style: `font-size: ${mark.attrs.size}` }, 0]
    }
  })
})

export interface NoteEditorHandle {
  focus: () => void
  hasFocus: () => boolean
  isSelecting: () => boolean
  getSelectionState: () => NoteEditorSelectionState
  getFormattingState: () => NoteEditorFormattingState
  undo: () => void
  redo: () => void
  toggleBold: () => void
  toggleItalic: () => void
  toggleUnderline: () => void
  toggleStrikethrough: () => void
  toggleBulletList: () => void
  toggleOrderedList: () => void
  setHeading: (level: 1 | 2 | 3) => void
  setParagraph: () => void
  setTextColor: (color: string) => void
  setHighlightColor: (color: string) => void
  setFontFamily: (font: string) => void
  setFontSize: (size: string) => void
}

export interface NoteEditorSelectionState {
  hasSelection: boolean
  rect: DOMRect | null
}

export interface NoteEditorFormattingState {
  fontFamily: string | null
  fontSize: string | null
  textColor: string | null
  highlightColor: string | null
}

interface NoteEditorProps {
  note: Note
  onNoteChange: (note: Note) => void
  onSelectionChange?: (state: NoteEditorSelectionState) => void
}

function runCommand(
  view: EditorView | null,
  command: Command
) {
  if (!view) {
    return
  }

  command(view.state, view.dispatch, view)
  view.focus()
}

export function mergeStoredMarks(marks: readonly Mark[] | null | undefined, nextMark: Mark): Mark[] {
  return [...(marks ?? []).filter((mark) => mark.type !== nextMark.type), nextMark]
}

function setMarkWithAttrs(
  markName: string,
  attrs: Record<string, unknown>,
  fallbackRange?: { from: number; to: number } | null
) {
  return (view: EditorView | null) => {
    if (!view) {
      return
    }

    const { state, dispatch } = view
    const markType = state.schema.marks[markName]
    if (!markType) {
      return
    }

    const { from, to, empty } = state.selection

    // If there's no live selection, apply to the last known non-empty selection first.
    if (empty && fallbackRange && fallbackRange.to > fallbackRange.from) {
      const docSize = state.doc.content.size
      const safeFrom = Math.max(0, Math.min(docSize, fallbackRange.from))
      const safeTo = Math.max(0, Math.min(docSize, fallbackRange.to))
      if (safeTo > safeFrom) {
        dispatch(state.tr.addMark(safeFrom, safeTo, markType.create(attrs)))
        view.focus()
        return
      }
    }

    // If there's still no selection, apply to storedMarks so next typed text uses the mark.
    if (empty) {
      const existingMarks = state.storedMarks ?? state.selection.$from.marks()
      dispatch(state.tr.setStoredMarks(mergeStoredMarks(existingMarks, markType.create(attrs))))
      view.focus()
      return
    }

    // Keep the existing mapped selection from the transaction. Creating a new
    // TextSelection from the old doc can throw "Selection ... current document".
    dispatch(state.tr.addMark(from, to, markType.create(attrs)))
    view.focus()
  }
}

function getMarkAttrs(
  state: EditorState,
  markName: 'fontFamily' | 'fontSize' | 'textColor' | 'textHighlight'
) {
  const markType = state.schema.marks[markName]
  if (!markType) {
    return null
  }

  const { selection, storedMarks, doc } = state
  const selectionMarks = storedMarks ?? selection.$from.marks()
  const directMark = selectionMarks.find((mark) => mark.type === markType)
  if (directMark) {
    return directMark.attrs
  }

  if (selection.empty) {
    return null
  }

  let foundAttrs: Record<string, unknown> | null = null
  doc.nodesBetween(selection.from, selection.to, (node) => {
    if (!node.isText) {
      return
    }

    const activeMark = node.marks.find((mark) => mark.type === markType)
    if (!activeMark) {
      return
    }

    foundAttrs = activeMark.attrs
  })

  return foundAttrs
}

function getEditorFormattingState(view: EditorView | null): NoteEditorFormattingState {
  if (!view) {
    return {
      fontFamily: null,
      fontSize: null,
      textColor: null,
      highlightColor: null
    }
  }

  const fontFamilyAttrs = getMarkAttrs(view.state, 'fontFamily')
  const fontSizeAttrs = getMarkAttrs(view.state, 'fontSize')
  const textColorAttrs = getMarkAttrs(view.state, 'textColor')
  const highlightAttrs = getMarkAttrs(view.state, 'textHighlight')

  return {
    fontFamily: typeof fontFamilyAttrs?.font === 'string' ? fontFamilyAttrs.font : null,
    fontSize: typeof fontSizeAttrs?.size === 'string' ? fontSizeAttrs.size : null,
    textColor: typeof textColorAttrs?.color === 'string' ? textColorAttrs.color : null,
    highlightColor: typeof highlightAttrs?.color === 'string' ? highlightAttrs.color : null
  }
}

function toggleList(view: EditorView | null, listTypeName: 'bullet_list' | 'ordered_list') {
  if (!view) {
    return
  }
  const { state, dispatch } = view
  const listType = state.schema.nodes[listTypeName]
  const listItem = state.schema.nodes.list_item
  if (!listType || !listItem) {
    return
  }

  // If we're already in a list, lift out (toggle off). Otherwise wrap in list.
  const $from = state.selection.$from
  const inList = Boolean($from && $from.parent && $from.parent.type === listItem) || Boolean($from.node(-1)?.type === listType)
  const cmd = inList ? liftListItem(listItem) : wrapInList(listType)
  cmd(state, dispatch)
  view.focus()
}

function stopEventPropagation() {
  return (_view: EditorView, event: Event) => {
    event.stopPropagation()
    return false
  }
}

function isSelectionMovementKey(event: KeyboardEvent) {
  return (
    event.key.startsWith('Arrow') ||
    event.key === 'Home' ||
    event.key === 'End' ||
    event.key === 'PageUp' ||
    event.key === 'PageDown' ||
    event.key === 'a' ||
    event.key === 'A'
  )
}

function mergeClientRects(rects: DOMRect[]) {
  const visibleRects = rects.filter((rect) => rect.width > 0 || rect.height > 0)
  if (visibleRects.length === 0) {
    return null
  }

  const top = Math.min(...visibleRects.map((rect) => rect.top))
  const firstLineRects = visibleRects.filter((rect) => Math.abs(rect.top - top) <= 2)
  const anchorRects = firstLineRects.length > 0 ? firstLineRects : [visibleRects[0]]
  const left = Math.min(...anchorRects.map((rect) => rect.left))
  const right = Math.max(...anchorRects.map((rect) => rect.right))
  const bottom = Math.max(...anchorRects.map((rect) => rect.bottom))
  return new DOMRect(left, top, Math.max(1, right - left), Math.max(1, bottom - top))
}

function mergeCoordRects(coords: Array<{ left: number; right: number; top: number; bottom: number }>) {
  if (coords.length === 0) {
    return null
  }

  const top = Math.min(...coords.map((entry) => entry.top))
  const firstLineCoords = coords.filter((entry) => Math.abs(entry.top - top) <= 2)
  const anchorCoords = firstLineCoords.length > 0 ? firstLineCoords : [coords[0]]
  const left = Math.min(...anchorCoords.map((entry) => Math.min(entry.left, entry.right)))
  const right = Math.max(...anchorCoords.map((entry) => Math.max(entry.left, entry.right)))
  const bottom = Math.max(...anchorCoords.map((entry) => entry.bottom))
  return new DOMRect(left, top, Math.max(1, right - left), Math.max(1, bottom - top))
}

function createCaretRect(coord: { left: number; right: number; top: number; bottom: number }) {
  const left = Math.min(coord.left, coord.right)
  const top = coord.top
  const height = Math.max(1, coord.bottom - coord.top)
  return new DOMRect(left, top, 1, height)
}

function isSentenceBoundary(char: string) {
  return char === '.' || char === '!' || char === '?' || char === '\n'
}

function expandSelectionToSentence(view: EditorView) {
  const { state } = view
  const { from, to } = state.selection
  if (from >= to) {
    return null
  }

  const $from = state.doc.resolve(from)
  const $to = state.doc.resolve(to)
  if (!$from.sameParent($to) || !$from.parent.isTextblock) {
    return null
  }

  const parent = $from.parent
  const parentStart = $from.start()
  const text = parent.textBetween(0, parent.content.size, '\n', '\0')
  if (!text) {
    return null
  }

  let start = Math.max(0, from - parentStart)
  let end = Math.max(start, to - parentStart)

  let startBoundary = -1
  for (let index = start - 1; index >= 0; index -= 1) {
    if (isSentenceBoundary(text[index])) {
      startBoundary = index
      break
    }
  }
  start = startBoundary + 1
  while (start < text.length && /\s/.test(text[start])) {
    start += 1
  }

  let endBoundary = text.length
  for (let index = end; index < text.length; index += 1) {
    if (isSentenceBoundary(text[index])) {
      endBoundary = text[index] === '\n' ? index : index + 1
      break
    }
  }
  end = endBoundary
  while (end > start && /\s/.test(text[end - 1])) {
    end -= 1
  }

  if (end <= start) {
    return null
  }

  return {
    from: parentStart + start,
    to: parentStart + end
  }
}

function getEditorSelectionState(view: EditorView | null, editorElement: HTMLDivElement | null): NoteEditorSelectionState {
  if (!view) {
    return { hasSelection: false, rect: null }
  }

  const domSelection = window.getSelection()
  const anchorNode = domSelection?.anchorNode ?? null
  const focusNode = domSelection?.focusNode ?? null
  const withinEditor =
    !!editorElement &&
    ((anchorNode && editorElement.contains(anchorNode)) ||
      (focusNode && editorElement.contains(focusNode)))

  if (domSelection && domSelection.rangeCount > 0 && withinEditor) {
    const range = domSelection.getRangeAt(0)
    if (!range.collapsed && !domSelection.isCollapsed) {
      const mergedRect = mergeClientRects(Array.from(range.getClientRects()))
      if (mergedRect) {
        return { hasSelection: true, rect: mergedRect }
      }

      const rect = range.getBoundingClientRect()
      if (rect.width > 0 || rect.height > 0) {
        return { hasSelection: true, rect }
      }
    }
  }

  const selection = view.state.selection

  try {
    if (selection.empty) {
      if (view.hasFocus() || withinEditor) {
        const caretCoord = view.coordsAtPos(selection.from)
        return {
          hasSelection: false,
          rect: createCaretRect(caretCoord)
        }
      }

      return {
        hasSelection: false,
        rect: null
      }
    }

    const start = view.coordsAtPos(selection.from)
    const end = view.coordsAtPos(selection.to)
    const tail = view.coordsAtPos(Math.max(selection.from, selection.to - 1))
    const mergedRect = mergeCoordRects([start, end, tail])
    if (mergedRect) {
      return {
        hasSelection: true,
        rect: mergedRect
      }
    }
  } catch {
    return { hasSelection: false, rect: null }
  }

  return { hasSelection: false, rect: null }
}

export const NoteEditor = forwardRef<NoteEditorHandle, NoteEditorProps>(function NoteEditor(
  { note, onNoteChange, onSelectionChange },
  ref
) {
  const editorRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const latestNoteRef = useRef(note)
  const latestOnNoteChangeRef = useRef(onNoteChange)
  const latestOnSelectionChangeRef = useRef(onSelectionChange)
  const lastSelectionRef = useRef<{ from: number; to: number } | null>(null)
  const pointerSelectionRef = useRef(false)
  const focusRequestedRef = useRef(false)

  useEffect(() => {
    latestNoteRef.current = note
  }, [note])

  useEffect(() => {
    latestOnNoteChangeRef.current = onNoteChange
  }, [onNoteChange])

  useEffect(() => {
    latestOnSelectionChangeRef.current = onSelectionChange
  }, [onSelectionChange])

  const emitSelectionChange = useCallback((view: EditorView | null) => {
    const notify = latestOnSelectionChangeRef.current
    if (!notify || !view) {
      return
    }
    notify(getEditorSelectionState(view, editorRef.current))
  }, [])

  const scheduleSelectionChange = useCallback((view: EditorView | null) => {
    if (!view) {
      return
    }

    requestAnimationFrame(() => {
      if (viewRef.current !== view) {
        return
      }

      emitSelectionChange(view)

      requestAnimationFrame(() => {
        if (viewRef.current !== view) {
          return
        }
        emitSelectionChange(view)
      })
    })
  }, [emitSelectionChange])

  const finishPointerSelection = useCallback((view: EditorView | null) => {
    pointerSelectionRef.current = false
    emitSelectionChange(view)
    scheduleSelectionChange(view)
  }, [emitSelectionChange, scheduleSelectionChange])

  const focusEditorView = useCallback((view: EditorView | null) => {
    if (!view) {
      focusRequestedRef.current = true
      return
    }

    view.focus()
    focusRequestedRef.current = false
    scheduleSelectionChange(view)
  }, [scheduleSelectionChange])

  useImperativeHandle(ref, () => ({
    focus: () => {
      focusEditorView(viewRef.current)
    },
    hasFocus: () => {
      const view = viewRef.current
      if (!view) {
        return false
      }

      const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null
      return view.hasFocus() || Boolean(activeElement && editorRef.current?.contains(activeElement))
    },
    isSelecting: () => pointerSelectionRef.current,
    getSelectionState: () => getEditorSelectionState(viewRef.current, editorRef.current),
    getFormattingState: () => getEditorFormattingState(viewRef.current),
    undo: () => {
      const view = viewRef.current
      if (view) {
        undo(view.state, view.dispatch)
        view.focus()
      }
    },
    redo: () => {
      const view = viewRef.current
      if (view) {
        redo(view.state, view.dispatch)
        view.focus()
      }
    },
    toggleBold: () => {
      const strong = noteSchema.marks.strong
      if (strong) {
        runCommand(viewRef.current, toggleMark(strong))
      }
    },
    toggleItalic: () => {
      const em = noteSchema.marks.em
      if (em) {
        runCommand(viewRef.current, toggleMark(em))
      }
    },
    toggleUnderline: () => {
      const underline = noteSchema.marks.underline
      if (underline) {
        runCommand(viewRef.current, toggleMark(underline))
      }
    },
    toggleStrikethrough: () => {
      const strikethrough = noteSchema.marks.strikethrough
      if (strikethrough) {
        runCommand(viewRef.current, toggleMark(strikethrough))
      }
    },
    toggleBulletList: () => {
      toggleList(viewRef.current, 'bullet_list')
    },
    toggleOrderedList: () => {
      toggleList(viewRef.current, 'ordered_list')
    },
    setHeading: (level) => {
      const heading = noteSchema.nodes.heading
      if (heading) {
        runCommand(viewRef.current, setBlockType(heading, { level }))
      }
    },
    setParagraph: () => {
      const paragraph = noteSchema.nodes.paragraph
      if (paragraph) {
        runCommand(viewRef.current, setBlockType(paragraph))
      }
    },
    setTextColor: (color) => {
      setMarkWithAttrs('textColor', { color }, lastSelectionRef.current)(viewRef.current)
    },
    setHighlightColor: (color) => {
      setMarkWithAttrs('textHighlight', { color }, lastSelectionRef.current)(viewRef.current)
    },
    setFontFamily: (font) => {
      setMarkWithAttrs('fontFamily', { font }, lastSelectionRef.current)(viewRef.current)
    },
    setFontSize: (size) => {
      setMarkWithAttrs('fontSize', { size }, lastSelectionRef.current)(viewRef.current)
    }
  }), [focusEditorView])

  useEffect(() => {
    if (!editorRef.current) {
      return
    }

    const state = EditorState.create({
      schema: noteSchema,
      doc: (() => {
        try {
          return ProseMirrorNode.fromJSON(noteSchema, latestNoteRef.current.prosemirrorJson)
        } catch {
          return noteSchema.topNodeType.createAndFill() ?? undefined
        }
      })(),
      plugins: [
        history(),
        keymap({
          'Mod-b': () => {
            const strong = noteSchema.marks.strong
            if (!strong) {
              return false
            }
            runCommand(viewRef.current, toggleMark(strong))
            return true
          },
          'Mod-i': () => {
            const em = noteSchema.marks.em
            if (!em) {
              return false
            }
            runCommand(viewRef.current, toggleMark(em))
            return true
          },
          'Mod-u': () => {
            const underline = noteSchema.marks.underline
            if (!underline) {
              return false
            }
            runCommand(viewRef.current, toggleMark(underline))
            return true
          },
          'Mod-Shift-x': () => {
            const strikethrough = noteSchema.marks.strikethrough
            if (!strikethrough) {
              return false
            }
            runCommand(viewRef.current, toggleMark(strikethrough))
            return true
          },
          'Mod-s': () => {
            latestOnNoteChangeRef.current({ ...latestNoteRef.current, updatedAt: new Date().toISOString() })
            return true
          },
          'Mod-z': undo,
          'Mod-y': redo,
          'Mod-Shift-z': redo
        }),
        keymap(baseKeymap)
      ]
    })

    const view = new EditorView(editorRef.current, {
      state,
      handleDOMEvents: {
        pointerdown: (_view, event) => {
          event.stopPropagation()
          if (event.button === 0) {
            pointerSelectionRef.current = true
          }
          return false
        },
        mousedown: (_view, event) => {
          event.stopPropagation()
          if (event.button === 0) {
            pointerSelectionRef.current = true
          }
          return false
        },
        touchstart: (_view, event) => {
          event.stopPropagation()
          pointerSelectionRef.current = true
          return false
        },
        pointermove: () => {
          if (pointerSelectionRef.current) {
            emitSelectionChange(view)
            scheduleSelectionChange(view)
          }
          return false
        },
        keydown: (_view, event) => {
          event.stopPropagation()
          if (event.key === 'Enter' || event.shiftKey || isSelectionMovementKey(event)) {
            requestAnimationFrame(() => {
              if (viewRef.current !== view) {
                return
              }
              scheduleSelectionChange(view)
            })
          }
          return false
        },
        keyup: (_view, event) => {
          event.stopPropagation()
          emitSelectionChange(view)
          scheduleSelectionChange(view)
          return false
        },
        keypress: stopEventPropagation(),
        copy: stopEventPropagation(),
        cut: stopEventPropagation(),
        paste: stopEventPropagation(),
        focus: () => {
          scheduleSelectionChange(view)
          return false
        },
        blur: () => {
          requestAnimationFrame(() => {
            if (viewRef.current !== view) {
              return
            }
            emitSelectionChange(view)
          })
          return false
        },
        mouseup: () => {
          finishPointerSelection(view)
          return false
        },
        pointerup: () => {
          finishPointerSelection(view)
          return false
        },
        touchend: () => {
          finishPointerSelection(view)
          return false
        },
        click: () => {
          pointerSelectionRef.current = false
          emitSelectionChange(view)
          scheduleSelectionChange(view)
          return false
        },
        dblclick: () => {
          requestAnimationFrame(() => {
            if (viewRef.current !== view) {
              return
            }

            const sentenceRange = expandSelectionToSentence(view)
            if (!sentenceRange) {
              emitSelectionChange(view)
              scheduleSelectionChange(view)
              return
            }

            const nextSelection = TextSelection.create(view.state.doc, sentenceRange.from, sentenceRange.to)
            view.dispatch(view.state.tr.setSelection(nextSelection))
            emitSelectionChange(view)
            scheduleSelectionChange(view)
          })
          return false
        }
      },
      dispatchTransaction(transaction) {
        const nextState = view.state.apply(transaction)
        view.updateState(nextState)
        if (!nextState.selection.empty) {
          lastSelectionRef.current = {
            from: nextState.selection.from,
            to: nextState.selection.to
          }
        }
        if (transaction.docChanged) {
          latestOnNoteChangeRef.current({
            ...latestNoteRef.current,
            updatedAt: new Date().toISOString(),
            prosemirrorJson: nextState.doc.toJSON()
          })
        }
        emitSelectionChange(view)
        if (transaction.docChanged || transaction.selectionSet) {
          scheduleSelectionChange(view)
        }
      }
    })

    viewRef.current = view
    if (focusRequestedRef.current) {
      focusEditorView(view)
    } else {
      emitSelectionChange(view)
    }

    const handleSelectionChange = () => {
      const activeView = viewRef.current
      if (!activeView) {
        return
      }

      // Skip during active pointer selection — we handle it in pointerup instead
      if (pointerSelectionRef.current) {
        return
      }

      const domSelection = window.getSelection()
      const editorElement = editorRef.current
      const anchorNode = domSelection?.anchorNode ?? null
      const focusNode = domSelection?.focusNode ?? null
      const withinEditor =
        !!editorElement &&
        ((anchorNode && editorElement.contains(anchorNode)) ||
          (focusNode && editorElement.contains(focusNode)))

      if (activeView.hasFocus() || withinEditor) {
        if (!activeView.state.selection.empty) {
          lastSelectionRef.current = {
            from: activeView.state.selection.from,
            to: activeView.state.selection.to
          }
        }
        emitSelectionChange(activeView)
        scheduleSelectionChange(activeView)
      }
    }

    const handlePointerOrMouseUp = () => {
      if (!pointerSelectionRef.current) {
        return
      }
      
      const activeView = viewRef.current
      pointerSelectionRef.current = false
      if (activeView) {
        scheduleSelectionChange(activeView)
      } else {
        handleSelectionChange()
      }
    }

    document.addEventListener('selectionchange', handleSelectionChange)
    window.addEventListener('pointerup', handlePointerOrMouseUp, true)
    window.addEventListener('mouseup', handlePointerOrMouseUp, true)
    window.addEventListener('touchend', handlePointerOrMouseUp, true)
    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange)
      window.removeEventListener('pointerup', handlePointerOrMouseUp, true)
      window.removeEventListener('mouseup', handlePointerOrMouseUp, true)
      window.removeEventListener('touchend', handlePointerOrMouseUp, true)
      latestOnSelectionChangeRef.current?.({ hasSelection: false, rect: null })
      view.destroy()
      viewRef.current = null
    }
  }, [emitSelectionChange, finishPointerSelection, focusEditorView, note.id, scheduleSelectionChange])

  return <div ref={editorRef} className="note-editor-root" data-node-editor="true" />
})
