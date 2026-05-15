export type SelectionViewportRect = {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

export type SelectionPopupPlacement = 'above' | 'below' | 'left' | 'right' | 'bottom-docked' | 'clamped'

export type SelectionPopupPosition = {
  left: number
  top: number
  placement: SelectionPopupPlacement
}

export function resolveSelectionPopupPosition({
  preferredLeft,
  preferredTop,
  popupWidth,
  popupHeight,
  viewportWidth,
  viewportHeight,
  selectionRect,
  selectionRects
}: {
  preferredLeft: number
  preferredTop: number
  popupWidth: number
  popupHeight: number
  viewportWidth: number
  viewportHeight: number
  selectionRect?: SelectionViewportRect
  selectionRects?: SelectionViewportRect[]
}): SelectionPopupPosition {
  const margin = 12
  const gap = 12
  const maxLeft = Math.max(margin, viewportWidth - popupWidth - margin)
  const maxTop = Math.max(margin, viewportHeight - popupHeight - margin)
  const clampLeft = (value: number) => clampValue(value, margin, maxLeft)
  const clampTop = (value: number) => clampValue(value, margin, maxTop)

  if (!selectionRect) {
    return { left: clampLeft(preferredLeft), top: clampTop(preferredTop), placement: 'clamped' }
  }

  const blockers = selectionRects?.length ? selectionRects : [selectionRect]
  const tallestBlockerHeight = Math.max(...blockers.map((rect) => rect.height), selectionRect.height)
  const verticalGap = gap + Math.max(10, Math.min(24, tallestBlockerHeight * 0.35))
  const centeredLeft = selectionRect.left + selectionRect.width / 2 - popupWidth / 2
  const centeredTop = selectionRect.top + selectionRect.height / 2 - popupHeight / 2
  const aboveTop = selectionRect.top - popupHeight - verticalGap
  const belowTop = selectionRect.bottom + verticalGap
  const rightLeft = selectionRect.right + gap
  const leftLeft = selectionRect.left - popupWidth - gap
  const candidates: Array<SelectionPopupPosition & { priority: number; fitsWithoutClamp: boolean }> = [
    { left: clampLeft(centeredLeft), top: clampTop(aboveTop), placement: 'above', priority: 0, fitsWithoutClamp: aboveTop >= margin },
    { left: clampLeft(centeredLeft), top: clampTop(belowTop), placement: 'below', priority: 1, fitsWithoutClamp: belowTop <= maxTop },
    { left: clampLeft(rightLeft), top: clampTop(centeredTop), placement: 'right', priority: 2, fitsWithoutClamp: rightLeft <= maxLeft },
    { left: clampLeft(leftLeft), top: clampTop(centeredTop), placement: 'left', priority: 3, fitsWithoutClamp: leftLeft >= margin }
  ]

  const fullyVisibleNonOverlapping = candidates.find((candidate) =>
    isFullyVisible(candidate, popupWidth, popupHeight, viewportWidth, viewportHeight, margin) &&
    !touchesAnyBlocker(candidate, popupWidth, popupHeight, blockers, gap)
  )
  if (fullyVisibleNonOverlapping) return fullyVisibleNonOverlapping

  const bottomDocked: SelectionPopupPosition = {
    left: clampLeft(centeredLeft),
    top: viewportHeight - popupHeight - margin,
    placement: 'bottom-docked'
  }
  if (
    viewportWidth <= 520 &&
    bottomDocked.top >= selectionRect.bottom + gap &&
    !touchesAnyBlocker(bottomDocked, popupWidth, popupHeight, blockers, gap)
  ) {
    return bottomDocked
  }

  const fallbackCandidates = [...candidates, bottomDocked].map((candidate) => {
    const left = clampLeft(candidate.left)
    let top = clampTop(candidate.top)
    const clampedCandidate = { ...candidate, left, top }

    if (touchesAnyBlocker(clampedCandidate, popupWidth, popupHeight, blockers, gap)) {
      const pushedBelowTop = selectionRect.bottom + verticalGap
      const pushedAboveTop = selectionRect.top - popupHeight - verticalGap
      const canMoveBelow = pushedBelowTop + popupHeight <= viewportHeight - margin
      const canMoveAbove = pushedAboveTop >= margin

      if (canMoveBelow) top = pushedBelowTop
      else if (canMoveAbove) top = pushedAboveTop
      else top = clampTop(top)
    }

    return { ...candidate, left, top }
  })

  return fallbackCandidates.sort((a, b) => {
    const touchDelta =
      Number(touchesAnyBlocker(a, popupWidth, popupHeight, blockers, gap)) -
      Number(touchesAnyBlocker(b, popupWidth, popupHeight, blockers, gap))
    if (touchDelta !== 0) return touchDelta
    const overlapDelta = totalOverlapArea(a, popupWidth, popupHeight, blockers) - totalOverlapArea(b, popupWidth, popupHeight, blockers)
    if (overlapDelta !== 0) return overlapDelta
    const fitDelta = Number(!fitsWithoutClamp(a)) - Number(!fitsWithoutClamp(b))
    if (fitDelta !== 0) return fitDelta
    const clearanceDelta = minClearance(b, popupWidth, popupHeight, blockers) - minClearance(a, popupWidth, popupHeight, blockers)
    if (clearanceDelta !== 0) return clearanceDelta
    const priorityDelta = candidatePriority(a) - candidatePriority(b)
    if (priorityDelta !== 0) return priorityDelta
    return distanceFromPreferred(a, preferredLeft, preferredTop) - distanceFromPreferred(b, preferredLeft, preferredTop)
  })[0] ?? { left: clampLeft(preferredLeft), top: clampTop(preferredTop), placement: 'clamped' }
}

function fitsWithoutClamp(position: SelectionPopupPosition) {
  return 'fitsWithoutClamp' in position && position.fitsWithoutClamp === true
}

function candidatePriority(position: SelectionPopupPosition) {
  return 'priority' in position && typeof position.priority === 'number' ? position.priority : 4
}

function isFullyVisible(
  position: SelectionPopupPosition,
  width: number,
  height: number,
  viewportWidth: number,
  viewportHeight: number,
  margin: number
) {
  return (
    position.left >= margin &&
    position.top >= margin &&
    position.left + width <= viewportWidth - margin &&
    position.top + height <= viewportHeight - margin
  )
}

function overlapArea(position: SelectionPopupPosition, width: number, height: number, rect: SelectionViewportRect) {
  const left = Math.max(position.left, rect.left)
  const right = Math.min(position.left + width, rect.right)
  const top = Math.max(position.top, rect.top)
  const bottom = Math.min(position.top + height, rect.bottom)
  return Math.max(0, right - left) * Math.max(0, bottom - top)
}

function totalOverlapArea(position: SelectionPopupPosition, width: number, height: number, rects: SelectionViewportRect[]) {
  return rects.reduce((total, rect) => total + overlapArea(position, width, height, rect), 0)
}

function minClearance(position: SelectionPopupPosition, width: number, height: number, rects: SelectionViewportRect[]) {
  return Math.min(...rects.map((rect) => rectDistance(position, width, height, rect)))
}

function rectDistance(position: SelectionPopupPosition, width: number, height: number, rect: SelectionViewportRect) {
  const right = position.left + width
  const bottom = position.top + height
  const horizontalGap = Math.max(rect.left - right, position.left - rect.right, 0)
  const verticalGap = Math.max(rect.top - bottom, position.top - rect.bottom, 0)
  return Math.hypot(horizontalGap, verticalGap)
}

function isTouchingSelection(
  position: SelectionPopupPosition,
  width: number,
  height: number,
  rect: SelectionViewportRect,
  gap: number
) {
  return (
    position.left < rect.right + gap &&
    position.left + width > rect.left - gap &&
    position.top < rect.bottom + gap &&
    position.top + height > rect.top - gap
  )
}

function touchesAnyBlocker(
  position: SelectionPopupPosition,
  width: number,
  height: number,
  rects: SelectionViewportRect[],
  gap: number
) {
  return rects.some((rect) => isTouchingSelection(position, width, height, rect, gap))
}

function distanceFromPreferred(position: SelectionPopupPosition, preferredLeft: number, preferredTop: number) {
  return Math.abs(position.left - preferredLeft) + Math.abs(position.top - preferredTop)
}

function clampValue(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}
