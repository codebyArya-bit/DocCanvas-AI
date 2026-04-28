import type { BoundingBox, PageAnchor } from '@workspace/domain'
import type { SelectionArtifactInput } from '../../lib/excerpts/pdf-selection'
import { resolveAnchorClientRects } from '../../lib/excerpts/pdf-selection'

export interface AnchorRect {
  x: number
  y: number
  width: number
  height: number
}

export interface PopupPlacementInput {
  containerRect: DOMRect
  selectionRect: DOMRect
  selectionRects?: DOMRect[]
  popupWidth: number
  popupHeight: number
  gap?: number
  mode?: PopupPlacementMode
}

export type PopupPlacementMode = 'legacy' | 'avoid-overlap'

export interface AnchorViewportMetric {
  anchorId: string
  x: number
  y: number
  width: number
  height: number
  centerX: number
  centerY: number
  rects: AnchorRect[]
}

export interface LiveAnchorElements {
  startSpan: HTMLElement | null
  endSpan: HTMLElement | null
}

function toRect(box: BoundingBox): AnchorRect {
  return { x: box.x, y: box.y, width: box.width, height: box.height }
}

export function buildAnchorRectsFromSelection(selection: SelectionArtifactInput): AnchorRect[] {
  if (!selection.quadPoints || selection.quadPoints.length < 8) {
    return [toRect(selection.boundingBox)]
  }

  const rects: AnchorRect[] = []
  for (let index = 0; index < selection.quadPoints.length; index += 8) {
    const quad = selection.quadPoints.slice(index, index + 8)
    if (quad.length < 8) {
      continue
    }

    const xs = [quad[0], quad[2], quad[4], quad[6]]
    const ys = [quad[1], quad[3], quad[5], quad[7]]
    rects.push({
      x: Math.min(...xs),
      y: Math.min(...ys),
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys)
    })
  }

  return rects.length > 0 ? rects : [toRect(selection.boundingBox)]
}

export function buildAnchorRects(anchor: PageAnchor): AnchorRect[] {
  if (!anchor.quadPoints || anchor.quadPoints.length < 8) {
    return [toRect(anchor.boundingBox)]
  }

  const rects: AnchorRect[] = []
  for (let index = 0; index < anchor.quadPoints.length; index += 8) {
    const quad = anchor.quadPoints.slice(index, index + 8)
    if (quad.length < 8) {
      continue
    }

    const xs = [quad[0], quad[2], quad[4], quad[6]]
    const ys = [quad[1], quad[3], quad[5], quad[7]]
    rects.push({
      x: Math.min(...xs),
      y: Math.min(...ys),
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys)
    })
  }

  return rects.length > 0 ? rects : [toRect(anchor.boundingBox)]
}

export function getLiveAnchorElements(pageElement: HTMLElement, anchor: Pick<PageAnchor, 'startSpanIndex' | 'endSpanIndex'>): LiveAnchorElements {
  const textLayer = pageElement.querySelector<HTMLElement>('.textLayer')
  if (!textLayer) {
    return {
      startSpan: null,
      endSpan: null
    }
  }

  return {
    startSpan:
      anchor.startSpanIndex == null
        ? null
        : textLayer.querySelector<HTMLElement>(`span[data-text-index="${anchor.startSpanIndex}"]`),
    endSpan:
      anchor.endSpanIndex == null
        ? null
        : textLayer.querySelector<HTMLElement>(`span[data-text-index="${anchor.endSpanIndex}"]`)
  }
}

function parseCssLength(value: string, relativeSize: number): number | null {
  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }

  if (trimmed.endsWith('%')) {
    const percent = Number.parseFloat(trimmed.slice(0, -1))
    return Number.isFinite(percent) ? (relativeSize * percent) / 100 : null
  }

  if (trimmed.endsWith('px')) {
    const pixels = Number.parseFloat(trimmed.slice(0, -2))
    return Number.isFinite(pixels) ? pixels : null
  }

  const numeric = Number.parseFloat(trimmed)
  return Number.isFinite(numeric) ? numeric : null
}

