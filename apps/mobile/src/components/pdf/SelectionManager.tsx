'use client'

import { type PointerEvent as ReactPointerEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { SelectionArtifactInput } from '../../lib/excerpts/pdf-selection'
import { buildPageAnchor, capturePdfSelection } from '../../lib/excerpts/pdf-selection'

export interface SelectionPopupState {
  anchorId: string
  selection: SelectionArtifactInput
  left: number
  top: number
  viewportRatio: number
  tags: string[]
  selectionBounds: {
    left: number
    top: number
    width: number
    height: number
  }
  paneBounds: {
    left: number
    top: number
    width: number
    height: number
  }
  sourcePaneWidth: number
  sourcePaneHeight: number
}

interface SelectionManagerProps {
  rootRef: React.RefObject<HTMLDivElement | null>
  workspaceId: string
  documentId: string
  bookmarkedAnchorIds?: string[]
  linkedAnchorIds?: string[]
  popupState?: SelectionPopupState | null
  onPopupStateChange?: (state: SelectionPopupState | null) => void
  onAutoExcerpt: (payload: { selection: SelectionArtifactInput; viewportRatio: number }) => void
  onComment: (payload: { selection: SelectionArtifactInput; viewportRatio: number }) => void
  onBookmark: (selection: SelectionArtifactInput) => void
  onTag: (selection: SelectionArtifactInput, tags: string[]) => void
  onSelectionChange?: (selection: SelectionArtifactInput) => void
  onClearSourceSelection?: (selection: SelectionArtifactInput) => void
  onClearFocus?: () => void
}

export function SelectionManager({
  rootRef,
  workspaceId,
  documentId,
  bookmarkedAnchorIds,
  linkedAnchorIds,
  popupState: controlledPopupState,
  onPopupStateChange,
  onAutoExcerpt,
  onComment,
  onBookmark,
  onTag,
  onSelectionChange,
  onClearSourceSelection,
  onClearFocus
}: SelectionManagerProps) {
  const [uncontrolledPopupState, setUncontrolledPopupState] = useState<SelectionPopupState | null>(null)
  const isSelectingRef = useRef(false)

  const popupState = controlledPopupState ?? uncontrolledPopupState
  const bookmarkedSet = useMemo(() => new Set(bookmarkedAnchorIds ?? []), [bookmarkedAnchorIds])
  void linkedAnchorIds

  const setPopupState = useCallback(
    (nextState: SelectionPopupState | null | ((current: SelectionPopupState | null) => SelectionPopupState | null)) => {
      const resolveNext = (current: SelectionPopupState | null) =>
        typeof nextState === 'function'
          ? (nextState as (current: SelectionPopupState | null) => SelectionPopupState | null)(current)
          : nextState

      if (onPopupStateChange) {
        onPopupStateChange(resolveNext(controlledPopupState ?? uncontrolledPopupState))
        return
      }

      setUncontrolledPopupState(resolveNext)
    },
    [controlledPopupState, onPopupStateChange, uncontrolledPopupState]
  )

  const dismiss = useCallback(() => {
    setPopupState(null)
  }, [setPopupState])

  const clearSelection = useCallback(() => {
    try {
      document.getSelection()?.removeAllRanges()
    } catch {}
    document.body.classList.remove('is-selecting-pdf-text')
    setPopupState(null)
    onClearFocus?.()
  }, [onClearFocus, setPopupState])

  const buildPopupGeometry = useCallback(
    (root: HTMLElement, selection: ReturnType<typeof capturePdfSelection>) => {
      if (!selection) {
        return null
      }

      const page = root.querySelector<HTMLElement>(
        `.mobile-pdf-page-layer[data-page-number="${selection.pageNumber}"], .page[data-page-number="${selection.pageNumber}"]`
      )
      if (!page) {
        return null
      }

      const surface = root.querySelector<HTMLElement>('.mobile-source-interaction-surface') ?? page.offsetParent as HTMLElement | null ?? root
      const rootRect = root.getBoundingClientRect()
      const surfaceRect = surface.getBoundingClientRect()
      const pageRect = page.getBoundingClientRect()
      const appScale = page.offsetWidth > 0 ? pageRect.width / page.offsetWidth : 1
      const quad = selection.anchor.quadPoints
      const firstRect =
        quad && quad.length >= 8
          ? {
              left: pageRect.left + Math.min(quad[0], quad[2], quad[4], quad[6]) * appScale,
              top: pageRect.top + Math.min(quad[1], quad[3], quad[5], quad[7]) * appScale,
              right: pageRect.left + Math.max(quad[0], quad[2], quad[4], quad[6]) * appScale,
              bottom: pageRect.top + Math.max(quad[1], quad[3], quad[5], quad[7]) * appScale
            }
          : {
              left: pageRect.left + selection.anchor.boundingBox.x * appScale,
              top: pageRect.top + selection.anchor.boundingBox.y * appScale,
              right: pageRect.left + (selection.anchor.boundingBox.x + selection.anchor.boundingBox.width) * appScale,
              bottom: pageRect.top + (selection.anchor.boundingBox.y + selection.anchor.boundingBox.height) * appScale
            }

      const width = Math.max(1, firstRect.right - firstRect.left)
      const height = Math.max(1, firstRect.bottom - firstRect.top)
      const popupWidth = Math.min(420, Math.max(260, root.clientWidth - 24))
      const compactPopupHeight = 58
      const paneLeft = rootRect.left - surfaceRect.left
      const paneTop = rootRect.top - surfaceRect.top
      const paneWidth = root.clientWidth
      const paneHeight = root.clientHeight
      const minLeft = paneLeft + 12
      const maxLeft = paneLeft + Math.max(12, paneWidth - popupWidth - 12)
      const targetLeft = firstRect.left - surfaceRect.left + width / 2 - popupWidth / 2
      const paneBottom = paneTop + paneHeight
      const aboveTop = firstRect.top - surfaceRect.top - compactPopupHeight - 10
      const belowTop = firstRect.bottom - surfaceRect.top + 10
      const top =
        aboveTop >= paneTop + 8
          ? aboveTop
          : belowTop + compactPopupHeight <= paneBottom - 8
            ? belowTop
            : Math.max(paneTop + 8, Math.min(paneBottom - compactPopupHeight - 8, belowTop))

      return {
        left: Math.max(minLeft, Math.min(maxLeft, targetLeft)),
        top,
        viewportRatio: root.clientHeight > 0 ? (firstRect.top - rootRect.top + root.scrollTop) / root.clientHeight : 0.25,
        selectionBounds: {
          left: firstRect.left - surfaceRect.left,
          top: firstRect.top - surfaceRect.top,
          width,
          height
        },
        paneBounds: {
          left: paneLeft,
          top: paneTop,
          width: paneWidth,
          height: paneHeight
        },
        sourcePaneWidth: paneWidth,
        sourcePaneHeight: paneHeight
      }
    },
    []
  )

  const commitSelection = useCallback(() => {
    const root = rootRef.current
    if (!root) {
      return
    }

    const nextSelection = capturePdfSelection(root)
    const selection = document.getSelection()
    if (!nextSelection || !selection || selection.rangeCount === 0) {
      return
    }
    if (nextSelection.text.trim().length === 0) {
      return
    }

    const popupGeometry = buildPopupGeometry(root, nextSelection)
    if (!popupGeometry) {
      return
    }

    const anchorId = buildPageAnchor({
      ...nextSelection.anchor,
      workspaceId,
      documentId,
      text: nextSelection.text,
      selectionColor: popupState?.selection.selectionColor ?? '#5d5df6',
      tags: popupState?.tags ?? []
    }).id

    setPopupState({
      anchorId,
      selection: {
        workspaceId,
        documentId,
        text: nextSelection.text,
        pageNumber: nextSelection.pageNumber,
        startSpanIndex: nextSelection.anchor.startSpanIndex,
        startOffset: nextSelection.anchor.startOffset,
        endSpanIndex: nextSelection.anchor.endSpanIndex,
        endOffset: nextSelection.anchor.endOffset,
        boundingBox: nextSelection.anchor.boundingBox,
        quadPoints: nextSelection.anchor.quadPoints,
        viewportScale: nextSelection.anchor.viewportScale,
        selectionColor: popupState?.selection.selectionColor ?? '#5d5df6',
        tags: popupState?.tags ?? []
      },
      left: popupGeometry.left,
      top: popupGeometry.top,
      viewportRatio: popupGeometry.viewportRatio,
      tags: popupState?.tags ?? [],
      selectionBounds: popupGeometry.selectionBounds,
      paneBounds: popupGeometry.paneBounds,
      sourcePaneWidth: popupGeometry.sourcePaneWidth,
      sourcePaneHeight: popupGeometry.sourcePaneHeight
    })
  }, [buildPopupGeometry, documentId, popupState?.selection.selectionColor, popupState?.tags, rootRef, setPopupState, workspaceId])

  useEffect(() => {
    const root = rootRef.current
    if (!root) {
      return
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0) {
        return
      }

      const target = event.target as HTMLElement | null
      const isTextLayerInteraction = Boolean(target?.closest('.textLayer'))
      if (isTextLayerInteraction) {
        dismiss()
        document.body.classList.add('is-selecting-pdf-text')
      }
      isSelectingRef.current = isTextLayerInteraction
    }

    const handlePointerUp = () => {
      if (!isSelectingRef.current) {
        return
      }

      window.setTimeout(() => {
        commitSelection()
        document.body.classList.remove('is-selecting-pdf-text')
      }, 0)
      isSelectingRef.current = false
    }

    const handleDocumentPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('.selection-action-popup')) {
        return
      }

      clearSelection()
    }

    root.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('pointerup', handlePointerUp)
    document.addEventListener('pointerdown', handleDocumentPointerDown)

    return () => {
      root.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('pointerup', handlePointerUp)
      document.removeEventListener('pointerdown', handleDocumentPointerDown)
      document.body.classList.remove('is-selecting-pdf-text')
    }
  }, [clearSelection, commitSelection, dismiss, rootRef])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        clearSelection()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [clearSelection])

  // Mobile-optimized popup component
  return (
    <>
      {popupState ? (
        <PdfSelectionActionPopup
          key={popupState.anchorId}
          popup={popupState}
          bookmarked={bookmarkedSet.has(popupState.anchorId)}
          onAutoExcerpt={() => {
            onAutoExcerpt({ selection: popupState.selection, viewportRatio: popupState.viewportRatio })
            setPopupState(null)
          }}
          onComment={() => {
            onComment({ selection: popupState.selection, viewportRatio: popupState.viewportRatio })
            setPopupState(null)
          }}
          onBookmark={() => {
            onBookmark(popupState.selection)
            setPopupState(null)
            clearSelection()
          }}
          onColor={(color) => {
            const nextSelection = { ...popupState.selection, selectionColor: color }
            setPopupState({ ...popupState, selection: nextSelection })
            onSelectionChange?.(nextSelection)
          }}
          onTags={(tags) => {
            const nextSelection = { ...popupState.selection, tags }
            setPopupState({ ...popupState, selection: nextSelection, tags })
            onTag(nextSelection, tags)
          }}
          onClear={() => {
            onClearSourceSelection?.(popupState.selection)
            clearSelection()
          }}
        />
      ) : null}
    </>
  )
}

