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
  popupWidth: number
  popupHeight: number
  gap?: number
}

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

export function measureAnchorMetric(
  anchor: PageAnchor,
  pageElement: HTMLElement | null,
  shellRect: DOMRect
): AnchorViewportMetric | null {
  if (!pageElement) {
    return null
  }

  // Prefer the actual rendered gutter marker position over text geometry.
  // This makes SVG link endpoints stable across zoom/rerender and matches what the user sees.
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
    const x = rect.left - shellRect.left
    const y = rect.top - shellRect.top
    const width = rect.width
    const height = rect.height
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

  const liveRects = resolveAnchorClientRects(pageElement, anchor)
  if (liveRects.length === 0) {
    return null
  }

  const viewportRects = liveRects.map((rect) => ({
    x: rect.left - shellRect.left,
    y: rect.top - shellRect.top,
    width: rect.width,
    height: rect.height
  }))

  const left = Math.min(...viewportRects.map((rect) => rect.x))
  const top = Math.min(...viewportRects.map((rect) => rect.y))
  const right = Math.max(...viewportRects.map((rect) => rect.x + rect.width))
  const bottom = Math.max(...viewportRects.map((rect) => rect.y + rect.height))

  return {
    anchorId: anchor.id,
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
    centerX: left + (right - left) / 2,
    centerY: top + (bottom - top) / 2,
    rects: viewportRects
  }
}

export function clampPopupPosition({
  containerRect,
  selectionRect,
  popupWidth,
  popupHeight,
  gap = 12
}: PopupPlacementInput) {
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
