'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { NoteEditorFormattingState, NoteEditorHandle } from '../notes/note-editor'

const FONT_OPTIONS = [
  { label: 'System Sans', value: '"Segoe UI", system-ui, sans-serif' },
  { label: 'Cairo', value: '"Cairo", "Segoe UI", system-ui, sans-serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Courier', value: '"Courier New", monospace' },
  { label: 'Trebuchet', value: '"Trebuchet MS", sans-serif' }
]

const FONT_SIZES = Array.from({ length: 81 }, (_, index) => `${index + 4}px`)
const TOOLBAR_OFFSET = 12
const DEFAULT_FONT_FAMILY = FONT_OPTIONS[0].value
const DEFAULT_FONT_SIZE = 16
const DEFAULT_TEXT_COLOR = '#1f1b16'
const DEFAULT_HIGHLIGHT_COLOR = '#fff08a'

interface WorkspaceSelectionToolbarProps {
  editor: NoteEditorHandle | null
  nodeId: string
  left: number
  top: number
  onInteractionChange?: (active: boolean) => void
}

export function WorkspaceSelectionToolbar({ editor, nodeId, left, top, onInteractionChange }: WorkspaceSelectionToolbarProps) {
  const [fontFamilyValue, setFontFamilyValue] = useState(DEFAULT_FONT_FAMILY)
  const [fontSizeValue, setFontSizeValue] = useState(DEFAULT_FONT_SIZE)
  const [textColorValue, setTextColorValue] = useState(DEFAULT_TEXT_COLOR)
  const [highlightColorValue, setHighlightColorValue] = useState(DEFAULT_HIGHLIGHT_COLOR)
  const toolbarRef = useRef<HTMLDivElement | null>(null)
  const [toolbarSize, setToolbarSize] = useState({ width: 0, height: 0 })
  const interactionClearTimerRef = useRef<number | null>(null)
  const activeNativeControlRef = useRef<'select' | 'number' | 'color' | null>(null)
  const nativeColorPickerOpenRef = useRef(false)

  useLayoutEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const toolbarElement = toolbarRef.current
    if (!toolbarElement) {
      return
    }

    const updateToolbarSize = () => {
      const rect = toolbarElement.getBoundingClientRect()
      setToolbarSize((current) =>
        current.width === rect.width && current.height === rect.height
          ? current
          : { width: rect.width, height: rect.height }
      )
    }

    updateToolbarSize()
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateToolbarSize)
    resizeObserver?.observe(toolbarElement)
    window.addEventListener('resize', updateToolbarSize)
    return () => {
      resizeObserver?.disconnect()
      window.removeEventListener('resize', updateToolbarSize)
    }
  }, [nodeId, editor])

  const position = useMemo(() => {
    if (typeof window === 'undefined') {
      return { left, top, placement: 'above' as const }
    }

    const padding = 12
    const width = Math.min(toolbarSize.width || 360, window.innerWidth - padding * 2)
    const height = toolbarSize.height || 56
    const clampedLeft = Math.max(padding, Math.min(left - width / 2, window.innerWidth - padding - width))
    const preferredTop = top - height - TOOLBAR_OFFSET
    const placement = preferredTop >= padding ? 'above' : 'below'
    const nextTop =
      placement === 'above'
        ? preferredTop
        : Math.min(window.innerHeight - padding - height, top + TOOLBAR_OFFSET)

    return {
      left: clampedLeft,
      top: Math.max(padding, nextTop),
      placement
    }
  }, [left, toolbarSize.height, toolbarSize.width, top])

  const syncFormattingState = useCallback((formattingState?: NoteEditorFormattingState | null) => {
    const nextFormattingState = formattingState ?? editor?.getFormattingState()
    if (!nextFormattingState) {
      setFontFamilyValue(DEFAULT_FONT_FAMILY)
      setFontSizeValue(DEFAULT_FONT_SIZE)
      setTextColorValue(DEFAULT_TEXT_COLOR)
      setHighlightColorValue(DEFAULT_HIGHLIGHT_COLOR)
      return
    }

    setFontFamilyValue(nextFormattingState.fontFamily ?? DEFAULT_FONT_FAMILY)

    const parsedFontSize = Number.parseInt(nextFormattingState.fontSize?.replace('px', '') ?? '', 10)
    setFontSizeValue(Number.isNaN(parsedFontSize) ? DEFAULT_FONT_SIZE : parsedFontSize)
    setTextColorValue(nextFormattingState.textColor ?? DEFAULT_TEXT_COLOR)
    setHighlightColorValue(nextFormattingState.highlightColor ?? DEFAULT_HIGHLIGHT_COLOR)
  }, [editor])

  useEffect(() => {
    syncFormattingState()
  }, [nodeId, editor, syncFormattingState])

  useLayoutEffect(() => {
    syncFormattingState()
  }, [left, top, syncFormattingState])

  useEffect(() => {
    const handleWindowFocus = () => {
      if (!nativeColorPickerOpenRef.current) {
        return
      }

      requestAnimationFrame(() => {
        nativeColorPickerOpenRef.current = false
        activeNativeControlRef.current = null
        if (toolbarRef.current?.contains(document.activeElement)) {
          setInteracting(true)
          return
        }
        scheduleStopInteracting()
      })
    }

    window.addEventListener('focus', handleWindowFocus, true)
    return () => {
      window.removeEventListener('focus', handleWindowFocus, true)
      if (interactionClearTimerRef.current !== null) {
        window.clearTimeout(interactionClearTimerRef.current)
      }
      activeNativeControlRef.current = null
      nativeColorPickerOpenRef.current = false
      onInteractionChange?.(false)
    }
  }, [onInteractionChange])

  if (!editor) {
    return null
  }

  const runToolbarAction = (event: React.MouseEvent | React.PointerEvent, action: () => void) => {
    event.preventDefault()
    event.stopPropagation()
    editor.focus()
    action()
  }

  const bindAction = (action: () => void) => ({
    onMouseDown: (event: React.MouseEvent<HTMLElement>) => {
      event.preventDefault()
      event.stopPropagation()
      editor.focus()
      action()
    },
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
      event.preventDefault()
      event.stopPropagation()
      editor.focus()
      action()
    }
  })

  const stopToolbarPropagation = (event: React.MouseEvent | React.PointerEvent) => {
    event.stopPropagation()
  }

  const applyFontFamily = (font: string) => {
    setFontFamilyValue(font)
    editor.focus()
    editor.setFontFamily(font)
    syncFormattingState({
      fontFamily: font,
      fontSize: `${fontSizeValue}px`,
      textColor: textColorValue,
      highlightColor: highlightColorValue
    })
  }

  const applyFontSize = (size: number) => {
    const clampedSize = Math.max(4, Math.min(84, size))
    setFontSizeValue(clampedSize)
    editor.focus()
    editor.setFontSize(`${clampedSize}px`)
    syncFormattingState({
      fontFamily: fontFamilyValue,
      fontSize: `${clampedSize}px`,
      textColor: textColorValue,
      highlightColor: highlightColorValue
    })
  }

  const applyTextColor = (color: string) => {
    setTextColorValue(color)
    editor.focus()
    editor.setTextColor(color)
    syncFormattingState({
      fontFamily: fontFamilyValue,
      fontSize: `${fontSizeValue}px`,
      textColor: color,
      highlightColor: highlightColorValue
    })
  }

  const applyHighlightColor = (color: string) => {
    setHighlightColorValue(color)
    editor.focus()
    editor.setHighlightColor(color)
    syncFormattingState({
      fontFamily: fontFamilyValue,
      fontSize: `${fontSizeValue}px`,
      textColor: textColorValue,
      highlightColor: color
    })
  }

  const setInteracting = (active: boolean) => {
    if (interactionClearTimerRef.current !== null) {
      window.clearTimeout(interactionClearTimerRef.current)
      interactionClearTimerRef.current = null
    }
    onInteractionChange?.(active)
  }

  const beginNativeControlInteraction = (control: 'select' | 'number' | 'color') => {
    activeNativeControlRef.current = control
    setInteracting(true)
  }

  const scheduleStopInteracting = () => {
    if (nativeColorPickerOpenRef.current || activeNativeControlRef.current) {
      return
    }
    if (interactionClearTimerRef.current !== null) {
      window.clearTimeout(interactionClearTimerRef.current)
    }
    interactionClearTimerRef.current = window.setTimeout(() => {
      if (nativeColorPickerOpenRef.current) {
        return
      }
      interactionClearTimerRef.current = null
      onInteractionChange?.(false)
    }, 150)
  }

  return (
    <div
      ref={toolbarRef}
      className={`note-toolbar workspace-textbox-toolbar is-visible${position.placement === 'below' ? ' is-below' : ''}`}
      style={{
        left: position.left,
        top: position.top
      }}
      onFocusCapture={() => setInteracting(true)}
      onBlurCapture={(event) => {
        const nextTarget = event.relatedTarget instanceof Node ? event.relatedTarget : null
        if (nativeColorPickerOpenRef.current || activeNativeControlRef.current) {
          return
        }
        if (nextTarget && toolbarRef.current?.contains(nextTarget)) {
          return
        }
        if (!nextTarget && document.activeElement && toolbarRef.current?.contains(document.activeElement)) {
          return
        }
        scheduleStopInteracting()
      }}
      onPointerDownCapture={() => setInteracting(true)}
      onPointerUpCapture={(event) => {
        const target = event.target as HTMLElement | null
        if (target?.closest('input, select, textarea, label.note-toolbar-color-trigger')) {
          return
        }
        scheduleStopInteracting()
      }}
      onPointerCancelCapture={scheduleStopInteracting}
      onMouseDownCapture={() => setInteracting(true)}
      onMouseUpCapture={(event) => {
        const target = event.target as HTMLElement | null
        if (target?.closest('input, select, textarea, label.note-toolbar-color-trigger')) {
          return
        }
        scheduleStopInteracting()
      }}
      onPointerDown={stopToolbarPropagation}
      onMouseDown={(event) => {
        const target = event.target as HTMLElement | null
        if (target?.closest('input, select, textarea')) {
          stopToolbarPropagation(event)
          return
        }

        if (target?.closest('label.note-toolbar-color-trigger')) {
          stopToolbarPropagation(event)
          return
        }

        // Prevent default so editor focus is never lost when clicking toolbar buttons
        event.preventDefault()
        stopToolbarPropagation(event)
      }}
      onPointerUp={stopToolbarPropagation}
      onClick={stopToolbarPropagation}
    >
      <div className="note-toolbar-group" aria-label="Formatting">
        <button
          type="button"
          className="note-toolbar-btn"
          title="Bold"
          {...bindAction(() => editor.toggleBold())}
        >
          <strong>B</strong>
        </button>
        <button
          type="button"
          className="note-toolbar-btn"
          title="Italic"
          {...bindAction(() => editor.toggleItalic())}
        >
          <em>I</em>
        </button>
        <button
          type="button"
          className="note-toolbar-btn"
          title="Underline"
          {...bindAction(() => editor.toggleUnderline())}
        >
          <span className="note-toolbar-underline">U</span>
        </button>
        <button
          type="button"
          className="note-toolbar-btn"
          title="Strikethrough"
          {...bindAction(() => editor.toggleStrikethrough())}
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
          {...bindAction(() => editor.toggleBulletList())}
        >
          •
        </button>
        <button
          type="button"
          className="note-toolbar-btn note-toolbar-btn-wide"
          title="Numbered List"
          {...bindAction(() => editor.toggleOrderedList())}
        >
          1.
        </button>
        <button
          type="button"
          className="note-toolbar-btn note-toolbar-btn-wide"
          title="Paragraph"
          {...bindAction(() => editor.setParagraph())}
        >
          P
        </button>
        <button
          type="button"
          className="note-toolbar-btn note-toolbar-btn-wide"
          title="Heading 1"
          {...bindAction(() => editor.setHeading(1))}
        >
          H1
        </button>
        <button
          type="button"
          className="note-toolbar-btn note-toolbar-btn-wide"
          title="Heading 2"
          {...bindAction(() => editor.setHeading(2))}
        >
          H2
        </button>
      </div>

      <div className="toolbar-divider" />

      <div className="note-toolbar-group note-toolbar-group-nowrap" aria-label="Typography">
        <select
          className="note-toolbar-select"
          value={fontFamilyValue}
          onPointerDown={(event) => {
            beginNativeControlInteraction('select')
            stopToolbarPropagation(event)
          }}
          onMouseDown={(event) => {
            beginNativeControlInteraction('select')
            stopToolbarPropagation(event)
          }}
          onFocus={() => beginNativeControlInteraction('select')}
          onChange={(event) => {
            applyFontFamily(event.target.value)
          }}
        >
          {FONT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <select
          className="note-toolbar-select note-toolbar-select-size"
          value={`${fontSizeValue}px`}
          onPointerDown={(event) => {
            beginNativeControlInteraction('select')
            stopToolbarPropagation(event)
          }}
          onMouseDown={(event) => {
            beginNativeControlInteraction('select')
            stopToolbarPropagation(event)
          }}
          onFocus={() => beginNativeControlInteraction('select')}
          onChange={(event) => {
            const nextSize = Number.parseInt(event.target.value.replace('px', ''), 10)
            if (!Number.isNaN(nextSize)) {
              applyFontSize(nextSize)
            }
          }}
        >
          {FONT_SIZES.map((size) => (
            <option key={size} value={size}>
              {size.replace('px', '')}
            </option>
          ))}
        </select>
        <input
          className="note-toolbar-select note-toolbar-select-size"
          type="number"
          onPointerDown={(event) => {
            beginNativeControlInteraction('number')
            stopToolbarPropagation(event)
          }}
          onMouseDown={(event) => {
            beginNativeControlInteraction('number')
            stopToolbarPropagation(event)
          }}
          onFocus={() => beginNativeControlInteraction('number')}
          min={4}
          max={84}
          value={fontSizeValue}
          onChange={(event) => {
            const parsed = Number.parseInt(event.target.value, 10)
            if (Number.isNaN(parsed)) {
              applyFontSize(4)
              return
            }
            applyFontSize(parsed)
          }}
        />
      </div>

      <div className="toolbar-divider" />

      <div className="note-toolbar-group" aria-label="Styling">
        <label
          className="note-toolbar-color-trigger note-toolbar-btn"
          title="Text Color"
          onPointerDown={(event) => {
            beginNativeControlInteraction('color')
            stopToolbarPropagation(event)
          }}
          onMouseDown={(event) => {
            beginNativeControlInteraction('color')
            stopToolbarPropagation(event)
          }}
          style={{ position: 'relative', display: 'flex', alignItems: 'center' }}
        >
          <span className="note-toolbar-color-label">A</span>
          <div style={{ width: 16, height: 16, backgroundColor: textColorValue || '#000000', border: '1px solid rgba(0,0,0,0.2)', borderRadius: 2 }} />
          <input
            type="color"
            value={textColorValue || '#000000'}
            onPointerDown={(event) => {
              nativeColorPickerOpenRef.current = true
              beginNativeControlInteraction('color')
              stopToolbarPropagation(event)
            }}
            onMouseDown={(event) => {
              nativeColorPickerOpenRef.current = true
              beginNativeControlInteraction('color')
              stopToolbarPropagation(event)
            }}
            onFocus={() => {
              nativeColorPickerOpenRef.current = true
              beginNativeControlInteraction('color')
            }}
            onBlur={() => {
              beginNativeControlInteraction('color')
            }}
            onChange={(event) => {
              nativeColorPickerOpenRef.current = false
              activeNativeControlRef.current = null
              applyTextColor(event.target.value)
              requestAnimationFrame(() => {
                editor.focus()
              })
            }}
            style={{ position: 'absolute', opacity: 0, inset: 0, width: '100%', height: '100%', cursor: 'pointer' }}
          />
        </label>
        <label
          className="note-toolbar-color-trigger note-toolbar-btn"
          title="Highlight Text"
          onPointerDown={(event) => {
            beginNativeControlInteraction('color')
            stopToolbarPropagation(event)
          }}
          onMouseDown={(event) => {
            beginNativeControlInteraction('color')
            stopToolbarPropagation(event)
          }}
          style={{ position: 'relative', display: 'flex', alignItems: 'center' }}
        >
          <span className="note-toolbar-color-label">Hl</span>
          <div style={{ width: 16, height: 16, backgroundColor: highlightColorValue || '#ffffff', border: '1px solid rgba(0,0,0,0.2)', borderRadius: 2 }} />
          <input
            type="color"
            value={highlightColorValue || '#ffffff'}
            onPointerDown={(event) => {
              nativeColorPickerOpenRef.current = true
              beginNativeControlInteraction('color')
              stopToolbarPropagation(event)
            }}
            onMouseDown={(event) => {
              nativeColorPickerOpenRef.current = true
              beginNativeControlInteraction('color')
              stopToolbarPropagation(event)
            }}
            onFocus={() => {
              nativeColorPickerOpenRef.current = true
              beginNativeControlInteraction('color')
            }}
            onBlur={() => {
              beginNativeControlInteraction('color')
            }}
            onChange={(event) => {
              nativeColorPickerOpenRef.current = false
              activeNativeControlRef.current = null
              applyHighlightColor(event.target.value)
              requestAnimationFrame(() => {
                editor.focus()
              })
            }}
            style={{ position: 'absolute', opacity: 0, inset: 0, width: '100%', height: '100%', cursor: 'pointer' }}
          />
        </label>
      </div>

      <div className="toolbar-divider" />

      <div className="note-toolbar-group" aria-label="Actions">
        <button
          type="button"
          className="note-toolbar-btn note-toolbar-btn-action"
          title="Undo"
          {...bindAction(() => editor.undo())}
        >
          Undo
        </button>
        <button
          type="button"
          className="note-toolbar-btn note-toolbar-btn-action"
          title="Redo"
          {...bindAction(() => editor.redo())}
        >
          Redo
        </button>
      </div>
    </div>
  )
}