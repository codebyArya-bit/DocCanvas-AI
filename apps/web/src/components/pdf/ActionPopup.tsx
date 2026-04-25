'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

interface ActionPopupProps {
  left: number
  top: number
  tags: string[]
  selectionColor: string
  bookmarked: boolean
  interactive?: boolean
  onAutoExcerpt: () => void
  onComment: () => void
  onBookmark: () => void
  onTag: (tags: string[]) => void
  onClearTags: () => void
  onCopy: () => void
  onAddDefinedTerm: () => void
  onColorChange: (nextColor: string) => void
  onClearSelection: () => void
  onSizeChange?: (size: { width: number; height: number }) => void
}

const SWATCHES = ['#ff6b6b', '#2ecc71', '#5d5df6', '#ffd400', '#db38ff', '#00b8d9']
const STANDARD_TAGS = ['important', 'question', 'evidence', 'counterpoint', 'defined-term', 'follow-up']

export function ActionPopup({
  left,
  top,
  tags,
  selectionColor,
  bookmarked,
  interactive = true,
  onAutoExcerpt,
  onComment,
  onBookmark,
  onTag,
  onClearTags,
  onCopy,
  onAddDefinedTerm,
  onColorChange,
  onClearSelection,
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
          <button
            className="selection-action-pill"
            type="button"
            onClick={() => {
              const nextTags = parsedTags.length ? parsedTags : ['tag']
              setTagDraft(nextTags.join(', '))
              onTag(nextTags)
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
                      onClearTags()
                      setMoreOpen(false)
                    }}
                  >
                    Clear Tags
                  </button>
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
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  onTag(parsedTags)
                }
              }}
              onBlur={() => onTag(parsedTags)}
              placeholder="market, idea"
            />
          </label>
        </div>

        <div className="selection-action-tag-summary" aria-live="polite">
          <div className="selection-action-tag-summary-label">Allocated tags</div>
          {normalizedTags.length > 0 ? (
            <div className="selection-action-tag-bar" aria-label="Tags allocated to selected text">
              {normalizedTags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  className="selection-action-tag-chip is-active"
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
          ) : (
            <div className="selection-action-tag-empty">No tags allocated</div>
          )}
          <div className="selection-action-tag-presets" aria-label="Suggested tags">
            {STANDARD_TAGS.map((tag) => {
              const active = normalizedTags.includes(tag)
              return (
                <button
                  key={tag}
                  type="button"
                  className={`selection-action-tag-preset${active ? ' is-active' : ''}`}
                  onClick={() => {
                    const next = active ? normalizedTags.filter((item) => item !== tag) : [...normalizedTags, tag]
                    setTagDraft(next.join(', '))
                    onTag(next)
                  }}
                >
                  #{tag}
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
