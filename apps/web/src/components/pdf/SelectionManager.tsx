'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react'
import type { SelectionArtifactInput } from '../../lib/excerpts/pdf-selection'
import { buildPageAnchor, capturePdfSelection, getVisibleSelectionClientRects } from '../../lib/excerpts/pdf-selection'
import { ActionPopup } from './ActionPopup'
import { clampPopupPosition, getSelectionActionPopupPlacementMode } from './AnchorService'

const WORKSPACE_INTERACTION_SELECTOR = [
  '.workspace-pane',
  '.workspace-node',
  '.workspace-textbox-toolbar',
  '.workspace-textbox-editor',
  '.workspace-tool-rail',
  '.workspace-tool-btn',
  '[data-node-editor="true"]',
  '[contenteditable="true"]'
].join(', ')

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
  selectionClientRects?: SelectionRect[]
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
  width: number
  maxWidth: number
  fontSize: number
}

interface SelectionManagerProps {
  rootRef: RefObject<HTMLDivElement | null>
  workspaceId: string
  documentId: string
  bookmarkedAnchorIds?: string[]
  linkedAnchorIds?: string[]
  popupState?: SelectionPopupState | null
  onPopupStateChange?: (state: SelectionPopupState | null) => void
  onAutoExcerpt: (payload: { selection: SelectionArtifactInput; viewportRatio: number }) => void
  onComment: (payload: { selection: SelectionArtifactInput; viewportRatio: number }) => void
  onBookmark: (selection: SelectionArtifactInput) => void
  onRemoveExcerpt?: (anchorId: string) => void
  onRemoveHighlight?: (payload: { anchorId: string; selection: SelectionArtifactInput }) => void
  onTag: (selection: SelectionArtifactInput, tags: string[]) => void
  onSelectionChange?: (selection: SelectionArtifactInput) => void
  onClearFocus?: () => void
}

function getSelectionRect(): DOMRect | null {
  const rects = getSelectionClientRects()
  if (rects.length === 0) {
    return null
  }

  const left = Math.min(...rects.map((rect) => rect.left))
  const top = Math.min(...rects.map((rect) => rect.top))
  const right = Math.max(...rects.map((rect) => rect.right))
  const bottom = Math.max(...rects.map((rect) => rect.bottom))
  return new DOMRect(left, top, right - left, bottom - top)
}

function getSelectionClientRects(): DOMRect[] {
  const selection = document.getSelection()
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return []
  }

  const range = selection.getRangeAt(0)
  return getVisibleSelectionClientRects(range)
}

function getSelectionRootNode(selection: Selection | null): Node | null {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null
  }

  return selection.getRangeAt(0).commonAncestorContainer
}

function nodeToElement(node: Node | null): Element | null {
  if (!node) {
    return null
  }

  return node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
}

export function shouldPreserveWorkspaceFocusForPointerTarget(
  target: Pick<HTMLElement, 'closest'> | null | undefined
) {
  return Boolean(target?.closest(WORKSPACE_INTERACTION_SELECTOR))
}

function buildSelectionRects(root: HTMLDivElement, selection: SelectionArtifactInput): SelectionRect[] {
  const page = root.querySelector<HTMLElement>(`.page[data-page-number="${selection.pageNumber}"]`)
  if (!page) {
    return []
  }

  const rootRect = root.getBoundingClientRect()
  const pageRect = page.getBoundingClientRect()
  const appScale = page.offsetWidth > 0 ? pageRect.width / page.offsetWidth : 1
  const pageOffsetLeft = (pageRect.left - rootRect.left) / appScale + root.scrollLeft
  const pageOffsetTop = (pageRect.top - rootRect.top) / appScale + root.scrollTop

  const currentViewportScale = Number(page.dataset.viewportScale ?? '1')
  const ratio = currentViewportScale / (selection.viewportScale || currentViewportScale)

  if (!selection.quadPoints || selection.quadPoints.length < 8) {
    return [
      {
        left: pageOffsetLeft + selection.boundingBox.x * ratio,
        top: pageOffsetTop + selection.boundingBox.y * ratio,
        width: selection.boundingBox.width * ratio,
        height: selection.boundingBox.height * ratio
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
      left: pageOffsetLeft + Math.min(...xs) * ratio,
      top: pageOffsetTop + Math.min(...ys) * ratio,
      width: (Math.max(...xs) - Math.min(...xs)) * ratio,
      height: (Math.max(...ys) - Math.min(...ys)) * ratio
    })
  }

  return rects
}

function getSelectionUnionRect(rects: SelectionRect[]): SelectionRect | null {
  if (rects.length === 0) {
    return null
  }

  const left = Math.min(...rects.map((rect) => rect.left))
  const top = Math.min(...rects.map((rect) => rect.top))
  const right = Math.max(...rects.map((rect) => rect.left + rect.width))
  const bottom = Math.max(...rects.map((rect) => rect.top + rect.height))

  return {
    left,
    top,
    width: right - left,
    height: bottom - top
  }
}