export function measureTextLayerSpanCenterY(pageElement: HTMLElement, span: HTMLElement | null): number | null {
  if (!span) {
    return null
  }

  const textLayer = pageElement.querySelector<HTMLElement>('.textLayer')
  if (!textLayer) {
    return null
  }

  const computedStyle = getComputedStyle(span)
  const rawTop = span.style.top || computedStyle.top
  const rawFontHeight =
    span.style.getPropertyValue('--font-height') ||
    computedStyle.getPropertyValue('--font-height') ||
    computedStyle.fontSize

  const topPx = parseCssLength(rawTop, textLayer.clientHeight) ?? span.offsetTop
  const fontHeightPx =
    parseCssLength(rawFontHeight, textLayer.clientHeight) ??
    parseCssLength(computedStyle.fontSize, textLayer.clientHeight) ??
    span.offsetHeight

  return textLayer.offsetTop + topPx + fontHeightPx / 2
}

export function measureAnchorMetric(
  anchor: PageAnchor,
  pageElement: HTMLElement | null,
  shellRect: DOMRect,
  shellScale = 1
): AnchorViewportMetric | null {
  if (!pageElement) {
    return null
  }

  const esc = typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape : null
  const marker =
    (esc
      ? pageElement.querySelector<HTMLButtonElement>(
          `button.page-anchor-indicator-right[data-anchor-id="${esc(anchor.id)}"]`
        ) ??
        pageElement.querySelector<HTMLButtonElement>(`button.page-anchor-indicator[data-anchor-id="${esc(anchor.id)}"]`)
      : null) ??
    null
  const resolvedMarker =
    marker ??
    Array.from(
      pageElement.querySelectorAll<HTMLButtonElement>(
        'button.page-anchor-indicator-right[data-anchor-id], button.page-anchor-indicator[data-anchor-id]'
      )
    ).find((button) => button.dataset.anchorId === anchor.id) ??
    null

  if (resolvedMarker) {
    const rect = resolvedMarker.getBoundingClientRect()
    const scale = shellScale || 1
    const x = (rect.left - shellRect.left) / scale
    const y = (rect.top - shellRect.top) / scale
    const width = rect.width / scale
    const height = rect.height / scale
    return {
      anchorId: anchor.id,
      x,
      y,
      width,
      height,
      centerX: x + width / 2,
      centerY: y + height / 2,
      rects: [{ x, y, width, height }]
    }
  }

  const liveAnchor = getLiveAnchorElements(pageElement, anchor)
  const startSpanCenterY = measureTextLayerSpanCenterY(pageElement, liveAnchor.startSpan)
  const startSpanRect = liveAnchor.startSpan?.getBoundingClientRect() ?? null
  const liveRects = resolveAnchorClientRects(pageElement, anchor)
  if (startSpanCenterY == null && liveRects.length === 0) {
    return null
  }

  const scale = shellScale || 1
  const viewportRects = (
    liveRects.length > 0
      ? liveRects
      : startSpanRect
        ? [startSpanRect]
        : []
  ).map((rect) => ({
    x: (rect.left - shellRect.left) / scale,
    y: (rect.top - shellRect.top) / scale,
    width: rect.width / scale,
    height: rect.height / scale
  }))

  const left = Math.min(...viewportRects.map((rect) => rect.x))
  const top = Math.min(...viewportRects.map((rect) => rect.y))
  const right = Math.max(...viewportRects.map((rect) => rect.x + rect.width))
  const bottom = Math.max(...viewportRects.map((rect) => rect.y + rect.height))
  const centerY = startSpanCenterY != null
    ? (pageElement.getBoundingClientRect().top - shellRect.top + startSpanCenterY) / scale
    : top + (bottom - top) / 2

  return {
    anchorId: anchor.id,
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
    centerX: left + (right - left) / 2,
    centerY,
    rects: viewportRects
  }
}

