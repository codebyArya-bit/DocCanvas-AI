'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

interface ActionPopupProps {
  left: number
  top: number
  tags: string[]
  selectionColor: string
  bookmarked: boolean
  excerpted?: boolean
  interactive?: boolean
  onAutoExcerpt: () => void
  onComment: () => void
  onBookmark: () => void
  onRemoveExcerpt?: () => void
  onRemoveHighlight?: () => void
  onTag: (tags: string[]) => void
  onCopy: () => void
  onAddDefinedTerm: () => void
  onColorChange: (nextColor: string) => void
  onClearSelection: () => void
  onUndoAll?: () => void
  onSizeChange?: (size: { width: number; height: number }) => void
}

const SWATCHES = ['#ff6b6b', '#2ecc71', '#5d5df6', '#ffd400', '#db38ff', '#00b8d9']

export function ActionPopup({
  left,
  top,
  tags,
  selectionColor,
  bookmarked,
  excerpted = false,
  interactive = true,
  onAutoExcerpt,
  onComment,
  onBookmark,
  onRemoveExcerpt,
  onRemoveHighlight,
  onTag,
  onCopy,
  onAddDefinedTerm,
  onColorChange,
  onClearSelection,
  onUndoAll,
  onSizeChange
}: ActionPopupProps) {
  const popupRef = useRef<HTMLDivElement | null>(null)
  const [tagDraft, setTagDraft] = useState(tags.join(', '))
  const [moreOpen, setMoreOpen] = useState(false)

  useEffect(() => {
    setTagDraft(tags.join(', '))
  }, [tags])

  useEffect(() => {
    if (!onSizeChange) {
      return
    }

    const element = popupRef.current
    if (!element) {
      return
    }

    const emit = () => {
      const rect = element.getBoundingClientRect()
      onSizeChange({ width: rect.width, height: rect.height })
    }

    emit()

    if (typeof ResizeObserver === 'undefined') {
      return
    }

    const observer = new ResizeObserver(() => emit())
    observer.observe(element)
    return () => observer.disconnect()
  }, [onSizeChange, tags, selectionColor, bookmarked, moreOpen, tagDraft])

  const parsedTags = useMemo(
    () =>
      tagDraft
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    [tagDraft]
  )

  const normalizedTags = useMemo(() => tags.map((t) => t.trim()).filter(Boolean), [tags])

  return (
    <div
      ref={popupRef}
      className="selection-action-popup"
      style={{
        left,
        top,
        borderColor: `${selectionColor}55`,
        boxShadow: `0 22px 45px ${selectionColor}22`,
        pointerEvents: interactive ? 'auto' : 'none'
      }}
    >
      <div className="selection-action-header">
        <div className="selection-action-row">
          <button
            className="selection-action-pill selection-action-pill-primary"
            type="button"
            style={{ background: selectionColor }}
            onClick={onAutoExcerpt}
          >
            Auto Excerpt
          </button>
          <button className="selection-action-pill" type="button" onClick={onComment}>
            Comment
          </button>
          <button className="selection-action-pill" type="button" onClick={onBookmark}>
            {bookmarked ? 'Remove Bookmark' : 'Bookmark'}
          </button>
          {excerpted && onRemoveExcerpt ? (
            <button className="selection-action-pill" type="button" onClick={onRemoveExcerpt}>
              Remove Excerpt
            </button>
          ) : null}
          <button
            className="selection-action-pill"
            type="button"
            onClick={() => {
              onTag(parsedTags)
            }}
          >
            Tag
          </button>
          <button className="selection-action-pill" type="button" onClick={onClearSelection}>
            Clear
          </button>
          <div className="selection-action-more">
            <button
              className="selection-action-pill"
              type="button"
              onClick={() => setMoreOpen((current) => !current)}
            >
              ...
            </button>
            {moreOpen ? (
              <div className="selection-action-menu">
                <div className="selection-action-menu-inner">
                  <button className="selection-action-menu-item" type="button" onClick={onCopy}>
                    Copy
                  </button>
                  <button
                    className="selection-action-menu-item"
                    type="button"
                    onClick={() => {
                      onTag([])
                      setMoreOpen(false)
                    }}
                  >
                    Clear Tags
                  </button>
                {onRemoveHighlight ? (
                  <button
                    className="selection-action-menu-item"
                    type="button"
                    onClick={() => {
                      onRemoveHighlight()
                      setMoreOpen(false)
                    }}
                  >
                    Remove Highlight
                  </button>
                ) : null}
                  {onUndoAll ? (
                    <button
                      className="selection-action-menu-item"
                      type="button"
                      onClick={() => {
                        onUndoAll()
                        setMoreOpen(false)
                      }}
                    >
                      Undo All
                    </button>
                  ) : null}
                  <button className="selection-action-menu-item" type="button" onClick={onAddDefinedTerm}>
                    Add Defined Term
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="selection-action-content">
        <div className="selection-action-row selection-action-row-secondary">
          <div className="selection-action-swatches">
            {SWATCHES.map((swatch) => (
              <button
                key={swatch}
                type="button"
                className="selection-action-swatch"
                style={{
                  background: swatch,
                  boxShadow: selectionColor === swatch ? '0 0 0 3px rgba(53, 94, 153, 0.22)' : 'none'
                }}
                onClick={() => onColorChange(swatch)}
              />
            ))}
          </div>

          <label className="selection-action-tags">
            <span>Tags</span>
            <input
              value={tagDraft}
              onChange={(event) => setTagDraft(event.target.value)}
              onBlur={() => onTag(parsedTags)}
              placeholder="market, idea"
            />
          </label>
        </div>

        {normalizedTags.length > 0 ? (
          <div className="selection-action-row selection-action-row-secondary" style={{ paddingTop: 0 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {normalizedTags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  className="selection-action-pill"
                  onClick={() => {
                    const next = normalizedTags.filter((t) => t !== tag)
                    setTagDraft(next.join(', '))
                    onTag(next)
                  }}
                >
                  {tag} ×
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