function PdfSelectionActionPopup({
  popup,
  bookmarked,
  onAutoExcerpt,
  onComment,
  onBookmark,
  onColor,
  onTags,
  onClear
}: {
  popup: SelectionPopupState
  bookmarked: boolean
  onAutoExcerpt: () => void
  onComment: () => void
  onBookmark: () => void
  onColor: (color: string) => void
  onTags: (tags: string[]) => void
  onClear: () => void
}) {
  const [tagDraft, setTagDraft] = useState(popup.tags.join(', '))
  const [mode, setMode] = useState<'collapsed' | 'expanded'>('collapsed')
  const [moreOpen, setMoreOpen] = useState(false)
  const popupRef = useRef<HTMLDivElement | null>(null)
  const tagsInputRef = useRef<HTMLInputElement | null>(null)
  const [popupSize, setPopupSize] = useState({ width: 320, height: 58 })
  const swatches = ['#ff6b6b', '#2ecc71', '#5d5df6', '#ffd400', '#db38ff', '#00b8d9']
  const presets = ['important', 'question', 'evidence', 'counterpoint', 'defined-term', 'follow-up']
  const tags = tagDraft.split(',').map((tag) => tag.trim().replace(/^#/, '')).filter(Boolean)
  const color = popup.selection.selectionColor ?? '#5d5df6'
  const isDocked = popup.sourcePaneWidth < 460 || popup.sourcePaneHeight < 360
  const popupMode = isDocked ? 'docked' : mode
  const popupPosition = useMemo(
    () => resolvePopupPosition(popup, popupSize, popupMode),
    [popup, popupMode, popupSize]
  )

  useEffect(() => {
    setMode('collapsed')
    setMoreOpen(false)
    setTagDraft(popup.tags.join(', '))
  }, [popup.anchorId, popup.tags])

  useLayoutEffect(() => {
    const element = popupRef.current
    if (!element) return

    const emit = () => {
      const rect = element.getBoundingClientRect()
      setPopupSize((current) =>
        Math.abs(current.width - rect.width) < 0.5 && Math.abs(current.height - rect.height) < 0.5
          ? current
          : { width: rect.width, height: rect.height }
      )
    }

    emit()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(emit)
    observer.observe(element)
    return () => observer.disconnect()
  }, [mode, moreOpen, tagDraft])

  useEffect(() => {
    if (mode !== 'expanded') return
    requestAnimationFrame(() => tagsInputRef.current?.focus())
  }, [mode])

  function commitTags(nextTags = tags) {
    onTags(Array.from(new Set(nextTags)))
  }

  function handleClearPointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault()
    event.stopPropagation()
    onClear()
  }

  return (
    <div
      ref={popupRef}
      className={`selection-action-popup is-mobile-${mode}${isDocked ? ' is-mobile-docked' : ''}`}
      style={{
        left: popupPosition.left,
        top: popupPosition.top,
        borderColor: `${color}55`,
        boxShadow: `0 22px 45px ${color}22`,
        pointerEvents: 'auto',
        position: 'absolute'
      }}
    >
      <div className="selection-action-header">
        <div className="selection-action-row">
          <button className="selection-action-pill selection-action-pill-primary" type="button" style={{ background: color }} onClick={onAutoExcerpt}>
            Auto Excerpt
          </button>
          <button className="selection-action-pill" type="button" onClick={onComment}>Comment</button>
          <button className="selection-action-pill" type="button" onClick={onBookmark}>{bookmarked ? 'Remove Bookmark' : 'Bookmark'}</button>
          <button className="selection-action-pill" type="button" onClick={() => commitTags(tags.length ? tags : ['tag'])}>Tag</button>
          <button className="selection-action-pill" type="button" onPointerDown={handleClearPointerDown}>Clear</button>
          <div className="selection-action-more">
            <button className="selection-action-pill" type="button" onClick={() => setMoreOpen((current) => !current)}>...</button>
            {moreOpen ? (
              <div className="selection-action-menu">
                <div className="selection-action-menu-inner">
                  <button className="selection-action-menu-item" type="button" onClick={() => { void navigator.clipboard?.writeText(popup.selection.text).catch(() => {}) }}>Copy</button>
                  <button className="selection-action-menu-item" type="button" onClick={() => { setTagDraft(''); commitTags([]); setMoreOpen(false) }}>Clear Tags</button>
                  <button className="selection-action-menu-item" type="button" onClick={() => { const next = Array.from(new Set([...tags, 'defined-term'])); setTagDraft(next.join(', ')); commitTags(next); setMoreOpen(false) }}>Add Defined Term</button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
      <div className="selection-action-content">
        <div className="selection-action-row selection-action-row-secondary">
          <div className="selection-action-swatches">
            {swatches.map((swatch) => (
              <button
                key={swatch}
                type="button"
                className="selection-action-swatch"
                style={{ background: swatch, boxShadow: color === swatch ? '0 0 0 3px rgba(53, 94, 153, 0.22)' : 'none' }}
                onClick={() => onColor(swatch)}
              />
            ))}
          </div>
          <label className="selection-action-tags">
            <span>Tags</span>
            <input
              ref={tagsInputRef}
              placeholder="market, idea"
              value={tagDraft}
              onChange={(event) => setTagDraft(event.target.value)}
              onBlur={() => commitTags()}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commitTags()
              }}
            />
          </label>
        </div>
        <div className="selection-action-tag-summary" aria-live="polite">
          <div className="selection-action-tag-summary-label">Allocated tags</div>
          {tags.length ? (
            <div className="selection-action-tag-bar" aria-label="Tags allocated to selected text">
              {tags.map((tag) => (
                <button key={tag} type="button" className="selection-action-tag-chip is-active" onClick={() => {
                  const next = tags.filter((entry) => entry !== tag)
                  setTagDraft(next.join(', '))
                  commitTags(next)
                }}>
                  {tag} ×
                </button>
              ))}
            </div>
          ) : (
            <div className="selection-action-tag-empty">No tags allocated</div>
          )}
          <div className="selection-action-tag-presets" aria-label="Suggested tags">
            {presets.map((tag) => (
              <button key={tag} type="button" className={`selection-action-tag-preset${tags.includes(tag) ? ' is-active' : ''}`} onClick={() => {
                const next = tags.includes(tag) ? tags.filter((entry) => entry !== tag) : Array.from(new Set([...tags, tag]))
                setTagDraft(next.join(', '))
                commitTags(next)
              }}>
                #{tag}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function resolvePopupPosition(
  popup: SelectionPopupState,
  size: { width: number; height: number },
  mode: 'collapsed' | 'expanded' | 'docked'
) {
  const gap = 8
  const margin = 12
  const pane = popup.paneBounds
  const selection = {
    left: popup.selectionBounds.left,
    top: popup.selectionBounds.top,
    right: popup.selectionBounds.left + popup.selectionBounds.width,
    bottom: popup.selectionBounds.top + popup.selectionBounds.height
  }
  const popupWidth = Math.min(size.width || 320, Math.max(180, pane.width - margin * 2))
  const popupHeight = Math.min(size.height || 58, Math.max(52, pane.height - margin * 2))
  const minLeft = pane.left + margin
  const maxLeft = pane.left + Math.max(margin, pane.width - popupWidth - margin)
  const centeredLeft = selection.left + popup.selectionBounds.width / 2 - popupWidth / 2
  const left = Math.max(minLeft, Math.min(maxLeft, centeredLeft))

  if (mode === 'docked') {
    return {
      left: minLeft,
      top: pane.top + Math.max(margin, pane.height - popupHeight - margin)
    }
  }

  const aboveTop = selection.top - popupHeight - gap
  const belowTop = selection.bottom + gap
  const above = { left, top: aboveTop, right: left + popupWidth, bottom: aboveTop + popupHeight }
  const below = { left, top: belowTop, right: left + popupWidth, bottom: belowTop + popupHeight }
  const fitsAbove = aboveTop >= pane.top + margin && !rectsOverlap(above, selection)
  const fitsBelow = belowTop + popupHeight <= pane.top + pane.height - margin && !rectsOverlap(below, selection)

  if (fitsAbove) {
    return { left, top: aboveTop }
  }
  if (fitsBelow) {
    return { left, top: belowTop }
  }

  const pinnedTop = selection.top > pane.top + pane.height / 2
    ? pane.top + margin
    : pane.top + Math.max(margin, pane.height - popupHeight - margin)
  const pinned = { left, top: pinnedTop, right: left + popupWidth, bottom: pinnedTop + popupHeight }
  if (!rectsOverlap(pinned, selection)) {
    return { left, top: pinnedTop }
  }

  return {
    left: minLeft,
    top: pane.top + Math.max(margin, pane.height - popupHeight - margin)
  }
}

function rectsOverlap(
  first: { left: number; top: number; right: number; bottom: number },
  second: { left: number; top: number; right: number; bottom: number }
) {
  return first.left < second.right && first.right > second.left && first.top < second.bottom && first.bottom > second.top
}