export function clampPopupPosition({
  containerRect,
  selectionRect,
  selectionRects,
  popupWidth,
  popupHeight,
  gap = 12,
  mode = getSelectionActionPopupPlacementMode()
}: PopupPlacementInput) {
  if (mode === 'legacy') {
    return clampPopupPositionLegacy({
      containerRect,
      selectionRect,
      popupWidth,
      popupHeight,
      gap
    })
  }

  return clampPopupPositionAvoidOverlap({
    containerRect,
    selectionRect,
    selectionRects,
    popupWidth,
    popupHeight,
    gap
  })
}

export function getSelectionActionPopupPlacementMode(): PopupPlacementMode {
  return process.env.NEXT_PUBLIC_SELECTION_ACTION_POPUP_PLACEMENT_MODE === 'legacy'
    ? 'legacy'
    : 'avoid-overlap'
}

function clampValue(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function toContainerRelativeRect(rect: DOMRect, containerRect: DOMRect) {
  const left = rect.left - containerRect.left
  const top = rect.top - containerRect.top
  return {
    left,
    top,
    right: left + rect.width,
    bottom: top + rect.height,
    width: rect.width,
    height: rect.height
  }
}

function getRectOverlapArea(
  candidate: { left: number; top: number },
  popupWidth: number,
  popupHeight: number,
  blocker: { left: number; top: number; right: number; bottom: number }
) {
  const overlapWidth = Math.max(
    0,
    Math.min(candidate.left + popupWidth, blocker.right) - Math.max(candidate.left, blocker.left)
  )
  const overlapHeight = Math.max(
    0,
    Math.min(candidate.top + popupHeight, blocker.bottom) - Math.max(candidate.top, blocker.top)
  )

  return overlapWidth * overlapHeight
}

function getRectDistance(
  candidate: { left: number; top: number },
  popupWidth: number,
  popupHeight: number,
  blocker: { left: number; top: number; right: number; bottom: number }
) {
  const candidateRight = candidate.left + popupWidth
  const candidateBottom = candidate.top + popupHeight
  const horizontalGap = Math.max(blocker.left - candidateRight, candidate.left - blocker.right, 0)
  const verticalGap = Math.max(blocker.top - candidateBottom, candidate.top - blocker.bottom, 0)
  return Math.hypot(horizontalGap, verticalGap)
}

function clampPopupPositionLegacy({
  containerRect,
  selectionRect,
  popupWidth,
  popupHeight,
  gap = 12
}: Omit<PopupPlacementInput, 'selectionRects' | 'mode'>) {
  const inset = 18
  const preferredLeft = selectionRect.left - containerRect.left + selectionRect.width / 2 - popupWidth / 2
  const safeLeft = Math.min(
    containerRect.width - popupWidth - inset,
    Math.max(inset, preferredLeft)
  )
  const preferredTop = selectionRect.top - containerRect.top - popupHeight - gap
  const flippedTop = selectionRect.bottom - containerRect.top + gap
  const safeTop = preferredTop < inset ? flippedTop : preferredTop

  return {
    left: safeLeft,
    top: Math.min(containerRect.height - popupHeight - inset, Math.max(inset, safeTop))
  }
}

/**
 * Collision-aware popup placement used by the source-document selection toolbar.
 *
 * Algorithm:
 * 1. Keep the popup inside the scroll container with a fixed inset.
 * 2. Treat each client rect from the selected range as a blocker, not just the union box.
 * 3. Try four placements around the union of the selection: above, below, right, then left.
 * 4. Reject any candidate that overlaps selected text when a non-overlapping placement exists.
 * 5. If every placement is constrained, choose the smallest overlap and largest clearance.
 *
 * Set `NEXT_PUBLIC_SELECTION_ACTION_POPUP_PLACEMENT_MODE=legacy` to disable this path for A/B testing.
 */
function clampPopupPositionAvoidOverlap({
  containerRect,
  selectionRect,
  selectionRects,
  popupWidth,
  popupHeight,
  gap = 12
}: Omit<PopupPlacementInput, 'mode'>) {
  const inset = 18
  const minLeft = inset
  const maxLeft = Math.max(inset, containerRect.width - popupWidth - inset)
  const minTop = inset
  const maxTop = Math.max(inset, containerRect.height - popupHeight - inset)
  const selectionLeft = selectionRect.left - containerRect.left
  const selectionTop = selectionRect.top - containerRect.top
  const selectionRight = selectionLeft + selectionRect.width
  const selectionBottom = selectionTop + selectionRect.height
  const selectionCenterX = selectionLeft + selectionRect.width / 2
  const selectionCenterY = selectionTop + selectionRect.height / 2
  const blockerRects =
    selectionRects && selectionRects.length > 0
      ? selectionRects.map((rect) => toContainerRelativeRect(rect, containerRect))
      : [toContainerRelativeRect(selectionRect, containerRect)]
  const tallestBlockerHeight = Math.max(...blockerRects.map((rect) => rect.height), selectionRect.height)
  const verticalGap = gap + Math.max(10, Math.min(24, tallestBlockerHeight * 0.35))
  const centeredLeft = clampValue(selectionCenterX - popupWidth / 2, minLeft, maxLeft)
  const centeredTop = clampValue(selectionCenterY - popupHeight / 2, minTop, maxTop)
  const unclampedAboveTop = selectionTop - popupHeight - verticalGap
  const unclampedBelowTop = selectionBottom + verticalGap
  const unclampedRightLeft = selectionRight + gap
  const unclampedLeftLeft = selectionLeft - popupWidth - gap

  const candidates = [
    {
      left: centeredLeft,
      top: clampValue(unclampedAboveTop, minTop, maxTop),
      priority: 0,
      fitsWithoutClamp: unclampedAboveTop >= minTop
    },
    {
      left: centeredLeft,
      top: clampValue(unclampedBelowTop, minTop, maxTop),
      priority: 1,
      fitsWithoutClamp: unclampedBelowTop <= maxTop
    },
    {
      left: clampValue(unclampedRightLeft, minLeft, maxLeft),
      top: centeredTop,
      priority: 2,
      fitsWithoutClamp: unclampedRightLeft <= maxLeft
    },
    {
      left: clampValue(unclampedLeftLeft, minLeft, maxLeft),
      top: centeredTop,
      priority: 3,
      fitsWithoutClamp: unclampedLeftLeft >= minLeft
    }
  ]

  const bestCandidate = candidates
    .map((candidate) => {
      const overlapArea = blockerRects.reduce(
        (total, blocker) => total + getRectOverlapArea(candidate, popupWidth, popupHeight, blocker),
        0
      )
      const minClearance = Math.min(
        ...blockerRects.map((blocker) => getRectDistance(candidate, popupWidth, popupHeight, blocker))
      )

      return {
        ...candidate,
        overlapArea,
        minClearance
      }
    })
    .sort((leftCandidate, rightCandidate) => {
      if (leftCandidate.overlapArea !== rightCandidate.overlapArea) {
        return leftCandidate.overlapArea - rightCandidate.overlapArea
      }

      if (leftCandidate.fitsWithoutClamp !== rightCandidate.fitsWithoutClamp) {
        return leftCandidate.fitsWithoutClamp ? -1 : 1
      }

      if (leftCandidate.minClearance !== rightCandidate.minClearance) {
        return rightCandidate.minClearance - leftCandidate.minClearance
      }

      return leftCandidate.priority - rightCandidate.priority
    })[0]

  return {
    left: bestCandidate.left,
    top: bestCandidate.top
  }
}
