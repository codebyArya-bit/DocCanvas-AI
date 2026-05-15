'use client'

import type { ChangeEvent, MouseEvent, PointerEvent } from 'react'
import type { TextStyle } from '@workspace/domain'

type ToolbarTargetKind = 'source' | 'workspace'

interface SharedTextboxToolbarProps {
  visible: boolean
  kind: ToolbarTargetKind
  left: number
  top: number
  style?: TextStyle
  onStyleChange: (style: Partial<TextStyle>) => void
  onDelete?: () => void
  onUndo?: () => void
  onRedo?: () => void
}

const FONT_OPTIONS = [
  { label: 'System Sans', value: '"Segoe UI", system-ui, sans-serif' },
  { label: 'Cairo', value: '"Cairo", "Segoe UI", system-ui, sans-serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Courier', value: '"Courier New", monospace' },
  { label: 'Trebuchet', value: '"Trebuchet MS", sans-serif' },
  { label: 'Arial', value: 'Arial, sans-serif' },
  { label: 'Times', value: '"Times New Roman", serif' }
]

const FONT_SIZES = Array.from({ length: 81 }, (_, index) => index + 4)

export function SharedTextboxToolbar({
  visible,
  kind,
  left,
  top,
  style,
  onStyleChange,
  onDelete,
  onUndo,
  onRedo
}: SharedTextboxToolbarProps) {
  if (!visible) return null

  const fontSize = style?.fontSize ?? 16
  const fontFamily = style?.fontFamily ?? '"Segoe UI", system-ui, sans-serif'
  const textColor = style?.color ?? '#1f1b16'
  const highlightColor = style?.backgroundColor ?? '#fff08a'

  const bindButton = (handler?: () => void) => ({
    onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
      event.preventDefault()
      event.stopPropagation()
    },
    onMouseDown: (event: MouseEvent<HTMLButtonElement>) => {
      event.preventDefault()
      event.stopPropagation()
    },
    onClick: (event: MouseEvent<HTMLButtonElement>) => {
      event.preventDefault()
      event.stopPropagation()
      handler?.()
    }
  })

  const bindInput = () => ({
    onPointerDown: (event: PointerEvent<HTMLElement>) => event.stopPropagation(),
    onMouseDown: (event: MouseEvent<HTMLElement>) => event.stopPropagation(),
    onClick: (event: MouseEvent<HTMLElement>) => event.stopPropagation()
  })

  return (
    <div
      className={`note-toolbar shared-textbox-toolbar ${kind === 'source' ? 'is-source-toolbar' : 'is-workspace-toolbar'} is-visible`}
      style={{ left, top }}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="note-toolbar-group" aria-label="Formatting">
        <button type="button" className={`note-toolbar-btn${style?.fontWeight === 'bold' ? ' is-active' : ''}`} title="Bold" {...bindButton(() => onStyleChange({ fontWeight: style?.fontWeight === 'bold' ? 'normal' : 'bold' }))}><strong>B</strong></button>
        <button type="button" className={`note-toolbar-btn${style?.fontStyle === 'italic' ? ' is-active' : ''}`} title="Italic" {...bindButton(() => onStyleChange({ fontStyle: style?.fontStyle === 'italic' ? 'normal' : 'italic' }))}><em>I</em></button>
        <button type="button" className={`note-toolbar-btn${style?.underline ? ' is-active' : ''}`} title="Underline" {...bindButton(() => onStyleChange({ underline: !style?.underline }))}><span className="note-toolbar-underline">U</span></button>
        <button type="button" className={`note-toolbar-btn${style?.strikethrough ? ' is-active' : ''}`} title="Strikethrough" {...bindButton(() => onStyleChange({ strikethrough: !style?.strikethrough }))}><span className="note-toolbar-strike">S</span></button>
      </div>

      <div className="toolbar-divider" />

      <div className="note-toolbar-group" aria-label="Structure">
        <button type="button" className="note-toolbar-btn note-toolbar-btn-wide" {...bindButton(() => onStyleChange({ preset: 'body', fontSize: 16, fontWeight: 'normal' }))}>P</button>
        <button type="button" className="note-toolbar-btn note-toolbar-btn-wide" {...bindButton(() => onStyleChange({ preset: 'heading-1', fontSize: 28, fontWeight: 'bold' }))}>H1</button>
        <button type="button" className="note-toolbar-btn note-toolbar-btn-wide" {...bindButton(() => onStyleChange({ preset: 'heading-2', fontSize: 22, fontWeight: 'bold' }))}>H2</button>
      </div>

      <div className="toolbar-divider" />

      <div className="note-toolbar-group note-toolbar-group-nowrap" aria-label="Typography">
        <select className="note-toolbar-select" value={fontFamily} onChange={(event: ChangeEvent<HTMLSelectElement>) => onStyleChange({ fontFamily: event.target.value })} {...bindInput()}>
          {FONT_OPTIONS.map((font) => <option key={font.value} value={font.value}>{font.label}</option>)}
        </select>
        <select className="note-toolbar-select note-toolbar-select-size" value={`${fontSize}px`} onChange={(event: ChangeEvent<HTMLSelectElement>) => onStyleChange({ fontSize: Number(event.target.value.replace('px', '')) })} {...bindInput()}>
          {FONT_SIZES.map((size) => <option key={size} value={`${size}px`}>{size}</option>)}
        </select>
        <input className="note-toolbar-select note-toolbar-select-size" min={4} max={84} type="number" value={fontSize} onChange={(event) => onStyleChange({ fontSize: Number(event.target.value) || 16 })} {...bindInput()} />
      </div>

      <div className="toolbar-divider" />

      <div className="note-toolbar-group" aria-label="Styling">
        <label className="note-toolbar-color-trigger note-toolbar-btn" title="Text Color">
          <span className="note-toolbar-color-stack">
            <span className="note-toolbar-color-label">A</span>
            <span className="note-toolbar-color-caption">Text</span>
          </span>
          <span className="note-toolbar-color-preview" style={{ backgroundColor: textColor }} />
          <input type="color" value={textColor} onChange={(event) => onStyleChange({ color: event.target.value })} />
        </label>
        <label className="note-toolbar-color-trigger note-toolbar-btn" title="Highlight Text">
          <span className="note-toolbar-color-stack">
            <span className="note-toolbar-color-label">Hl</span>
            <span className="note-toolbar-color-caption">Fill</span>
          </span>
          <span className="note-toolbar-color-preview" style={{ backgroundColor: highlightColor }} />
          <input type="color" value={highlightColor} onChange={(event) => onStyleChange({ backgroundColor: event.target.value })} />
        </label>
      </div>

      <div className="toolbar-divider" />

      <div className="note-toolbar-group" aria-label="Actions">
        <button type="button" className="note-toolbar-btn note-toolbar-btn-action" title="Undo" {...bindButton(onUndo)}>↶</button>
        <button type="button" className="note-toolbar-btn note-toolbar-btn-action" title="Redo" {...bindButton(onRedo)}>↷</button>
        {onDelete ? <button type="button" className="note-toolbar-btn note-toolbar-btn-danger" title="Delete" {...bindButton(onDelete)}>Delete</button> : null}
      </div>
    </div>
  )
}
