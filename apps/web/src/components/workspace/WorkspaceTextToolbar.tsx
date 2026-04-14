'use client'

import { useEffect, useMemo, useState } from 'react'
import type { CanvasNode, TextStyle } from '@workspace/domain'

interface WorkspaceTextToolbarProps {
  node: CanvasNode | null
  left: number
  top: number
  onStyleChange: (style: Partial<TextStyle>) => void
  onColorChange: (color: string) => void
  onCopy: () => void
  onCut: () => void
  onCopyLink: () => void
  onDelete: () => void
  onPromoteChild: () => void
  onComment: () => void
  onEdit: () => void
  onTagsChange: (tags: string[]) => void
}

const SWATCHES = ['#ff9c97', '#fff08a', '#86ebdf', '#8da7f7', '#ea7ae7']

const FONT_OPTIONS = [
  { label: 'System Sans', value: '"Segoe UI", system-ui, sans-serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Courier', value: '"Courier New", monospace' }
]

const PRESET_OPTIONS: Array<{ label: string; value: NonNullable<TextStyle['preset']> }> = [
  { label: 'Body', value: 'body' },
  { label: 'Heading 1', value: 'heading-1' },
  { label: 'Heading 2', value: 'heading-2' },
  { label: 'Quote', value: 'quote' }
]

export function WorkspaceTextToolbar({
  node,
  left,
  top,
  onStyleChange,
  onColorChange,
  onCopy,
  onCut,
  onCopyLink,
  onDelete,
  onPromoteChild,
  onComment,
  onEdit,
  onTagsChange
}: WorkspaceTextToolbarProps) {
  const [toolsOpen, setToolsOpen] = useState(false)
  const [tagsDraft, setTagsDraft] = useState('')
  const style = node?.textStyle ?? {}
  const fontSize = style.fontSize ?? 16

  useEffect(() => {
    setTagsDraft((node?.tags ?? []).join(', '))
  }, [node?.id, node?.tags])

  const parsedTags = useMemo(
    () =>
      tagsDraft
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    [tagsDraft]
  )

  if (!node) {
    return null
  }

  return (
    <div className="workspace-text-toolbar" style={{ left, top }}>
      <div className="workspace-text-toolbar-actions">
        <button type="button" onClick={onComment}>Comment</button>
        <button type="button" onClick={onEdit}>Edit</button>
        <button type="button" onClick={onCopy}>Copy</button>
        <button type="button" onClick={onCut}>Cut</button>
        <button type="button" onClick={onCopyLink}>Copy Link</button>
        <button type="button" onClick={onPromoteChild}>To Child Workspace</button>
        <button type="button" onClick={onDelete}>Delete</button>
        <div className="workspace-text-toolbar-tag-wrap">
          <button
            type="button"
            onClick={() => {
              const nextTags = parsedTags.length ? parsedTags : node.tags?.length ? node.tags : ['tag']
              setTagsDraft(nextTags.join(', '))
              onTagsChange(nextTags)
            }}
          >
            Tags
          </button>
          <input
            value={tagsDraft}
            onChange={(event) => setTagsDraft(event.target.value)}
            onBlur={() => {
              onTagsChange(parsedTags)
            }}
            placeholder={(node.tags ?? []).join(', ') || 'tags'}
          />
        </div>
      </div>

      <div className="workspace-text-toolbar-tools">
        {SWATCHES.map((color) => (
          <button
            key={color}
            type="button"
            className="workspace-text-toolbar-swatch"
            style={{ background: color }}
            onClick={() => onColorChange(color)}
          />
        ))}

        <button
          type="button"
          className="workspace-text-toolbar-swatch workspace-text-toolbar-swatch-gradient"
          onClick={() => onColorChange('#7c5cff')}
        />

        <button
          type="button"
          className={`workspace-text-toolbar-icon${style.strikethrough ? ' is-active' : ''}`}
          onClick={() => onStyleChange({ strikethrough: !style.strikethrough })}
        >
          /
        </button>

        <div className="workspace-text-toolbar-texttool">
          <button
            type="button"
            className={`workspace-text-toolbar-icon${toolsOpen ? ' is-active' : ''}`}
            onClick={() => setToolsOpen((current) => !current)}
          >
            Tt
          </button>
          {toolsOpen ? (
            <div className="workspace-text-toolbar-popover">
              <label>
                <span>Style</span>
                <select
                  value={style.preset ?? 'body'}
                  onChange={(event) => onStyleChange({ preset: event.target.value as TextStyle['preset'] })}
                >
                  {PRESET_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span>Font</span>
                <select
                  value={style.fontFamily ?? FONT_OPTIONS[0].value}
                  onChange={(event) => onStyleChange({ fontFamily: event.target.value })}
                >
                  {FONT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <div className="workspace-text-toolbar-formatting">
                <button
                  type="button"
                  className={style.fontWeight === 'bold' ? 'is-active' : ''}
                  onClick={() => onStyleChange({ fontWeight: style.fontWeight === 'bold' ? 'normal' : 'bold' })}
                >
                  B
                </button>
                <button
                  type="button"
                  className={style.underline ? 'is-active' : ''}
                  onClick={() => onStyleChange({ underline: !style.underline })}
                >
                  U
                </button>
                <button
                  type="button"
                  className={style.fontStyle === 'italic' ? 'is-active' : ''}
                  onClick={() => onStyleChange({ fontStyle: style.fontStyle === 'italic' ? 'normal' : 'italic' })}
                >
                  I
                </button>
                <button
                  type="button"
                  className={style.strikethrough ? 'is-active' : ''}
                  onClick={() => onStyleChange({ strikethrough: !style.strikethrough })}
                >
                  S
                </button>
              </div>

              <div className="workspace-text-toolbar-size">
                <button type="button" onClick={() => onStyleChange({ fontSize: Math.max(10, fontSize - 1) })}>-</button>
                <span>{fontSize}</span>
                <button type="button" onClick={() => onStyleChange({ fontSize: Math.min(40, fontSize + 1) })}>+</button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
