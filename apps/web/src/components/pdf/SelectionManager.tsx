'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { SelectionArtifactInput } from '../../lib/excerpts/pdf-selection'
import { buildPageAnchor, capturePdfSelection, getVisibleSelectionClientRects } from '../../lib/excerpts/pdf-selection'
import { ActionPopup } from './ActionPopup'
import { clampPopupPosition } from './AnchorService'

export interface SelectionPopupState {
  selection: SelectionArtifactInput
  left: number
  top: number
  viewportRatio: number
  tags: string[]
}

interface SelectionRect {
  left: number
  top: number
  width: number
  height: number
}

interface SelectionLoupeState {
  left: number
  top: number
  text: string
  selectionColor: string
}

interface SelectionManagerProps {
  rootRef: RefObject<HTMLDivElement | null>
  workspaceId: string
  documentId: string
  bookmarkedAnchorIds?: string[]
  popupState?: SelectionPopupState | null
  onPopupStateChange?: (state: SelectionPopupState | null) => void
  onAutoExcerpt: (payload: { selection: SelectionArtifactInput; viewportRatio: number }) => void
  onComment: (payload: { selection: SelectionArtifactInput; viewportRatio: number }) => void
  onBookmark: (selection: SelectionArtifactInput) => void
  onTag: (selection: SelectionArtifactInput, tags: string[]) => void
  onSelectionChange?: (selection: SelectionArtifactInput) => void
}

function getSelectionRect(): DOMRect | null {
  const selection = document.getSelection()
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null
  }

  const range = selection.getRangeAt(0)
  const rects = getVisibleSelectionClientRects(range)
  if (rects.length === 0) {
    return null
  }

  const left = Math.min(...rects.map((rect) => rect.left))
  const top = Math.min(...rects.map((rect) => rect.top))
  const right = Math.max(...rects.map((rect) => rect.right))
  const bottom = Math.max(...rects.map((rect) => rect.bottom))
  return new DOMRect(left, top, right - left, bottom - top)
}

function buildSelectionRects(root: HTMLDivElement, selection: SelectionArtifactInput): SelectionRect[] {
  const page = root.querySelector<HTMLElement>(`.page[data-page-number="${selection.pageNumber}"]`)
  if (!page) {
    return []
  }

  const rootRect = root.getBoundingClientRect()
  const pageRect = page.getBoundingClientRect()
  const pageOffsetLeft = pageRect.left - rootRect.left + root.scrollLeft
  const pageOffsetTop = pageRect.top - rootRect.top + root.scrollTop

  if (!selection.quadPoints || selection.quadPoints.length < 8) {
    return [
      {
        left: pageOffsetLeft + selection.boundingBox.x,
        top: pageOffsetTop + selection.boundingBox.y,
        width: selection.boundingBox.width,
        height: selection.boundingBox.height
      }
    ]
  }

  const rects: SelectionRect[] = []
  for (let index = 0; index < selection.quadPoints.length; index += 8) {
    const quad = selection.quadPoints.slice(index, index + 8)
    if (quad.length < 8) {
      continue
    }

    const xs = [quad[0], quad[2], quad[4], quad[6]]
    const ys = [quad[1], quad[3], quad[5], quad[7]]
    rects.push({
      left: pageOffsetLeft + Math.min(...xs),
      top: pageOffsetTop + Math.min(...ys),
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys)
    })
  }

  return rects
}