function areSelectionRectsEqual(left: SelectionRect[] | undefined, right: SelectionRect[]) {
  if (!left || left.length !== right.length) {
    return false
  }

  return left.every((rect, index) => {
    const other = right[index]
    return (
      Math.abs(rect.left - other.left) < 0.5 &&
      Math.abs(rect.top - other.top) < 0.5 &&
      Math.abs(rect.width - other.width) < 0.5 &&
      Math.abs(rect.height - other.height) < 0.5
    )
  })
}

function isSelectionRectEqual(left: SelectionRect, right: SelectionRect) {
  return (
    Math.abs(left.left - right.left) < 0.5 &&
    Math.abs(left.top - right.top) < 0.5 &&
    Math.abs(left.width - right.width) < 0.5 &&
    Math.abs(left.height - right.height) < 0.5
  )
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
  onRemoveExcerpt,
  onRemoveHighlight,
  onTag,
  onSelectionChange,
  onClearFocus
}: SelectionManagerProps) {
  const popupPlacementMode = getSelectionActionPopupPlacementMode()
  const [uncontrolledPopupState, setUncontrolledPopupState] = useState<SelectionPopupState | null>(null)
  const [isSelecting, setIsSelecting] = useState(false)
  const [loupeState, setLoupeState] = useState<SelectionLoupeState | null>(null)
  const [popupSize, setPopupSize] = useState<{ width: number; height: number } | null>(null)
  const isSelectingRef = useRef(false)

  const popupState = controlledPopupState ?? uncontrolledPopupState
  const bookmarkedSet = useMemo(() => new Set(bookmarkedAnchorIds ?? []), [bookmarkedAnchorIds])
  const linkedSet = useMemo(() => new Set(linkedAnchorIds ?? []), [linkedAnchorIds])

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
    setLoupeState(null)
    setPopupState(null)
    onClearFocus?.()
  }, [onClearFocus, setPopupState])

  useEffect(() => {
    document.body.classList.toggle('is-selecting-pdf-text', isSelecting)
    return () => {
      document.body.classList.remove('is-selecting-pdf-text')
    }
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
    const commonAncestor = getSelectionRootNode(selection)
    const commonAncestorElement = nodeToElement(commonAncestor)
    const startElement = nodeToElement(range.startContainer)
    const endElement = nodeToElement(range.endContainer)
    const belongsToRoot =
      (commonAncestorElement && root.contains(commonAncestorElement)) ||
      (startElement && root.contains(startElement)) ||
      (endElement && root.contains(endElement))

    if (!belongsToRoot) {
      setLoupeState(null)
      return
    }

    const selectionRect = getSelectionRect()
    const selectionClientRects = getSelectionClientRects()
    if (!selectionRect) {
      setLoupeState(null)
      return
    }
    if (selectionClientRects.length === 0) {
      setLoupeState(null)
      return
    }

    const startsInTextLayer = Boolean(startElement?.closest('.textLayer'))
    const endsInTextLayer = Boolean(endElement?.closest('.textLayer'))
    if (!startsInTextLayer && !endsInTextLayer) {
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
    const loupeGap = 18
    const preferredLeft =
      selectionLeft - rootRect.left + root.scrollLeft + (selectionRight - selectionLeft) / 2 - loupeWidth / 2
    const preferredAboveTop = selectionTop - rootRect.top + root.scrollTop - loupeHeightEstimate - loupeGap

    const minLeft = root.scrollLeft + 12
    const maxLeft = root.scrollLeft + Math.max(12, root.clientWidth - loupeWidth - 12)
    const minTop = root.scrollTop + 12
    const maxTop = root.scrollTop + Math.max(12, root.clientHeight - loupeHeightEstimate - 12)
    setLoupeState({
      left: Math.max(minLeft, Math.min(preferredLeft, maxLeft)),
      top: Math.max(minTop, Math.min(preferredAboveTop, maxTop)),
      text,
      selectionColor: popupState?.selection.selectionColor ?? '#5d5df6',
      width: loupeWidth,
      maxWidth: loupeMaxWidth,
      fontSize: loupeFontSize
    })
  }, [popupState?.selection.selectionColor, rootRef])

  const recomputePopupPosition = useCallback(
    (
      state: SelectionPopupState,
      nextPopupSize: { width: number; height: number },
      liveSelectionRects?: SelectionRect[]
    ) => {
      const root = rootRef.current
      if (!root) {
        return null
      }

      const rootRect = root.getBoundingClientRect()
      const sourceSelectionRects =
        liveSelectionRects && liveSelectionRects.length > 0
          ? liveSelectionRects
          : state.selectionClientRects && state.selectionClientRects.length > 0
            ? state.selectionClientRects
            : [state.selectionBounds]
      const selectionBounds = getSelectionUnionRect(sourceSelectionRects)
      if (!selectionBounds) {
        return null
      }
      const selectionRectViewport = new DOMRect(
        selectionBounds.left - root.scrollLeft + rootRect.left,
        selectionBounds.top - root.scrollTop + rootRect.top,
        selectionBounds.width,
        selectionBounds.height
      )
      const selectionClientRectsViewport =
        sourceSelectionRects.map(
          (rect) =>
            new DOMRect(
              rect.left - root.scrollLeft + rootRect.left,
              rect.top - root.scrollTop + rootRect.top,
              rect.width,
              rect.height
            )
        )

      const safePopupWidth = Math.min(nextPopupSize.width, Math.max(120, rootRect.width - 24))
      const safePopupHeight = Math.min(nextPopupSize.height, Math.max(80, rootRect.height - 24))
      const popupPosition = clampPopupPosition({
        containerRect: rootRect,
        selectionRect: selectionRectViewport,
        selectionRects: selectionClientRectsViewport,
        popupWidth: safePopupWidth,
        popupHeight: safePopupHeight,
        gap: 14,
        mode: popupPlacementMode
      })

      const nextLeft = popupPosition.left + root.scrollLeft
      const nextTop = popupPosition.top + root.scrollTop
      const positionUnchanged = Math.abs(nextLeft - state.left) < 0.5 && Math.abs(nextTop - state.top) < 0.5
      const boundsUnchanged = isSelectionRectEqual(state.selectionBounds, selectionBounds)
      const rectsUnchanged = areSelectionRectsEqual(state.selectionClientRects, sourceSelectionRects)

      if (positionUnchanged && boundsUnchanged && rectsUnchanged) {
        return null
      }

      return {
        nextLeft,
        nextTop,
        nextSelectionBounds: selectionBounds,
        nextSelectionClientRects: sourceSelectionRects
      }
    },
    [popupPlacementMode, rootRef]
  )

  const commitSelection = useCallback(() => {
    const root = rootRef.current
    if (!root) {
      return
    }

    const nextSelection = capturePdfSelection(root)
    const selectionClientRects = getSelectionClientRects()
    const selectionRect = getSelectionRect()
    if (!nextSelection || !selectionRect || selectionClientRects.length === 0) {
      return
    }
    if (nextSelection.text.trim().length === 0) {
      return
    }

    const rootRect = root.getBoundingClientRect()
    const nextPopupSize = popupSize ?? { width: 560, height: 152 }
    const popupPosition = clampPopupPosition({
      containerRect: rootRect,
      selectionRect,
      selectionRects: selectionClientRects,
      popupWidth: Math.min(nextPopupSize.width, Math.max(120, rootRect.width - 24)),
      popupHeight: Math.min(nextPopupSize.height, Math.max(80, rootRect.height - 24)),
      gap: 14,
      mode: popupPlacementMode
    })

    const viewportRatio =
      root.clientHeight > 0 ? (selectionRect.top - rootRect.top + root.scrollTop) / root.clientHeight : 0.25

    const selectionBounds = {
      left: selectionRect.left - rootRect.left + root.scrollLeft,
      top: selectionRect.top - rootRect.top + root.scrollTop,
      width: selectionRect.width,
      height: selectionRect.height
    }
    const selectionBoundsRects = selectionClientRects.map((rect) => ({
      left: rect.left - rootRect.left + root.scrollLeft,
      top: rect.top - rootRect.top + root.scrollTop,
      width: rect.width,
      height: rect.height
    }))

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
      left: popupPosition.left + root.scrollLeft,
      top: popupPosition.top + root.scrollTop,
      viewportRatio,
      tags: popupState?.tags ?? [],
      selectionBounds,
      selectionClientRects: selectionBoundsRects
    })
  }, [documentId, popupPlacementMode, popupSize, popupState?.selection.selectionColor, popupState?.tags, rootRef, setPopupState, workspaceId])

  const overlayRects = useMemo(() => {
    const root = rootRef.current
    if (!root || !popupState) {
      return []
    }

    return buildSelectionRects(root, popupState.selection)
  }, [popupState, rootRef])
  const popupSelectionRects = useMemo(
    () => (overlayRects.length > 0 ? overlayRects : popupState?.selectionClientRects ?? []),
    [overlayRects, popupState?.selectionClientRects]
  )

  useEffect(() => {
    if (!popupState || !popupSize) {
      return
    }

    const next = recomputePopupPosition(popupState, popupSize, popupSelectionRects)
    if (!next) {
      return
    }

    setPopupState((current) =>
      current
        ? {
            ...current,
            left: next.nextLeft,
            top: next.nextTop,
            selectionBounds: next.nextSelectionBounds,
            selectionClientRects: next.nextSelectionClientRects
          }
        : current
    )
  }, [popupSelectionRects, popupSize, popupState, recomputePopupPosition, setPopupState])

  useEffect(() => {
    if (!popupState || !popupSize) {
      return
    }

    const handleResize = () => {
      const next = recomputePopupPosition(popupState, popupSize, popupSelectionRects)
      if (!next) {
        return
      }

      setPopupState((current) =>
        current
          ? {
              ...current,
              left: next.nextLeft,
              top: next.nextTop,
              selectionBounds: next.nextSelectionBounds,
              selectionClientRects: next.nextSelectionClientRects
            }
          : current
      )
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [popupSelectionRects, popupSize, popupState, recomputePopupPosition, setPopupState])

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

    const handlePointerMove = () => {
      if (!isSelectingRef.current) {
        return
      }

      updateLoupe()
    }

    const handleSelectionChange = () => {
      if (!isSelectingRef.current) {
        return
      }

      updateLoupe()
    }

    const handleDocumentPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null
      if (
        target?.closest('.selection-action-popup') ||
        target?.closest('.textLayer') ||
        target?.closest('.page-anchor-indicator') ||
        target?.closest('.page-anchor-margin') ||
        target?.closest('.document-tag-badges') ||
        target?.closest('.document-highlight-button')
      ) {
        return
      }

      if (shouldPreserveWorkspaceFocusForPointerTarget(target)) {
        try {
          document.getSelection()?.removeAllRanges()
        } catch {}
        setLoupeState(null)
        setPopupState(null)
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
      document.querySelectorAll<HTMLElement>('.textLayer.selecting').forEach((layer) => {
        layer.classList.remove('selecting')
      })
      isSelectingRef.current = false
      root.removeEventListener('pointerdown', handlePointerDown)
      root.removeEventListener('pointermove', handlePointerMove)
      document.removeEventListener('selectionchange', handleSelectionChange)
      document.removeEventListener('pointerup', handlePointerUp)
      document.removeEventListener('pointerdown', handleDocumentPointerDown)
    }
  }, [clearSelection, commitSelection, dismiss, rootRef, setPopupState, updateLoupe])

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

    const bookmarked = bookmarkedSet.has(popupState.anchorId)
    const linked = linkedSet.has(popupState.anchorId)
    const clearHighlightedSelection = () => {
      if (linked) {
        onRemoveExcerpt?.(popupState.anchorId)
      }
      if (onRemoveHighlight) {
        onRemoveHighlight({ anchorId: popupState.anchorId, selection: popupState.selection })
      }
      clearSelection()
    }

    return (
      <ActionPopup
        left={popupState.left}
        top={popupState.top}
        selectionColor={popupState.selection.selectionColor}
        tags={popupState.tags}
        bookmarked={bookmarked}
        interactive={!isSelecting}
        onSizeChange={setPopupSize}
        onAutoExcerpt={() => {
          onAutoExcerpt({ selection: popupState.selection, viewportRatio: popupState.viewportRatio })
        }}
        onComment={() => {
          onComment({ selection: popupState.selection, viewportRatio: popupState.viewportRatio })
        }}
        onBookmark={() => {
          onBookmark(popupState.selection)
          setPopupState(null)
          clearSelection()
        }}
        onTag={(tags) => {
          const nextSelection = { ...popupState.selection, tags }
          setPopupState((current) => (current ? { ...current, selection: nextSelection, tags } : current))
          onTag(nextSelection, tags)
        }}
        onClearTags={() => {
          const nextSelection = { ...popupState.selection, tags: [] }
          setPopupState((current) => (current ? { ...current, selection: nextSelection, tags: [] } : current))
          onTag(nextSelection, [])
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
        onClearSelection={clearHighlightedSelection}
      />
    )
  }, [bookmarkedSet, clearSelection, linkedSet, isSelecting, onAutoExcerpt, onBookmark, onComment, onRemoveExcerpt, onRemoveHighlight, onSelectionChange, onTag, popupState, setPopupState])

  return (
    <>
      {loupeState ? (
        <div
          className="document-selection-loupe"
          style={{
            left: loupeState.left,
            top: loupeState.top,
            '--selection-loupe-width': `${loupeState.width}px`,
            '--selection-loupe-max-width': `${loupeState.maxWidth}px`,
            '--selection-loupe-font-size': `${loupeState.fontSize}px`,
            borderColor: `${loupeState.selectionColor}66`,
            boxShadow: `0 16px 28px ${loupeState.selectionColor}24`
          } as CSSProperties}
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
