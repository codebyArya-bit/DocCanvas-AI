import type { BoundingBox, PageAnchor } from '@workspace/domain'
import type { SelectionArtifactInput } from '../../lib/excerpts/pdf-selection'

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

export function measureAnchorMetric(
  anchor: PageAnchor,
  pageElement: HTMLElement | null,
  shellRect: DOMRect
): AnchorViewportMetric | null {
  if (!pageElement) {
    return null
  }

  const pageRect = pageElement.getBoundingClientRect()
  const anchorRects = buildAnchorRects(anchor)
  if (anchorRects.length === 0) {
    return null
  }

  const viewportRects = anchorRects.map((rect) => ({
    x: pageRect.left - shellRect.left + rect.x,
    y: pageRect.top - shellRect.top + rect.y,
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
  const preferredLeft = selectionRect.left - containerRect.left + selectionRect.width / 2 - popupWidth / 2
  const safeLeft = Math.min(
    containerRect.width - popupWidth - 12,
    Math.max(12, preferredLeft)
  )

  const preferredTop = selectionRect.top - containerRect.top - popupHeight - gap
  const flippedTop = selectionRect.bottom - containerRect.top + gap
  const safeTop = preferredTop < 12 ? flippedTop : preferredTop

  return {
    left: safeLeft,
    top: Math.min(containerRect.height - popupHeight - 12, Math.max(12, safeTop))
  }
}