export function SelectionManager({
  rootRef,
  workspaceId,
  documentId,
  bookmarkedAnchorIds,
  popupState: controlledPopupState,
  onPopupStateChange,
  onAutoExcerpt,
  onComment,
  onBookmark,
  onTag,
  onSelectionChange
}: SelectionManagerProps) {
  const [uncontrolledPopupState, setUncontrolledPopupState] = useState<SelectionPopupState | null>(null)
  const [isSelecting, setIsSelecting] = useState(false)
  const [loupeState, setLoupeState] = useState<SelectionLoupeState | null>(null)
  const isSelectingRef = useRef(false)

  const popupState = controlledPopupState ?? uncontrolledPopupState
  const bookmarkedSet = useMemo(() => new Set(bookmarkedAnchorIds ?? []), [bookmarkedAnchorIds])

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
  }, [])

  const clearSelection = useCallback(() => {
    try {
      document.getSelection()?.removeAllRanges()
    } catch {}
    setLoupeState(null)
    setPopupState(null)
  }, [setPopupState])

  const updateLoupe = useCallback(() => {
    const root = rootRef.current
    const selectionRect = getSelectionRect()
    const selection = document.getSelection()
    const text = selection?.toString().replace(/\s+/g, ' ').trim() ?? ''
    if (!root || !selectionRect || !text) {
      setLoupeState(null)
      return
    }

    const rootRect = root.getBoundingClientRect()
    const loupeWidth = Math.min(260, Math.max(160, selectionRect.width + 36))
    const preferredLeft = selectionRect.left - rootRect.left + selectionRect.width / 2 - loupeWidth / 2
    const preferredTop = selectionRect.top - rootRect.top - 84
    setLoupeState({
      left: Math.max(12, Math.min(preferredLeft, Math.max(12, root.clientWidth - loupeWidth - 12))),
      top: Math.max(12, preferredTop),
      text,
      selectionColor: popupState?.selection.selectionColor ?? '#5d5df6'
    })
  }, [popupState?.selection.selectionColor, rootRef])

  const commitSelection = useCallback(() => {
    const root = rootRef.current
    if (!root) {
      return
    }

    const nextSelection = capturePdfSelection(root)
    const selectionRect = getSelectionRect()
    if (!nextSelection || !selectionRect) {
      return
    }

    const rootRect = root.getBoundingClientRect()
    const popupSize = { width: 560, height: 124 }
    const popupPosition = clampPopupPosition({
      containerRect: rootRect,
      selectionRect,
      popupWidth: popupSize.width,
      popupHeight: popupSize.height
    })

    const viewportRatio =
      root.clientHeight > 0 ? (selectionRect.top - rootRect.top + root.scrollTop) / root.clientHeight : 0.25

    setPopupState({
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
      left: popupPosition.left + root.scrollLeft,
      top: popupPosition.top + root.scrollTop,
      viewportRatio,
      tags: popupState?.tags ?? []
    })
  }, [documentId, popupState?.selection.selectionColor, popupState?.tags, rootRef, setPopupState, workspaceId])

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
      document.querySelectorAll<HTMLElement>('.textLayer.selecting').forEach((layer) => {
        layer.classList.remove('selecting')
      })
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

    const handleSelectionChange = () => {
      if (!isSelectingRef.current) {
        return
      }

      updateLoupe()
    }

    const handleDocumentPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('.selection-action-popup') || target?.closest('.textLayer')) {
        return
      }

      setLoupeState(null)
      clearSelection()
    }

    root.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('selectionchange', handleSelectionChange)
    document.addEventListener('pointerup', handlePointerUp)
    document.addEventListener('pointerdown', handleDocumentPointerDown)

    return () => {
      document.querySelectorAll<HTMLElement>('.textLayer.selecting').forEach((layer) => {
        layer.classList.remove('selecting')
      })
      isSelectingRef.current = false
      root.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('selectionchange', handleSelectionChange)
      document.removeEventListener('pointerup', handlePointerUp)
      document.removeEventListener('pointerdown', handleDocumentPointerDown)
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

  const popup = useMemo(() => {
    if (!popupState) {
      return null
    }

    const anchorId = buildPageAnchor(popupState.selection).id
    const bookmarked = bookmarkedSet.has(anchorId)

    return (
      <ActionPopup
        left={popupState.left}
        top={popupState.top}
        selectionColor={popupState.selection.selectionColor}
        tags={popupState.tags}
        bookmarked={bookmarked}
        interactive={!isSelecting}
        onAutoExcerpt={() => {
          onAutoExcerpt({ selection: popupState.selection, viewportRatio: popupState.viewportRatio })
          dismiss()
        }}
        onComment={() => {
          onComment({ selection: popupState.selection, viewportRatio: popupState.viewportRatio })
          dismiss()
        }}
        onBookmark={() => {
          onBookmark(popupState.selection)
          dismiss()
        }}
        onTag={(tags) => {
          const nextSelection = { ...popupState.selection, tags }
          setPopupState((current) => (current ? { ...current, selection: nextSelection, tags } : current))
          onTag(nextSelection, tags)
        }}
        onCopy={async () => {
          await navigator.clipboard.writeText(popupState.selection.text)
        }}
        onAddDefinedTerm={() => {
          const tags = Array.from(new Set([...(popupState.selection.tags ?? []), 'defined-term']))
          const nextSelection = { ...popupState.selection, tags }
          setPopupState((current) => (current ? { ...current, selection: nextSelection, tags } : current))
          onTag(nextSelection, tags)
          onAutoExcerpt({ selection: nextSelection, viewportRatio: popupState.viewportRatio })
          dismiss()
        }}
        onColorChange={(nextColor) => {
          const nextSelection =
            popupState
              ? {
                  ...popupState.selection,
                  selectionColor: nextColor
                }
              : null

          setPopupState((current) =>
            current
              ? {
                  ...current,
                  selection: {
                    ...current.selection,
                    selectionColor: nextColor
                  }
                }
              : current
          )
          if (nextSelection) {
            onSelectionChange?.(nextSelection)
          }
        }}
        onClearSelection={clearSelection}
      />
    )
  }, [bookmarkedSet, clearSelection, dismiss, onAutoExcerpt, onBookmark, onComment, onSelectionChange, onTag, popupState, setPopupState])

  const overlayRects = useMemo(() => {
    const root = rootRef.current
    if (!root || !popupState) {
      return []
    }

    return buildSelectionRects(root, popupState.selection)
  }, [popupState, rootRef])

  return (
    <>
      {loupeState ? (
        <div
          className="document-selection-loupe"
          style={{
            left: loupeState.left,
            top: loupeState.top,
            borderColor: `${loupeState.selectionColor}66`,
            boxShadow: `0 16px 28px ${loupeState.selectionColor}24`
          }}
        >
          <div
            className="document-selection-loupe-copy"
            style={{
              color: loupeState.selectionColor
            }}
          >
            {loupeState.text}
          </div>
        </div>
      ) : null}
      {popupState
        ? overlayRects.map((rect, index) => (
            <div
              key={`${rect.left}-${rect.top}-${index}`}
              className="document-selection-overlay"
              style={{
                left: rect.left,
                top: rect.top,
                width: rect.width,
                height: rect.height,
                background: `${popupState.selection.selectionColor}33`,
                borderColor: popupState.selection.selectionColor
              }}
            />
          ))
        : null}
      {popup}
    </>
  )
}
