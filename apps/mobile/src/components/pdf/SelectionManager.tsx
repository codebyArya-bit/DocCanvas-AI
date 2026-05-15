'use client'

import { type CSSProperties, type PointerEvent as ReactPointerEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { SelectionArtifactInput } from '../../lib/excerpts/pdf-selection'
import { buildPageAnchor, capturePdfSelection } from '../../lib/excerpts/pdf-selection'
import { resolveSelectionPopupPosition, type SelectionPopupPlacement, type SelectionViewportRect } from '../../lib/selection-popup-position'

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
  selectionClientRects?: Array<{
    left: number
    top: number
    width: number
    height: number
  }>
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
  const [isSelecting, setIsSelecting] = useState(false)
  const [loupeState, setLoupeState] = useState<SelectionLoupeState | null>(null)
  const [popupSize, setPopupSize] = useState({ width: 320, height: 58 })
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
    setPopupState(null)
    setLoupeState(null)
    setIsSelecting(false)
    onClearFocus?.()
  }, [onClearFocus, setPopupState])

  useEffect(() => {
    document.body.classList.toggle('is-selecting-pdf-text', isSelecting)
    return () => document.body.classList.remove('is-selecting-pdf-text')
  }, [isSelecting])

  const updateLoupe = useCallback(() => {
    const root = rootRef.current
    const selection = document.getSelection()
    const text = selection?.toString().replace(/\s+/g, ' ').trim() ?? ''
    if (!root || !selection || selection.rangeCount === 0 || !text) {
      setLoupeState(null)
      return
    }

    const range = selection.getRangeAt(0)
    const startElement = nodeToElement(range.startContainer)
    const endElement = nodeToElement(range.endContainer)
    const belongsToRoot = Boolean((startElement && root.contains(startElement)) || (endElement && root.contains(endElement)))
    if (!belongsToRoot || (!startElement?.closest('.textLayer') && !endElement?.closest('.textLayer'))) {
      setLoupeState(null)
      return
    }

    const selectionRect = getSelectionRect()
    const selectionClientRects = getSelectionClientRects()
    if (!selectionRect || selectionClientRects.length === 0) {
      setLoupeState(null)
      return
    }

    const rootRect = root.getBoundingClientRect()
    const selectionLeft = Math.min(...selectionClientRects.map((rect) => rect.left))
    const selectionTop = Math.min(...selectionClientRects.map((rect) => rect.top))
    const selectionRight = Math.max(...selectionClientRects.map((rect) => rect.right))
    const tallestSelectionLine = Math.max(...selectionClientRects.map((rect) => rect.height), selectionRect.height)
    const loupeWidth = Math.min(Math.max(160, root.clientWidth - 24), Math.max(180, selectionRect.width + 52))
    const loupeMaxWidth = Math.min(Math.max(220, root.clientWidth - 24), 360)
    const loupeFontSize = Math.max(18, Math.min(30, tallestSelectionLine * 1.18))
    const loupeHeightEstimate = loupeFontSize * 2.7 + 28
    const preferredLeft = selectionLeft - rootRect.left + (selectionRight - selectionLeft) / 2 - loupeWidth / 2
    const preferredAboveTop = selectionTop - rootRect.top - loupeHeightEstimate - 8
    const left = Math.max(rootRect.left + 12, Math.min(rootRect.right - loupeWidth - 12, rootRect.left + preferredLeft))
    const aboveTop = rootRect.top + preferredAboveTop
    const belowTop = selectionRect.bottom + 8
    const top = aboveTop >= rootRect.top + 12
      ? aboveTop
      : Math.min(rootRect.bottom - loupeHeightEstimate - 12, belowTop)

    setLoupeState({
      left,
      top,
      text,
      selectionColor: popupState?.selection.selectionColor ?? '#5d5df6',
      width: loupeWidth,
      maxWidth: loupeMaxWidth,
      fontSize: loupeFontSize
    })
  }, [popupState?.selection.selectionColor, rootRef])

  const commitSelection = useCallback(() => {
    const root = rootRef.current
    if (!root) {
      return
    }

    const nextSelection = capturePdfSelection(root)
    const selectionRect = getSelectionRect()
    const selectionClientRects = getSelectionClientRects()
    if (!nextSelection || !selectionRect || selectionClientRects.length === 0) {
      return
    }
    if (nextSelection.text.trim().length === 0) {
      return
    }

    const rootRect = root.getBoundingClientRect()
    const popupPosition = resolveSelectionPopupPosition({
      preferredLeft: selectionRect.left + selectionRect.width / 2,
      preferredTop: selectionRect.bottom + 12,
      popupWidth: Math.min(popupSize.width, Math.max(120, rootRect.width - 24)),
      popupHeight: Math.min(popupSize.height, Math.max(80, rootRect.height - 24)),
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      selectionRect: domRectToSelectionRect(selectionRect),
      selectionRects: selectionClientRects.map(domRectToSelectionRect)
    })

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
      left: popupPosition.left,
      top: popupPosition.top,
      viewportRatio: root.clientHeight > 0 ? (selectionRect.top - rootRect.top + root.scrollTop) / root.clientHeight : 0.25,
      tags: popupState?.tags ?? [],
      selectionBounds: domRectToStoredRect(selectionRect),
      selectionClientRects: selectionClientRects.map(domRectToStoredRect),
      paneBounds: {
        left: rootRect.left,
        top: rootRect.top,
        width: root.clientWidth,
        height: root.clientHeight
      },
      sourcePaneWidth: root.clientWidth,
      sourcePaneHeight: root.clientHeight
    })
  }, [documentId, popupSize, popupState?.selection.selectionColor, popupState?.tags, rootRef, setPopupState, workspaceId])

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
        target?.closest('.textLayer')?.classList.add('selecting')
      }
      isSelectingRef.current = isTextLayerInteraction
      setIsSelecting(isTextLayerInteraction)
      setLoupeState(null)
    }

    const handlePointerUp = () => {
      document.querySelectorAll<HTMLElement>('.textLayer.selecting').forEach((layer) => layer.classList.remove('selecting'))
      if (!isSelectingRef.current) {
        return
      }

      setLoupeState(null)
      window.setTimeout(() => {
        commitSelection()
      }, 0)
      isSelectingRef.current = false
      setIsSelecting(false)
    }

    const handlePointerMove = () => {
      if (!isSelectingRef.current) return
      updateLoupe()
    }

    const handleSelectionChange = () => {
      if (!isSelectingRef.current) return
      updateLoupe()
    }

    const handleDocumentPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null
      if (
        target?.closest('.selection-action-popup') ||
        target?.closest('.textLayer') ||
        target?.closest('.page-anchor-indicator') ||
        target?.closest('.mobile-source-anchor-marker') ||
        target?.closest('.document-tag-badges') ||
        target?.closest('.document-highlight-button')
      ) {
        return
      }

      setLoupeState(null)
      clearSelection()
    }

    root.addEventListener('pointerdown', handlePointerDown)
    root.addEventListener('pointermove', handlePointerMove)
    document.addEventListener('selectionchange', handleSelectionChange)
    document.addEventListener('pointerup', handlePointerUp)
    document.addEventListener('pointerdown', handleDocumentPointerDown)

    return () => {
      document.querySelectorAll<HTMLElement>('.textLayer.selecting').forEach((layer) => layer.classList.remove('selecting'))
      isSelectingRef.current = false
      root.removeEventListener('pointerdown', handlePointerDown)
      root.removeEventListener('pointermove', handlePointerMove)
      document.removeEventListener('selectionchange', handleSelectionChange)
      document.removeEventListener('pointerup', handlePointerUp)
      document.removeEventListener('pointerdown', handleDocumentPointerDown)
      setLoupeState(null)
    }
  }, [clearSelection, commitSelection, dismiss, rootRef, updateLoupe])

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
      {loupeState ? <SelectionLoupe loupe={loupeState} /> : null}
      {popupState ? (
        <PdfSelectionActionPopup
          key={popupState.anchorId}
          popup={popupState}
          bookmarked={bookmarkedSet.has(popupState.anchorId)}
          onSizeChange={setPopupSize}
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
  onClear,
  onSizeChange
}: {
  popup: SelectionPopupState
  bookmarked: boolean
  onAutoExcerpt: () => void
  onComment: () => void
  onBookmark: () => void
  onColor: (color: string) => void
  onTags: (tags: string[]) => void
  onClear: () => void
  onSizeChange: (size: { width: number; height: number }) => void
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
  const allocatedTags = popup.tags
  const color = popup.selection.selectionColor ?? '#5d5df6'
  const isDocked = popup.sourcePaneWidth < 460 || popup.sourcePaneHeight < 360
  const popupPosition = useMemo(
    () => resolvePdfPopupPosition(popup, popupSize),
    [popup, popupSize]
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
      const nextSize = { width: rect.width, height: rect.height }
      setPopupSize((current) =>
        Math.abs(current.width - rect.width) < 0.5 && Math.abs(current.height - rect.height) < 0.5
          ? current
          : nextSize
      )
      onSizeChange(nextSize)
    }

    emit()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(emit)
    observer.observe(element)
    return () => observer.disconnect()
  }, [mode, moreOpen, onSizeChange, tagDraft])

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
      className={`selection-action-popup is-mobile-${mode}${isDocked ? ' is-mobile-docked' : ''} is-placed-${popupPosition.placement}`}
      style={{
        left: popupPosition.left,
        top: popupPosition.top,
        borderColor: `${color}55`,
        boxShadow: `0 22px 45px ${color}22`,
        pointerEvents: 'auto'
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
                  <button className="selection-action-menu-item" type="button" onClick={() => { const next = Array.from(new Set([...allocatedTags, 'defined-term'])); setTagDraft(next.join(', ')); commitTags(next); setMoreOpen(false) }}>Add Defined Term</button>
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
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  commitTags()
                }
              }}
            />
          </label>
        </div>
        <div className="selection-action-tag-summary" aria-live="polite">
          <div className="selection-action-tag-summary-label">Allocated tags</div>
          {allocatedTags.length ? (
            <div className="selection-action-tag-bar" aria-label="Tags allocated to selected text">
              {allocatedTags.map((tag) => (
                <button key={tag} type="button" className="selection-action-tag-chip is-active" onClick={() => {
                  const next = allocatedTags.filter((entry) => entry !== tag)
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
              <button key={tag} type="button" className={`selection-action-tag-preset${allocatedTags.includes(tag) ? ' is-active' : ''}`} onClick={() => {
                const next = allocatedTags.includes(tag) ? allocatedTags.filter((entry) => entry !== tag) : Array.from(new Set([...allocatedTags, tag]))
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

function resolvePdfPopupPosition(
  popup: SelectionPopupState,
  size: { width: number; height: number }
): { left: number; top: number; placement: SelectionPopupPlacement } {
  const selectionRect = storedRectToViewportRect(popup.selectionBounds)
  return resolveSelectionPopupPosition({
    preferredLeft: popup.left,
    preferredTop: popup.top,
    popupWidth: Math.max(1, size.width || 320),
    popupHeight: Math.max(1, size.height || 58),
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    selectionRect,
    selectionRects: popup.selectionClientRects?.map(storedRectToViewportRect)
  })
}

function storedRectToViewportRect(bounds: SelectionPopupState['selectionBounds']): SelectionViewportRect {
  return {
    left: bounds.left,
    top: bounds.top,
    right: bounds.left + bounds.width,
    bottom: bounds.top + bounds.height,
    width: bounds.width,
    height: bounds.height
  }
}

type SelectionLoupeState = {
  left: number
  top: number
  text: string
  selectionColor: string
  width: number
  maxWidth: number
  fontSize: number
}

function nodeToElement(node: Node | null) {
  if (!node) return null
  return node instanceof Element ? node : node.parentElement
}

function getSelectionClientRects() {
  const selection = document.getSelection()
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return []
  const range = selection.getRangeAt(0)
  return Array.from(range.getClientRects()).filter((rect) => rect.width > 1 && rect.height > 1)
}

function getSelectionRect() {
  const selection = document.getSelection()
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null
  const range = selection.getRangeAt(0)
  const rects = getSelectionClientRects()
  const rect = rects.length ? unionDomRects(rects) : range.getBoundingClientRect()
  return rect && rect.width > 0 && rect.height > 0 ? rect : null
}

function unionDomRects(rects: DOMRect[]) {
  const left = Math.min(...rects.map((rect) => rect.left))
  const top = Math.min(...rects.map((rect) => rect.top))
  const right = Math.max(...rects.map((rect) => rect.right))
  const bottom = Math.max(...rects.map((rect) => rect.bottom))
  return new DOMRect(left, top, right - left, bottom - top)
}

function domRectToSelectionRect(rect: DOMRect): SelectionViewportRect {
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height
  }
}

function domRectToStoredRect(rect: DOMRect) {
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height
  }
}

function SelectionLoupe({ loupe }: { loupe: SelectionLoupeState }) {
  const style = {
    left: loupe.left,
    top: loupe.top,
    '--selection-loupe-width': `${loupe.width}px`,
    '--selection-loupe-max-width': `${loupe.maxWidth}px`,
    '--selection-loupe-font-size': `${loupe.fontSize}px`,
    borderColor: `${loupe.selectionColor}66`,
    boxShadow: `0 16px 28px ${loupe.selectionColor}24`
  } as CSSProperties

  return (
    <div className="document-selection-loupe" style={style}>
      <div className="document-selection-loupe-copy" style={{ color: loupe.selectionColor }}>
        {loupe.text.length > 160 ? `${loupe.text.slice(0, 157)}...` : loupe.text}
      </div>
    </div>
  )
}
